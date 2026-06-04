import { describe, it, expect } from "vitest";
import { createBot } from "./create-bot.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { Section, Actions, Button } from "@copilotkit/bot-ui";
import type { IRNode } from "@copilotkit/bot-ui";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Recursively find the first node of a given type in an IR tree. */
function findNode(nodes: IRNode[], type: string): IRNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n;
    const children = n.props.children;
    if (Array.isArray(children)) {
      const found = findNode(children as IRNode[], type);
      if (found) return found;
    }
  }
  return undefined;
}

/** Concatenate all text node values in an IR tree. */
function collectText(nodes: IRNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text" && typeof n.props.value === "string") out += n.props.value;
    const children = n.props.children;
    if (Array.isArray(children)) out += collectText(children as IRNode[]);
  }
  return out;
}

describe("createBot", () => {
  it("routes a mention to a handler that posts UI", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    bot.onMention(async ({ thread }) => {
      await thread.post(Section({ children: "hi" }));
    });

    await bot.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    expect(fake.posted.length).toBe(1);
    const ir = fake.posted[0]!;
    expect(findNode(ir, "section")).toBeDefined();
    expect(collectText(ir)).toBe("hi");
  });

  it("dispatches a bound onClick handler on interaction", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let clicked = false;
    bot.onMention(async ({ thread }) => {
      await thread.post(
        Actions({
          children: [
            Button({
              value: { ok: 1 },
              onClick: () => {
                clicked = true;
              },
              children: "Go",
            }),
          ],
        }),
      );
    });

    await bot.start();
    fake.emitTurn({ userText: "yo", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;
    expect(typeof id).toBe("string");

    fake.emitInteraction({ id, conversationKey: "c1", value: { ok: 1 } });
    await tick();

    expect(clicked).toBe(true);
  });

  it("resolves awaitChoice when a matching interaction arrives", async () => {
    const fake = new FakeAdapter();
    const agent = new FakeAgent();
    const bot = createBot({ adapters: [fake], agent: () => agent });

    let choicePromise: Promise<unknown> | undefined;
    bot.onMention(async ({ thread }) => {
      choicePromise = thread.awaitChoice(
        Actions({
          children: [
            Button({
              value: { confirmed: true },
              onClick: () => {},
              children: "Confirm",
            }),
          ],
        }),
      );
    });

    await bot.start();
    fake.emitTurn({ userText: "decide", conversationKey: "c1" });
    await tick();

    const button = findNode(fake.posted[0]!, "button")!;
    const id = (button.props.onClick as { id: string }).id;

    fake.emitInteraction({ id, conversationKey: "c1", value: { confirmed: true } });
    await tick();

    expect(choicePromise).toBeDefined();
    await expect(choicePromise!).resolves.toEqual({ confirmed: true });
  });
});
