# @copilotkit/bot-ui

A pure **JSX runtime + intermediate representation (IR) + cross-platform
component vocabulary** for authoring rich bot messages. No React, no agent
runtime, no Slack — `@copilotkit/bot-ui` depends on nothing in the repo
except `@copilotkit/shared` (for `StandardSchemaV1` types). That's what lets
a platform adapter (e.g. `@copilotkit/bot-slack`) translate the same UI into
Block Kit, while keeping the component layer tree-shakeable and testable in
isolation.

You author UI as JSX, it normalizes to one serializable IR (`IRNode[]`), and
behavior props (`onClick` / `onSelect` / `onSubmit`) ride along on the nodes
for the engine (`@copilotkit/bot`) to bind.

## Install

```sh
pnpm add @copilotkit/bot-ui
```

To author components as JSX, point the TypeScript JSX factory at this package
in the consuming project's `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@copilotkit/bot-ui"
  }
}
```

This package ships `@copilotkit/bot-ui/jsx-runtime` (and
`/jsx-dev-runtime`) exporting `jsx` / `jsxs` / `Fragment`. Author component
files as `.tsx`.

## Example

```tsx
import { Message, Header, Section, Actions, Button, renderToIR } from "@copilotkit/bot-ui";

function Greeting({ name }: { name: string }) {
  return (
    <Message>
      <Header>Hello {name}</Header>
      <Section>Pick an option — **bold** and `code` work too.</Section>
      <Actions>
        <Button style="primary" onClick={(ctx) => ctx.thread.post("you clicked!")}>
          Continue
        </Button>
      </Actions>
    </Message>
  );
}

const ir = renderToIR(<Greeting name="Ada" />);
// ir is IRNode[] — hand it to an adapter, or let @copilotkit/bot post it.
```

`renderToIR(ui: Renderable): IRNode[]` recursively invokes any component
function (passing its props) until only intrinsic string-typed nodes remain;
strings in children become `{ type: "text", props: { value } }`; `Fragment`
flattens its children. Components must be **pure functions of serializable
props** — same props in, same tree out — which is what makes content-stable
action binding and re-render rehydration possible in `@copilotkit/bot`.

`Renderable` also accepts a `{ raw }` escape hatch, which `renderToIR` passes
through as `{ type: "raw", props: { value } }` for adapters that want to
short-circuit to a native payload.

## Component vocabulary

Each component is a thin function returning an `IRNode` with a stable
intrinsic `type` string. An adapter maps these to native primitives.

| Component  | Purpose                                                            |
| ---------- | ----------------------------------------------------------------- |
| `Message`  | Root container for a single posted message.                       |
| `Header`   | Bold header / title row.                                          |
| `Section`  | A block of (markdown) body text.                                  |
| `Markdown` | Explicit markdown text block.                                     |
| `Field`    | One label/value cell inside `Fields`.                             |
| `Fields`   | A grid of `Field`s (two-column key/value layout).                 |
| `Context`  | Small, muted secondary text (footnotes, metadata).                |
| `Actions`  | Row container for interactive controls.                           |
| `Button`   | Clickable button — `onClick`, `value`, `style: "primary"|"danger"`. |
| `Select`   | Dropdown — `onSelect`, `placeholder`, `options: {label,value}[]`.  |
| `Input`    | Text input — `onSubmit`, `placeholder`, `multiline`, `name`.       |
| `Image`    | An image block.                                                    |
| `Divider`  | A horizontal rule.                                                 |

### Behavior props

Interactive components carry handler props typed as `ClickHandler`:

- `Button` → `onClick`
- `Select` → `onSelect`
- `Input` → `onSubmit`

A `ClickHandler` receives an `InteractionContext`:

```ts
type ClickHandler = (ctx: InteractionContext) => void | Promise<void>;

interface InteractionContext {
  thread: Thread;
  message: IncomingMessage;
  action: { id: string; value?: unknown };
  values: Record<string, unknown>;
  user: PlatformUser;
  platform: string;
}
```

The structural types `Thread`, `IncomingMessage`, `PlatformUser`,
`MessageRef`, and `ClickHandler` are declared here for handler typing only —
they're implemented at runtime by `@copilotkit/bot` and its adapters.
`@copilotkit/bot-ui` has no runtime dependency on them.

## `bind()` — the Tier-2 escape hatch

Inline `onClick` handlers are bound by content (component identity + path +
serializable props), so a handler can be re-derived after a restart by
re-rendering the component. When a handler closes over data that **can't** be
reconstructed from props, wrap it with `bind()` so the engine persists that
small payload explicitly alongside the minted action id:

```tsx
import { bind } from "@copilotkit/bot-ui";

<Button onClick={bind(handleChoice, { choiceId: "abc123" })}>Choose</Button>;
```

`bind(handler, args)` returns a tagged handler; the action registry stores
`args` so a cold-path dispatch passes them back via `ctx.action.value`. Keep
`args` small — it's the only handler-specific state that survives a restart.

## Exports

Runtime: `renderToIR`, `Fragment`, `bind`, and the vocabulary
(`Message`, `Header`, `Section`, `Markdown`, `Field`, `Fields`, `Context`,
`Actions`, `Button`, `Select`, `Input`, `Image`, `Divider`).
Types: `IRNode`, `ComponentFn`, `Renderable`, `Thread`, `InteractionContext`,
`PlatformUser`, `IncomingMessage`, `MessageRef`, `ClickHandler`.
