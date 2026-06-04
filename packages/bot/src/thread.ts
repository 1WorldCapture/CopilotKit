import type { PlatformAdapter, ReplyTarget } from "./platform-adapter.js";
import type { ActionRegistry } from "./action-registry.js";
import type { Renderable, MessageRef, Thread as ThreadInterface } from "@copilotkit/bot-ui";
import { runAgentLoop } from "./run-loop.js";
import { toAgentToolDescriptors } from "./tools.js";
import type { BotTool, ContextEntry, AgentToolDescriptor } from "./tools.js";
import type { AbstractAgent } from "@ag-ui/client";
import type { CapturedToolCall } from "./platform-adapter.js";

export interface ThreadDeps {
  adapter: PlatformAdapter;
  replyTarget: ReplyTarget;
  conversationKey: string;
  registry: ActionRegistry;
  agentFactory: (threadId: string) => AbstractAgent;
  tools: Map<string, BotTool>;
  toolDescriptors: AgentToolDescriptor[];
  context: ContextEntry[];
  registerWaiter: (conversationKey: string, resolve: (value: unknown) => void) => void;
  interruptHandlers: Map<string, (args: { payload: unknown; thread: Thread }) => void | Promise<void>>;
  /** Optional adapter-supplied extra tool context (merged into the per-call ctx). */
  adapterToolContext?: (call: CapturedToolCall) => Record<string, unknown>;
}

/** A concrete conversation thread: posts UI, runs the agent loop, and resolves HITL waiters. */
export class Thread implements ThreadInterface {
  readonly platform: string;

  constructor(private deps: ThreadDeps) {
    this.platform = deps.adapter.platform;
  }

  private async bindForPost(ui: Renderable) {
    return this.deps.registry.bindRenderable(ui, this.deps.conversationKey);
  }

  async post(ui: Renderable): Promise<MessageRef> {
    return this.deps.adapter.post(this.deps.replyTarget, await this.bindForPost(ui));
  }

  async update(ref: MessageRef, ui: Renderable): Promise<MessageRef> {
    await this.deps.adapter.update(ref, await this.bindForPost(ui));
    return ref;
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.deps.adapter.delete(ref);
  }

  async stream(src: string | AsyncIterable<string>): Promise<MessageRef> {
    const iter =
      typeof src === "string"
        ? (async function* () {
            yield src;
          })()
        : src;
    return this.deps.adapter.stream(this.deps.replyTarget, iter);
  }

  /** Post a picker and wait until an interaction in this conversation resolves it. */
  async awaitChoice(ui: Renderable): Promise<unknown> {
    const p = new Promise<unknown>((resolve) =>
      this.deps.registerWaiter(this.deps.conversationKey, resolve),
    );
    await this.post(ui);
    return p;
  }

  async runAgent(input?: {
    context?: ContextEntry[];
    tools?: BotTool[];
  }): Promise<MessageRef | undefined> {
    return this.run(undefined, input);
  }

  async resume(value: unknown): Promise<MessageRef | undefined> {
    return this.run({ resume: value });
  }

  private async run(
    initialResume?: { resume: unknown },
    extra?: { context?: ContextEntry[]; tools?: BotTool[] },
  ): Promise<MessageRef | undefined> {
    const session = await this.deps.adapter.conversationStore.getOrCreate(
      this.deps.conversationKey,
      this.deps.replyTarget,
      this.deps.agentFactory,
    );
    const renderer = this.deps.adapter.createRunRenderer(this.deps.replyTarget);

    // Merge per-run context/tools (this run only) on top of the bot-level deps.
    const extraTools = extra?.tools ?? [];
    let tools = this.deps.tools;
    let toolDescriptors = this.deps.toolDescriptors;
    if (extraTools.length > 0) {
      tools = new Map(this.deps.tools);
      for (const t of extraTools) tools.set(t.name, t);
      toolDescriptors = [...this.deps.toolDescriptors, ...toAgentToolDescriptors(extraTools)];
    }
    const context = extra?.context?.length
      ? [...this.deps.context, ...extra.context]
      : this.deps.context;

    await runAgentLoop({
      agent: session.agent,
      renderer,
      tools,
      toolDescriptors,
      context,
      makeToolCtx: (call) => ({
        thread: this,
        platform: this.platform,
        ...(this.deps.adapterToolContext?.(call) ?? {}),
      }),
      handleInterrupt: async (interrupt) => {
        const h = this.deps.interruptHandlers.get(interrupt.eventName);
        if (h) await h({ payload: interrupt.value, thread: this });
      },
      initialResume,
    });
    return undefined;
  }
}
