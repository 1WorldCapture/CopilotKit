export type ComponentFn = (props: Record<string, unknown>) => IRNode | IRNode[] | string | null;
export interface IRNode {
  type: string | ComponentFn | symbol;
  props: Record<string, unknown>;
  key?: string | number;
}
export type Renderable = string | IRNode | IRNode[] | { raw: unknown };
export const Fragment: unique symbol = Symbol.for("copilotkit.bot-ui.Fragment");
