export interface MessageRef { id: string; [k: string]: unknown }
export interface PlatformUser { id: string; name?: string; handle?: string; email?: string }
export interface IncomingMessage { text: string; user: PlatformUser; ref: MessageRef; platform: string }
export interface Thread {
  readonly platform: string;
  post(ui: unknown): Promise<MessageRef>;
  update(ref: MessageRef, ui: unknown): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  runAgent(input?: unknown): Promise<MessageRef | undefined>;
  resume(value: unknown): Promise<MessageRef | undefined>;
  stream(src: string | AsyncIterable<string>): Promise<MessageRef>;
}
export interface InteractionContext {
  thread: Thread; message: IncomingMessage;
  action: { id: string; value?: unknown };
  values: Record<string, unknown>; user: PlatformUser; platform: string;
}
export type ClickHandler = (ctx: InteractionContext) => void | Promise<void>;
