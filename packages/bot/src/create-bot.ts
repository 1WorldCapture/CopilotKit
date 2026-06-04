import type {
  PlatformAdapter,
  IngressSink,
  IncomingTurn,
  InteractionEvent,
} from "./platform-adapter.js";
import { ActionRegistry, ActionExpiredError } from "./action-registry.js";
import { InMemoryActionStore, type ActionStore } from "./action-store.js";
import { toAgentToolDescriptors, type AnyBotTool, type ContextEntry } from "./tools.js";
import { Thread, type ThreadDeps } from "./thread.js";
import type { AbstractAgent } from "@ag-ui/client";
import type { InteractionContext, IncomingMessage } from "@copilotkit/bot-ui";

export type BotHandler = (ctx: {
  thread: Thread;
  message: IncomingMessage;
}) => void | Promise<void>;

export interface CreateBotOptions {
  adapters: PlatformAdapter[];
  agent?: AbstractAgent | ((threadId: string) => AbstractAgent);
  actionStore?: ActionStore;
  tools?: AnyBotTool[];
  context?: ContextEntry[];
}

export interface Bot {
  onMention(h: BotHandler): void;
  onMessage(h: BotHandler): void;
  onInteraction(id: string, h: (ctx: InteractionContext) => void | Promise<void>): void;
  onInterrupt(
    eventName: string,
    h: (args: { payload: unknown; thread: Thread }) => void | Promise<void>,
  ): void;
  tool(t: AnyBotTool): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createBot(opts: CreateBotOptions): Bot {
  const registry = new ActionRegistry({ store: opts.actionStore ?? new InMemoryActionStore() });

  const agentFactory: (threadId: string) => AbstractAgent = (() => {
    const a = opts.agent;
    if (typeof a === "function") return a as (threadId: string) => AbstractAgent;
    if (a) return () => a;
    return () => {
      throw new Error("createBot: no agent configured (pass `agent` to use runAgent)");
    };
  })();

  const toolMap = new Map<string, AnyBotTool>();
  for (const t of opts.tools ?? []) toolMap.set(t.name, t);
  const context = opts.context ?? [];

  const mentionHandlers: BotHandler[] = [];
  const messageHandlers: BotHandler[] = [];
  const interactionHandlers = new Map<string, (ctx: InteractionContext) => void | Promise<void>>();
  const interruptHandlers = new Map<
    string,
    (args: { payload: unknown; thread: Thread }) => void | Promise<void>
  >();
  const waiters = new Map<string, (value: unknown) => void>();

  // Recomputed on start() so tools added via bot.tool() before start are picked up.
  let toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);

  function makeThread(
    adapter: PlatformAdapter,
    replyTarget: unknown,
    conversationKey: string,
  ): Thread {
    const deps: ThreadDeps = {
      adapter,
      replyTarget,
      conversationKey,
      registry,
      agentFactory,
      tools: toolMap,
      toolDescriptors,
      context,
      registerWaiter: (k, r) => waiters.set(k, r),
      interruptHandlers,
      // Merge the adapter's per-turn platform context (e.g. Slack client +
      // channel) into every tool-call ctx. Bound to this thread's reply
      // target; the captured-call arg is unused by the adapter hook.
      adapterToolContext: () => adapter.toolContext?.(replyTarget) ?? {},
    };
    return new Thread(deps);
  }

  function makeSink(adapter: PlatformAdapter): IngressSink {
    return {
      async onTurn(turn: IncomingTurn) {
        const thread = makeThread(adapter, turn.replyTarget, turn.conversationKey);
        const message: IncomingMessage = {
          text: turn.userText,
          user: turn.user ?? { id: "" },
          ref: { id: "" },
          platform: turn.platform,
        };
        // v1 routing: there is no turn `kind`, so prefer mention handlers; if
        // none are registered, fall back to message handlers. (The reference
        // example registers identical handlers on both, so this avoids
        // double-firing while still invoking whatever is registered.)
        const handlers = mentionHandlers.length > 0 ? mentionHandlers : messageHandlers;
        for (const h of handlers) await h({ thread, message });
      },
      async onInteraction(evt: InteractionEvent) {
        const thread = makeThread(adapter, evt.replyTarget, evt.conversationKey);
        const user = evt.user ?? { id: "" };
        const ctx: InteractionContext = {
          thread,
          message: { text: "", user, ref: evt.messageRef ?? { id: "" }, platform: adapter.platform },
          action: { id: evt.id, value: evt.value },
          values: {},
          user,
          platform: adapter.platform,
        };
        try {
          const explicit = interactionHandlers.get(evt.id);
          if (explicit) {
            await explicit(ctx);
          } else {
            await registry.dispatch(evt.id, ctx);
          }
        } catch (err) {
          // v1: swallow expired-action dispatches; surface anything else.
          if (!(err instanceof ActionExpiredError)) throw err;
        }
        // Resolve any HITL waiter awaiting a choice in this conversation.
        const w = waiters.get(evt.conversationKey);
        if (w) {
          waiters.delete(evt.conversationKey);
          w(evt.value);
        }
      },
    };
  }

  return {
    onMention(h) {
      mentionHandlers.push(h);
    },
    onMessage(h) {
      messageHandlers.push(h);
    },
    onInteraction(id, h) {
      interactionHandlers.set(id, h);
    },
    onInterrupt(eventName, h) {
      interruptHandlers.set(eventName, h);
    },
    tool(t) {
      toolMap.set(t.name, t);
    },
    async start() {
      toolDescriptors = toAgentToolDescriptors([...toolMap.values()]);
      await Promise.all(opts.adapters.map((a) => a.start(makeSink(a))));
    },
    async stop() {
      await Promise.all(opts.adapters.map((a) => a.stop()));
    },
  };
}
