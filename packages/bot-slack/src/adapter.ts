import { App, LogLevel } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget as BotReplyTarget,
  ConversationStore,
  AgentSession,
  MessageRef,
  PlatformUser,
  UserQuery,
} from "@copilotkit/bot";
import type { AbstractAgent } from "@ag-ui/client";
import type { IRNode } from "@copilotkit/bot-ui";
import { SlackConversationStore } from "./conversation-store.js";
import { attachSlackListener } from "./slack-listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction, conversationKeyOf } from "./interaction.js";
import { renderBlockKit } from "./render/block-kit.js";
import { ChunkedMessageStream } from "./chunked-message-stream.js";
import { autoCloseOpenMarkdown } from "./auto-close-streaming.js";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";
import { DM_SCOPE, type ConversationKey, type ReplyTarget } from "./types.js";
import type { SlackToolContext } from "./tool-context.js";

export interface SlackAdapterOptions {
  /** Slack bot token (xoxb-…). */
  botToken: string;
  /** Slack app-level token (xapp-…) used for Socket Mode. */
  appToken: string;
  /** Signing secret; required when not using Socket Mode. */
  signingSecret?: string;
  /** Use Socket Mode (default true). HTTP mode requires `signingSecret`. */
  socketMode?: boolean;
  /** HTTP port for non-socket mode (ignored under Socket Mode). */
  port?: number;
  /** Bolt log level. */
  logLevel?: LogLevel;
  /** Custom-event names treated as interrupts by the run renderer. */
  interruptEventNames?: ReadonlySet<string>;
  /** Surface `:wrench:`/`:white_check_mark:` tool-status rows. Default true. */
  showToolStatus?: boolean;
}

/** Slack `PlatformAdapter`: ingress via Bolt, egress via Block Kit + streaming. */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = "slack";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    maxBlocksPerMessage: 50,
  };
  readonly ackDeadlineMs = 3000;

  readonly app: App;
  client: WebClient;
  botUserId = "";
  private readonly store: SlackConversationStore;
  private sink: IngressSink | undefined;

  constructor(private readonly opts: SlackAdapterOptions) {
    this.app = new App({
      token: opts.botToken,
      appToken: opts.appToken,
      signingSecret: opts.signingSecret,
      socketMode: opts.socketMode ?? true,
      logLevel: opts.logLevel ?? LogLevel.INFO,
    });
    this.client = this.app.client;
    this.store = new SlackConversationStore({
      client: this.client,
      botUserId: "",
      botToken: opts.botToken,
    });
  }

  async start(sink: IngressSink): Promise<void> {
    this.sink = sink;

    // Resolve our own bot user id before attaching the listener so the loop
    // guard (skip our own posts) is in place from the first event.
    const auth = await this.client.auth.test();
    this.botUserId = auth.user_id as string;
    (this.store as unknown as { botUserId: string }).botUserId = this.botUserId;

    attachSlackListener({
      app: this.app,
      store: this.store,
      botUserId: this.botUserId,
      onTurn: (turn) => {
        void sink.onTurn({
          conversationKey: conversationKeyOf(turn.conversation),
          replyTarget: turn.replyTarget,
          userText: turn.userText,
          user: turn.senderUserId ? { id: turn.senderUserId } : undefined,
          platform: "slack",
        });
      },
    });

    // Every block_actions click → decode to an opaque-id InteractionEvent and
    // hand to the sink. The matching `ck:` action either resolves an awaiting
    // HITL picker or dispatches via the ActionRegistry; unrelated clicks decode
    // to events the bot harmlessly ignores.
    this.app.action(/.*/, async ({ ack, body }) => {
      await ack();
      const evt = this.decodeInteraction(body);
      if (evt) await sink.onInteraction(evt);
    });

    // Socket Mode ignores the port; HTTP mode binds it.
    await this.app.start(this.opts.port ?? 0);
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  render(ir: IRNode[]) {
    return renderBlockKit(ir);
  }

  async post(target: BotReplyTarget, ir: IRNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const blocks = renderBlockKit(ir);
    const res = await this.client.chat.postMessage({
      channel: t.channel,
      thread_ts: t.threadTs,
      blocks,
      text: fallbackText(ir),
    });
    return { id: res.ts as string, channel: t.channel, ts: res.ts };
  }

  async update(ref: MessageRef, ir: IRNode[]): Promise<void> {
    const channel = channelOf(ref);
    await this.client.chat.update({
      channel,
      ts: ref.id,
      blocks: renderBlockKit(ir),
      text: fallbackText(ir),
    });
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstTs: string | undefined;
    let channel = t.channel;
    const stream = new ChunkedMessageStream({
      postPlaceholder: async (text) => {
        const posted = await this.client.chat.postMessage({
          channel: t.channel,
          thread_ts: t.threadTs,
          text,
        });
        if (!posted.ts) throw new Error("postMessage returned no ts");
        if (!firstTs) {
          firstTs = posted.ts;
          channel = posted.channel ?? t.channel;
        }
        return posted.ts;
      },
      updateAt: async (ts, text) => {
        await this.client.chat.update({ channel: t.channel, ts, text });
      },
      transform: (s) => markdownToMrkdwn(autoCloseOpenMarkdown(s)),
    });

    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    await stream.finish();

    return { id: firstTs ?? "", channel, ts: firstTs };
  }

  async delete(ref: MessageRef): Promise<void> {
    await this.client.chat.delete({ channel: channelOf(ref), ts: ref.id });
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    return createRunRenderer({
      client: this.client,
      target: target as ReplyTarget,
      interruptEventNames: this.opts.interruptEventNames,
      showToolStatus: this.opts.showToolStatus,
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    const query = q.query.trim().toLowerCase();
    if (!query) return undefined;
    try {
      let cursor: string | undefined;
      do {
        const r = (await this.client.users.list({ cursor, limit: 200 })) as {
          members?: Array<{
            id?: string;
            name?: string;
            real_name?: string;
            deleted?: boolean;
            is_bot?: boolean;
            profile?: { display_name?: string; email?: string };
          }>;
          response_metadata?: { next_cursor?: string };
        };
        for (const m of r.members ?? []) {
          if (!m.id || m.deleted || m.is_bot) continue;
          const candidates = [
            m.name,
            m.real_name,
            m.profile?.display_name,
            m.profile?.email,
          ]
            .filter((s): s is string => Boolean(s))
            .map((s) => s.toLowerCase());
          if (candidates.some((c) => c === query || c.startsWith(query))) {
            return {
              id: m.id,
              name: m.real_name ?? m.name,
              handle: m.name,
              email: m.profile?.email,
            };
          }
        }
        cursor = r.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch {
      return undefined;
    }
    return undefined;
  }

  get conversationStore(): ConversationStore {
    const store = this.store;
    return {
      async getOrCreate(
        conversationKey: string,
        replyTarget: BotReplyTarget,
        makeAgent: (threadId: string) => AbstractAgent,
      ): Promise<AgentSession> {
        const idx = conversationKey.indexOf("::");
        const channelId =
          idx >= 0 ? conversationKey.slice(0, idx) : conversationKey;
        const scope = idx >= 0 ? conversationKey.slice(idx + 2) : DM_SCOPE;
        const key: ConversationKey = { channelId, scope };
        const session = await store.getOrCreate(
          key,
          replyTarget as ReplyTarget,
          makeAgent as unknown as Parameters<
            SlackConversationStore["getOrCreate"]
          >[2],
        );
        return { agent: session.agent as unknown as AbstractAgent };
      },
    };
  }

  toolContext(replyTarget: BotReplyTarget): Record<string, unknown> {
    const t = replyTarget as ReplyTarget;
    const ctx: SlackToolContext = {
      client: this.client,
      channel: t.channel,
      threadTs: t.threadTs,
      botUserId: this.botUserId,
      postFile: async ({ bytes, filename, title, altText }) => {
        try {
          // Slack's `FilesUploadV2Arguments` union types `thread_ts` as a
          // required `string` when present; omit the key entirely (rather
          // than passing `undefined`) under exactOptionalPropertyTypes.
          const args: Record<string, unknown> = {
            channel_id: t.channel,
            file: Buffer.from(bytes),
            filename,
            title,
            alt_text: altText,
          };
          if (t.threadTs) args.thread_ts = t.threadTs;
          await this.client.files.uploadV2(
            args as unknown as Parameters<WebClient["files"]["uploadV2"]>[0],
          );
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    };
    return ctx as unknown as Record<string, unknown>;
  }
}

/** Construct a Slack `PlatformAdapter`. */
export function slack(opts: SlackAdapterOptions): SlackAdapter {
  return new SlackAdapter(opts);
}

/** Read the channel stashed on a MessageRef by `post`/`stream`. */
function channelOf(ref: MessageRef): string {
  const channel = (ref as { channel?: unknown }).channel;
  return typeof channel === "string" ? channel : "";
}

/**
 * Slack requires a plain-text `text` fallback alongside `blocks` (used for
 * notifications and a11y). Collect descendant text nodes; default to "…".
 */
function fallbackText(ir: IRNode[]): string {
  const acc: string[] = [];
  const visit = (node: IRNode): void => {
    if (typeof node.type === "string" && node.type === "text") {
      const value = node.props?.value;
      if (value != null) acc.push(String(value));
      return;
    }
    const children = node.props?.children;
    const list = Array.isArray(children)
      ? children
      : children && typeof children === "object" && "type" in children
        ? [children]
        : [];
    for (const child of list as IRNode[]) visit(child);
  };
  for (const node of ir) visit(node);
  const text = acc.join(" ").replace(/\s+/g, " ").trim();
  return text || "…";
}
