export interface MessageRef { id: string; [k: string]: unknown }
export interface PlatformUser { id: string; name?: string; handle?: string; email?: string }
export interface IncomingMessage { text: string; user: PlatformUser; ref: MessageRef; platform: string }
export interface Thread {
  readonly platform: string;
  post(ui: unknown): Promise<MessageRef>;
  update(ref: MessageRef, ui: unknown): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  /** Post a picker and block until an interaction resolves it to the clicked button's `value`. */
  awaitChoice(ui: unknown): Promise<unknown>;
  runAgent(input?: unknown): Promise<MessageRef | undefined>;
  resume(value: unknown): Promise<MessageRef | undefined>;
  stream(src: string | AsyncIterable<string>): Promise<MessageRef>;
  postFile(args: { bytes: Uint8Array; filename: string; title?: string; altText?: string }): Promise<{ ok: boolean; fileId?: string; error?: string }>;
}
export interface InteractionContext {
  thread: Thread; message: IncomingMessage;
  action: { id: string; value?: unknown };
  values: Record<string, unknown>; user: PlatformUser; platform: string;
}
export type ClickHandler = (ctx: InteractionContext) => void | Promise<void>;
