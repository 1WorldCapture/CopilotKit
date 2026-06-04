# @copilotkit/bot

The **platform-agnostic bot engine**. It owns everything between an incoming
message and a rendered reply — handler registration, the agent
run/tool/interrupt loop, JSX action binding, and the `PlatformAdapter`
contract — without knowing anything about Slack (or any other surface). A
platform adapter plugs in at the boundary; `@copilotkit/bot-slack` is the
concrete Slack one.

It builds on `@copilotkit/bot-ui` (the JSX runtime + component vocabulary,
re-exported from here for convenience) and AG-UI (`@ag-ui/client`,
`@ag-ui/core`).

## Install

```sh
pnpm add @copilotkit/bot @copilotkit/bot-ui
# plus a platform adapter, e.g.
pnpm add @copilotkit/bot-slack
```

## Quickstart

```ts
import { createBot } from "@copilotkit/bot";
import { slack } from "@copilotkit/bot-slack"; // a concrete PlatformAdapter

const bot = createBot({
  adapters: [slack({ botToken, appToken })],
  agent: (threadId) => makeAgent(threadId), // AbstractAgent or (threadId) => AbstractAgent
  tools: [...myTools], // BotTool[] forwarded on every runAgent
  context: [...myContext], // ContextEntry[] forwarded on every runAgent
});

bot.onMention(({ thread }) => thread.runAgent());
bot.onMessage(({ thread }) => thread.runAgent());

await bot.start();
```

`createBot(opts)` returns a `Bot`:

- `onMention(handler)` / `onMessage(handler)` — turn handlers receiving
  `{ thread, message }`. (Routing is mention-preferred: if any mention
  handler is registered, all turns route to it; otherwise message handlers
  fire.)
- `onInteraction(id, handler)` — explicit escape-hatch handler for a known
  action id, bypassing the registry.
- `onInterrupt(eventName, handler)` — handle a captured agent interrupt
  (LangGraph-style `on_interrupt`); receives `{ payload, thread }`.
- `tool(t)` — register a `BotTool` (alternative to `opts.tools`); must be
  added before `start()`.
- `start()` / `stop()` — bring adapters up / down.

`agent` is optional. If omitted, calling `thread.runAgent()` throws; supply
an `AbstractAgent` or a `(threadId) => AbstractAgent` factory.

## `Thread`

A `Thread` is the per-conversation handle handed to your handlers and tool
contexts. It accepts any `Renderable` (JSX or a string) for posting.

```ts
interface Thread {
  readonly platform: string;
  post(ui: Renderable): Promise<MessageRef>;
  update(ref: MessageRef, ui: Renderable): Promise<MessageRef>;
  delete(ref: MessageRef): Promise<void>;
  stream(src: string | AsyncIterable<string>): Promise<MessageRef>;
  runAgent(input?: { context?: ContextEntry[]; tools?: BotTool[] }): Promise<MessageRef | undefined>;
  resume(value: unknown): Promise<MessageRef | undefined>;
  awaitChoice(ui: Renderable): Promise<unknown>;
}
```

- `post` / `update` render the JSX to IR, **bind** every event-prop handler
  in the tree (mint a content-stable id, snapshot it, rewrite the prop to
  `{ id }`), then hand the IR to the adapter.
- `runAgent` resolves the conversation's agent session, creates the adapter's
  `RunRenderer`, and drives the run/tool/interrupt loop. Per-run `tools` /
  `context` are merged on top of the bot-level defaults for that run only.
- `resume(value)` re-enters a paused interrupt run with
  `forwardedProps.command`.
- `awaitChoice(ui)` posts a picker and blocks until an interaction in this
  conversation resolves it to the clicked control's value (HITL).

## Tools & context

A `BotTool` is forwarded to the agent as a frontend tool; its handler runs in
the bot when the agent calls it. The handler `ctx` carries the `thread`, so a
tool can render JSX (`ctx.thread.post(<Card .../>)`) or run the agent further.

```ts
interface BotTool<Schema extends ObjectSchema = ObjectSchema, Extra = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Schema; // any Standard Schema (Zod/Valibot/ArkType/…)
  handler(args, ctx: BotToolContext<Extra> & Extra): Promise<unknown> | unknown;
}
```

`parameters` (a Standard Schema) is converted to JSON Schema for the LLM and
validated on the way back. `BotToolContext` is `{ thread, message?, user?,
signal?, platform }`; an adapter contributes `Extra` (its
`PlatformToolContext`) for the turn. `AnyBotTool` is the loosely-typed alias
used when collecting tools from multiple adapters.

A `ContextEntry` is `{ description: string; value: string }` — knowledge
folded into the agent's system context on each `runAgent`.

## ActionStore

Inline JSX handlers are bound by content. Each interactive node gets a
**content-stable, opaque** minted id — `mintId(componentName, path, props)`
= `"ck:" + sha1(name | path | stableStringify(props)).slice(0,16)`. Only the
opaque id (plus any small `bind()` args) is stamped on the native token; no
props, PII, or secrets go over the wire.

On a click, the `ActionRegistry` resolves the handler from a hot in-memory
cache; on a miss it **rehydrates** by loading the snapshot from the
`ActionStore`, re-rendering the named component with the frozen props, and
re-walking to the handler's path.

The default `ActionStore` is `InMemoryActionStore` (a `Map` with optional
TTL). It is lost on restart: after a restart an old button click degrades to
an `ActionExpiredError` ("this action expired"), which `createBot` swallows.
**Durable actions require an external store (Redis / DB) — not shipped in
v1.** Implement the `ActionStore` interface (`put` / `get` / `delete`) and
pass it as `actionStore` to make actions survive restarts.

## Writing a `PlatformAdapter`

To target a new surface, implement `PlatformAdapter` from this package. The
engine drives ingress through the `IngressSink` you receive in `start(sink)`
(`sink.onTurn(IncomingTurn)` / `sink.onInteraction(InteractionEvent)`) and
egress through your `post` / `update` / `stream` / `delete` (which receive
`IRNode[]` to translate to a native payload via `render`). You also provide
`createRunRenderer(target)` (an AG-UI `RunRenderer`: the subscriber to stream
into, plus accessors for captured tool calls and interrupts that the run-loop
reads after each `runAgent`), `decodeInteraction(raw)` (native event → opaque
`InteractionEvent`), `lookupUser`, a `conversationStore`
(`getOrCreate` → `AgentSession`), the surface `capabilities` /
`ackDeadlineMs`, and an optional `toolContext(replyTarget)` whose fields are
merged into every tool-call `ctx`. See `@copilotkit/bot-slack` for a complete
implementation.

## Exports

`createBot`, `Bot`, `CreateBotOptions`, `BotHandler`; `Thread`; the
`PlatformAdapter` boundary types (`RunRenderer`, `IngressSink`,
`IncomingTurn`, `InteractionEvent`, `SurfaceCapabilities`, `ReplyTarget`,
`ConversationStore`, `AgentSession`, `CapturedToolCall`, `CapturedInterrupt`,
`UserQuery`); `ActionStore` / `InMemoryActionStore` / `ActionSnapshot` /
`ActionRegistry` / `ActionExpiredError`; `BotTool` / `AnyBotTool` /
`BotToolContext` / `PlatformToolContext` / `ContextEntry` /
`AgentToolDescriptor` / `ObjectSchema` and the tool helpers
(`toAgentToolDescriptors`, `parseToolArgs`, `stringifyHandlerResult`);
`mintId` / `stableStringify`; `runAgentLoop`; plus the re-exported
`@copilotkit/bot-ui` vocabulary.
