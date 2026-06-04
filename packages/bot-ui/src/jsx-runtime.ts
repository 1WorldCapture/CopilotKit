import { Fragment, type IRNode } from "./ir.js";
export { Fragment };
export function jsx(type: IRNode["type"], props: Record<string, unknown>, key?: string | number): IRNode {
  return { type, props: props ?? {}, key };
}
export const jsxs = jsx;
