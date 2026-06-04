import type {
  IRNode,
  ClickHandler,
  InteractionContext,
  ComponentFn,
  Renderable,
} from "@copilotkit/bot-ui";
import { isBound, getBoundArgs, renderToIR } from "@copilotkit/bot-ui";
import { mintId } from "./mint-id.js";
import type { ActionStore } from "./action-store.js";

export class ActionExpiredError extends Error {
  constructor(id: string) {
    super(`Action "${id}" has expired or is no longer available.`);
    this.name = "ActionExpiredError";
  }
}

const EVENT_PROPS = ["onClick", "onSelect", "onSubmit"] as const;

export class ActionRegistry {
  private store: ActionStore;
  private components = new Map<string, ComponentFn>();
  private hot = new Map<string, ClickHandler>();

  constructor(opts: { store: ActionStore }) {
    this.store = opts.store;
  }

  registerComponent(name: string, fn: ComponentFn): void {
    this.components.set(name, fn);
  }

  clearHotCache(): void {
    this.hot.clear();
  }

  // Renders the named component, binds all event-prop handlers in the tree
  // (mint id, hot-cache + ActionStore snapshot, rewrite prop to { id }), returns the bound IR.
  async bindTree(
    componentName: string,
    props: Record<string, unknown>,
    conversationKey: string,
  ): Promise<IRNode[]> {
    const fn = this.components.get(componentName);
    const root = renderToIR((fn ? fn(props) : props) as Renderable);
    await this.walk(root, [], componentName, props, conversationKey);
    return root;
  }

  private async walk(
    nodes: IRNode[],
    base: (string | number)[],
    comp: string,
    props: unknown,
    conv: string,
  ): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      const path: (string | number)[] = [...base, i];
      for (const ep of EVENT_PROPS) {
        const handler = node.props[ep];
        if (typeof handler === "function") {
          const fullPath: (string | number)[] = [...path, ep];
          const id = mintId(comp, fullPath, props);
          this.hot.set(id, handler as ClickHandler);
          await this.store.put(id, {
            component: comp,
            props,
            path: fullPath,
            conversationKey: conv,
            boundArgs: isBound(handler) ? getBoundArgs(handler) : undefined,
          });
          node.props[ep] = { id };
        }
      }
      const children = node.props.children;
      if (Array.isArray(children)) {
        await this.walk(children as IRNode[], [...path, "children"], comp, props, conv);
      }
    }
  }

  async dispatch(id: string, ctx: InteractionContext): Promise<unknown> {
    let handler = this.hot.get(id);
    if (!handler) {
      const snap = await this.store.get(id);
      if (!snap || !snap.component) throw new ActionExpiredError(id);
      const fn = this.components.get(snap.component);
      if (!fn) throw new ActionExpiredError(id);
      const tree = renderToIR(fn(snap.props as Record<string, unknown>) as Renderable);
      handler = pluck(tree, snap.path);
      if (!handler) throw new ActionExpiredError(id);
    }
    return handler({ ...ctx, action: { ...ctx.action, id } });
  }
}

function pluck(tree: IRNode[], path: (string | number)[]): ClickHandler | undefined {
  let cur: unknown = tree;
  for (const seg of path.slice(0, -1)) {
    if (Array.isArray(cur)) cur = cur[seg as number];
    else if (cur && typeof cur === "object") cur = (cur as IRNode).props?.[seg as string];
    else return undefined;
  }
  const ep = path[path.length - 1] as string;
  const node = cur as IRNode | undefined;
  const h = node?.props?.[ep];
  return typeof h === "function" ? (h as ClickHandler) : undefined;
}
