import { describe, it, expect, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";
import type { IRNode } from "@copilotkit/bot-ui";
import type { InteractionEvent, IngressSink } from "@copilotkit/bot";

/**
 * Build an adapter with a mock Slack client injected. Constructing the real
 * Bolt `App` is side-effect-free (Socket Mode doesn't connect until `start()`),
 * but we never call `start()` here — every test drives the pure-ish egress and
 * decode methods against a fake `client`.
 */
function makeAdapter() {
  const chat = {
    postMessage: vi.fn(async (_arg: Record<string, unknown>) => ({
      ts: "200.5",
      channel: "C1",
    })),
    update: vi.fn(async (_arg: Record<string, unknown>) => ({})),
    delete: vi.fn(async (_arg: Record<string, unknown>) => ({})),
  };
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  (adapter as unknown as { client: unknown }).client = { chat };
  (adapter as unknown as { botUserId: string }).botUserId = "UBOT";
  return { adapter, chat };
}

const section = (text: string): IRNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("SlackAdapter.post", () => {
  it("posts blocks + fallback text to the target channel/thread and returns a MessageRef", async () => {
    const { adapter, chat } = makeAdapter();
    const ref = await adapter.post(
      { channel: "C1", threadTs: "100.0" },
      [section("hi")],
    );

    expect(chat.postMessage).toHaveBeenCalledTimes(1);
    const arg = chat.postMessage.mock.calls[0]![0] as {
      channel: string;
      thread_ts?: string;
      blocks: Array<{ type: string }>;
      text: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.thread_ts).toBe("100.0");
    expect(arg.text).toBe("hi");
    expect(arg.blocks).toHaveLength(1);
    expect(arg.blocks[0]!.type).toBe("section");
    expect(arg.blocks.length).toBeLessThanOrEqual(50); // budget-clamped

    expect(ref.id).toBe("200.5");
    expect((ref as { channel?: string }).channel).toBe("C1");
  });

  it("wraps a <Message accent> in a colored attachment instead of top-level blocks", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.post({ channel: "C1" }, [
      {
        type: "message",
        props: { accent: "#27AE60", children: [section("ok")] },
      },
    ]);

    const arg = chat.postMessage.mock.calls[0]![0] as {
      blocks?: unknown;
      attachments?: Array<{ color: string; blocks: Array<{ type: string }> }>;
    };
    expect(arg.blocks).toBeUndefined();
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments![0]!.color).toBe("#27AE60");
    expect(arg.attachments![0]!.blocks).toHaveLength(1);
    expect(arg.attachments![0]!.blocks[0]!.type).toBe("section");
  });

  it("defaults fallback text to … when the IR has no text", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.post({ channel: "C1" }, [{ type: "divider", props: {} }]);
    const arg = chat.postMessage.mock.calls[0]![0] as { text: string };
    expect(arg.text).toBe("…");
  });
});

describe("SlackAdapter.update / delete use the stashed channel", () => {
  it("update edits the message at ref.id on its channel", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.update(
      { id: "200.5", channel: "C1" },
      [section("edited")],
    );
    const arg = chat.update.mock.calls[0]![0] as {
      channel: string;
      ts: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("200.5");
  });

  it("delete removes the message at ref.id on its channel", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.delete({ id: "200.5", channel: "C1" });
    const arg = chat.delete.mock.calls[0]![0] as {
      channel: string;
      ts: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("200.5");
  });
});

describe("SlackAdapter.decodeInteraction", () => {
  it("decodes a block_actions payload to an opaque-id InteractionEvent", () => {
    const { adapter } = makeAdapter();
    const evt = adapter.decodeInteraction({
      type: "block_actions",
      channel: { id: "C1" },
      message: { ts: "1", thread_ts: "100.0" },
      actions: [{ action_id: "ck:z", value: '{"ok":1}' }],
    });
    expect(evt).toBeDefined();
    expect(evt!.id).toBe("ck:z");
    expect(evt!.value).toEqual({ ok: 1 });
    expect(evt!.conversationKey).toBe("C1::100.0");
  });
});

describe("SlackAdapter.toolContext", () => {
  it("returns a SlackToolContext carrying client/channel/botUserId/postFile", () => {
    const { adapter } = makeAdapter();
    const ctx = adapter.toolContext({ channel: "C1", threadTs: "100.0" }) as {
      client: unknown;
      channel: string;
      botUserId: string;
      postFile: unknown;
    };
    expect(ctx.client).toBeDefined();
    expect(ctx.channel).toBe("C1");
    expect(ctx.botUserId).toBe("UBOT");
    expect(typeof ctx.postFile).toBe("function");
  });
});

describe("SlackAdapter.capabilities / ackDeadlineMs", () => {
  it("reports the Slack surface capabilities", () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.supportsTyping).toBe(false);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.maxBlocksPerMessage).toBe(50);
    expect(adapter.ackDeadlineMs).toBe(3000);
    expect(adapter.platform).toBe("slack");
  });
});

describe("SlackAdapter.resolveUser", () => {
  it("resolves a sender id to a richer PlatformUser (name + email) and caches it", async () => {
    const { adapter } = makeAdapter();
    const info = vi.fn(async (_arg: { user: string }) => ({
      user: {
        id: "U1",
        name: "ana",
        real_name: "Ana Smith",
        profile: { real_name: "Ana Smith", email: "ana@example.com" },
      },
    }));
    (adapter as unknown as { client: { users: unknown } }).client = {
      users: { info },
    };

    const u = await adapter.resolveUser("U1");
    expect(u).toEqual({ id: "U1", name: "Ana Smith", email: "ana@example.com" });

    // Second call is served from cache (no extra users.info call).
    const u2 = await adapter.resolveUser("U1");
    expect(u2).toEqual(u);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("falls back to a bare { id } when users.info fails", async () => {
    const { adapter } = makeAdapter();
    const info = vi.fn(async () => {
      throw new Error("not_found");
    });
    (adapter as unknown as { client: { users: unknown } }).client = {
      users: { info },
    };

    const u = await adapter.resolveUser("U2");
    expect(u).toEqual({ id: "U2" });
  });
});

describe("SlackAdapter action wiring", () => {
  it("decodes a captured block_actions body and forwards to sink.onInteraction", async () => {
    const { adapter } = makeAdapter();

    // Capture the handler Bolt would register, without starting sockets.
    let actionHandler:
      | ((args: {
          ack: () => Promise<void>;
          body: unknown;
        }) => Promise<void>)
      | undefined;
    const app = {
      action: vi.fn((_matcher: unknown, handler: typeof actionHandler) => {
        actionHandler = handler;
      }),
      start: vi.fn(async () => {}),
    };
    (adapter as unknown as { app: unknown }).app = app;
    // auth.test is awaited in start(); attachSlackListener reads app.event etc.
    (adapter as unknown as { client: { auth: unknown } }).client = {
      ...(adapter as unknown as { client: object }).client,
      auth: { test: vi.fn(async () => ({ user_id: "UBOT" })) },
    } as never;
    // attachSlackListener calls app.command/event/message — stub them.
    Object.assign(app, {
      command: vi.fn(),
      event: vi.fn(),
      message: vi.fn(),
    });

    const received: InteractionEvent[] = [];
    const sink: IngressSink = {
      onTurn: vi.fn(),
      onInteraction: (evt) => {
        received.push(evt);
      },
    };
    await adapter.start(sink);

    expect(actionHandler).toBeDefined();
    const ack = vi.fn(async () => {});
    await actionHandler!({
      ack,
      body: {
        type: "block_actions",
        channel: { id: "C1" },
        message: { ts: "1", thread_ts: "100.0" },
        actions: [{ action_id: "ck:z", value: '{"ok":1}' }],
      },
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe("ck:z");
    expect(received[0]!.conversationKey).toBe("C1::100.0");
  });
});
