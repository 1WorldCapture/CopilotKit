import type { IRNode } from "./ir.js";
import type { ClickHandler } from "./types.js";

/**
 * Anything that can appear as a child in the component tree: nested elements,
 * text, numbers, and conditionals (`false` / `null` / `undefined` render
 * nothing), plus arrays thereof.
 */
export type BotNode =
  | IRNode
  | string
  | number
  | boolean
  | null
  | undefined
  | BotNode[];

/** Mixin for the container components that wrap children. */
interface WithChildren {
  children?: BotNode;
}

// ---- Component prop types ------------------------------------------------
// Each component has a closed prop type so JSX attribute checking rejects
// unknown props (and, for the leaf components, unexpected children).

export interface MessageProps extends WithChildren {
  /** Accent color (hex, e.g. `#27AE60`) for the message's colored rail. */
  accent?: string;
}
export interface HeaderProps extends WithChildren {}
export interface SectionProps extends WithChildren {}
export interface MarkdownProps extends WithChildren {}
export interface FieldsProps extends WithChildren {}
export interface FieldProps extends WithChildren {}
export interface ContextProps extends WithChildren {}
export interface ActionsProps extends WithChildren {}

export interface ImageProps {
  /** Image URL. */
  url: string;
  /** Alternative text for accessibility. */
  alt?: string;
}

/** `<Divider />` takes no props or children. */
export type DividerProps = { children?: never };

export interface ButtonProps extends WithChildren {
  /** Inline handler run when the button is clicked (bound by the action registry). */
  onClick?: ClickHandler;
  /** Opaque value echoed back on click. */
  value?: unknown;
  /** Slack button accent. */
  style?: "primary" | "danger";
}

export interface SelectOption {
  label: string;
  value: string;
}
export interface SelectProps {
  onSelect?: ClickHandler;
  placeholder?: string;
  options: SelectOption[];
}

export interface InputProps {
  onSubmit?: ClickHandler;
  placeholder?: string;
  multiline?: boolean;
  name?: string;
}

export interface TableColumn {
  header: string;
  align?: "left" | "center" | "right";
}
export interface TableProps extends WithChildren {
  columns?: TableColumn[];
}
export interface RowProps extends WithChildren {}
export interface CellProps extends WithChildren {}

// ---- Components ----------------------------------------------------------
// `intrinsic` produces a typed component that lowers `<X .../>` to an IR node
// of the given `type`; the generic `P` is what gives each tag its prop type.

const intrinsic =
  <P,>(type: string) =>
  (props: P): IRNode => ({ type, props: (props ?? {}) as Record<string, unknown> });

export const Message = intrinsic<MessageProps>("message");
export const Header = intrinsic<HeaderProps>("header");
export const Section = intrinsic<SectionProps>("section");
export const Markdown = intrinsic<MarkdownProps>("markdown");
export const Field = intrinsic<FieldProps>("field");
export const Fields = intrinsic<FieldsProps>("fields");
export const Context = intrinsic<ContextProps>("context");
export const Actions = intrinsic<ActionsProps>("actions");
export const Image = intrinsic<ImageProps>("image");
export const Divider = intrinsic<DividerProps>("divider");
export const Row = intrinsic<RowProps>("row");
export const Cell = intrinsic<CellProps>("cell");

export function Button(props: ButtonProps): IRNode {
  return { type: "button", props: props as unknown as Record<string, unknown> };
}
export function Select(props: SelectProps): IRNode {
  return { type: "select", props: props as unknown as Record<string, unknown> };
}
export function Input(props: InputProps): IRNode {
  return { type: "input", props: props as unknown as Record<string, unknown> };
}
export function Table(props: TableProps): IRNode {
  return { type: "table", props: props as unknown as Record<string, unknown> };
}
