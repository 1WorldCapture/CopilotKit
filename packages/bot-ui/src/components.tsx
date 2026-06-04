import type { IRNode } from "./ir.js";
import type { ClickHandler } from "./types.js";

type Children = { children?: unknown };
const intrinsic = (type: string) => (props: Record<string, unknown>): IRNode => ({ type, props });

export const Message = intrinsic("message");
export const Header = intrinsic("header");
export const Section = intrinsic("section");
export const Markdown = intrinsic("markdown");
export const Field = intrinsic("field");
export const Fields = intrinsic("fields");
export const Context = intrinsic("context");
export const Actions = intrinsic("actions");
export const Image = intrinsic("image");
export const Divider = intrinsic("divider");

export function Button(
  props: Children & { onClick?: ClickHandler; value?: unknown; style?: "primary" | "danger" },
): IRNode {
  return { type: "button", props };
}
export function Select(
  props: { onSelect?: ClickHandler; placeholder?: string; options: { label: string; value: string }[] },
): IRNode {
  return { type: "select", props };
}
export function Input(
  props: { onSubmit?: ClickHandler; placeholder?: string; multiline?: boolean; name?: string },
): IRNode {
  return { type: "input", props };
}

export function Table(props: {
  columns?: { header: string; align?: "left" | "center" | "right" }[];
  children?: unknown;
}): IRNode {
  return { type: "table", props };
}
export const Row = intrinsic("row");
export const Cell = intrinsic("cell");
