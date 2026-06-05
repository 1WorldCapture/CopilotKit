import type { AgentSubscriber, AbstractAgent } from "@ag-ui/client";
import type { BotNode, MessageRef, PlatformUser, ThreadMessage } from "@copilotkit/bot-ui";

/** Opaque to the bot core — created by an adapter during ingress and passed back to post/createRunRenderer. */
export type ReplyTarget = unknown;
/** Opaque native payload produced by an adapter's render(). */
export type NativePayload = unknown;

export interface SurfaceCapabilities {
  supportsModals: boolean;
  supportsTyping: boolean;
  supportsReactions: boolean;
  supportsStreaming: boolean;
  maxBlocksPerMessage?: number;
  [k: string]: unknown;
}

export interface CapturedToolCall {
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: Record<string, unknown>;
}
export interface CapturedInterrupt {
  eventName: string;
  value: unknown;
}

/** A per-run handle: the AG-UI subscriber to stream into, plus capture accessors the run-loop reads after each runAgent. */
export interface RunRenderer {
  subscriber: AgentSubscriber;
  markInterrupted(): Promise<void>;
  getCapturedToolCalls(): readonly CapturedToolCall[];
  getPendingInterrupt(): CapturedInterrupt | undefined;
  clearPendingInterrupt(): void;
}

export interface IncomingTurn {
  conversationKey: string;
  replyTarget: ReplyTarget;
  userText: string;
  user?: PlatformUser;
  platform: string;
}

export interface InteractionEvent {
  id: string; // opaque minted action id (ck:...)
  conversationKey: string;
  replyTarget: ReplyTarget;
  value?: unknown;
  user?: PlatformUser;
  /** The message the interaction occurred on (the picker), so handlers can update it in place. */
  messageRef?: MessageRef;
}

export interface IngressSink {
  onTurn(turn: IncomingTurn): void | Promise<void>;
  onInteraction(evt: InteractionEvent): void | Promise<void>;
}

export interface UserQuery {
  query: string;
}

/** A resolved agent session for a conversation (the adapter may build the agent's history from its own state). */
export interface AgentSession {
  agent: AbstractAgent;
}

/** Adapter-owned conversation state; the adapter resolves (or creates) the agent session for a conversation. */
export interface ConversationStore {
  getOrCreate(
    conversationKey: string,
    replyTarget: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ): Promise<AgentSession>;
}

export interface PlatformAdapter {
  readonly platform: string;
  readonly capabilities: SurfaceCapabilities;
  readonly ackDeadlineMs: number;
  start(sink: IngressSink): Promise<void>;
  stop(): Promise<void>;
  render(ir: BotNode[]): NativePayload;
  post(target: ReplyTarget, ir: BotNode[]): Promise<MessageRef>;
  update(ref: MessageRef, ir: BotNode[]): Promise<void>;
  stream(target: ReplyTarget, chunks: AsyncIterable<string>): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  createRunRenderer(target: ReplyTarget): RunRenderer;
  decodeInteraction(raw: unknown): InteractionEvent | undefined;
  lookupUser(q: UserQuery): Promise<PlatformUser | undefined>;
  readonly conversationStore: ConversationStore;
  /**
   * Optional conversation-history read. Backs the capability-gated
   * `Thread.getMessages()`; adapters that can't read history simply omit this,
   * and `Thread.getMessages()` returns `[]`.
   */
  getMessages?(target: ReplyTarget): Promise<ThreadMessage[]>;
  /**
   * Optional platform file upload. Threads expose `postFile` unconditionally;
   * adapters that can't upload simply omit this, and `Thread.postFile` returns
   * a capability-gated `{ ok: false, error }`.
   */
  postFile?(target: ReplyTarget, args: { bytes: Uint8Array; filename: string; title?: string; altText?: string }): Promise<{ ok: boolean; fileId?: string; error?: string }>;
}
