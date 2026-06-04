import type { AgentSubscriber } from "@ag-ui/client";
import type { IRNode, MessageRef, PlatformUser } from "@copilotkit/bot-ui";
import type {
  PlatformAdapter, SurfaceCapabilities, IngressSink, IncomingTurn,
  InteractionEvent, RunRenderer, CapturedToolCall, CapturedInterrupt,
  ReplyTarget, NativePayload, UserQuery, ConversationStore,
} from "../platform-adapter.js";

/** A RunRenderer whose subscriber captures tool-call-end and custom (interrupt) events — used by run-loop tests. */
export function makeFakeRunRenderer(): RunRenderer {
  const toolCalls: CapturedToolCall[] = [];
  let pending: CapturedInterrupt | undefined;
  const subscriber: AgentSubscriber = {
    onToolCallEndEvent(p) {
      toolCalls.push({
        toolCallId: p.event.toolCallId,
        toolCallName: p.toolCallName,
        toolCallArgs: (p.toolCallArgs ?? {}) as Record<string, unknown>,
      });
    },
    onCustomEvent(p) {
      const e = p.event as { name?: string; value?: unknown };
      if (e.name) pending = { eventName: e.name, value: e.value };
    },
  };
  return {
    subscriber,
    async markInterrupted() {},
    getCapturedToolCalls: () => toolCalls,
    getPendingInterrupt: () => pending,
    clearPendingInterrupt: () => {
      pending = undefined;
    },
  };
}

export class FakeAdapter implements PlatformAdapter {
  readonly platform = "fake";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
  };
  readonly ackDeadlineMs = 3000;
  readonly conversationStore: ConversationStore = {
    async getOrCreate(conversationKey, _replyTarget, makeAgent) {
      return { agent: makeAgent(conversationKey) };
    },
  };

  posted: IRNode[][] = [];
  updated: { ref: MessageRef; ir: IRNode[] }[] = [];
  interactionsSeen: InteractionEvent[] = [];
  lastRunRenderer?: RunRenderer;
  private sink?: IngressSink;
  private counter = 0;

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;
  }
  async stop(): Promise<void> {}

  render(ir: IRNode[]): NativePayload {
    return ir;
  }
  async post(_target: ReplyTarget, ir: IRNode[]): Promise<MessageRef> {
    this.posted.push(ir);
    return { id: `msg-${++this.counter}` };
  }
  async update(ref: MessageRef, ir: IRNode[]): Promise<void> {
    this.updated.push({ ref, ir });
  }
  async stream(_target: ReplyTarget, chunks: AsyncIterable<string>): Promise<MessageRef> {
    let s = "";
    for await (const c of chunks) s += c;
    this.posted.push([{ type: "text", props: { value: s } }]);
    return { id: `msg-${++this.counter}` };
  }
  async delete(_ref: MessageRef): Promise<void> {}

  createRunRenderer(_target: ReplyTarget): RunRenderer {
    const r = makeFakeRunRenderer();
    this.lastRunRenderer = r;
    return r;
  }
  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return raw as InteractionEvent;
  }
  async lookupUser(_q: UserQuery): Promise<PlatformUser | undefined> {
    return undefined;
  }

  // --- test helpers ---
  emitTurn(partial: Partial<IncomingTurn>): void {
    void this.sink?.onTurn({ conversationKey: "c", replyTarget: {}, userText: "", platform: "fake", ...partial });
  }
  emitInteraction(partial: Partial<InteractionEvent>): void {
    const evt: InteractionEvent = { id: "", conversationKey: "c", replyTarget: {}, ...partial };
    this.interactionsSeen.push(evt);
    void this.sink?.onInteraction(evt);
  }
}
