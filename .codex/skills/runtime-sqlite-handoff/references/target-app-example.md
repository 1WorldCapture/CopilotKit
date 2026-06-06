# Target App Example

Use this reference when wiring a downstream app to the forked runtime packages.
The concrete example below matches the validated Next.js plus LangGraph setup
used during development.

## Direct tarball dependencies

```json
{
  "dependencies": {
    "@copilotkit/runtime": "file:.local-packages/copilotkit-runtime-1.59.5.tgz",
    "@copilotkit/sqlite-runner": "file:.local-packages/copilotkit-sqlite-runner-1.59.5.tgz"
  }
}
```

Keep the filenames stable when you refresh tarballs. Overwrite the existing
files and reinstall instead of adding new suffixes.

## Optional overrides

Use these when the target app also consumes the same packages transitively and
everything must resolve to the fork.

### `pnpm`

```json
{
  "pnpm": {
    "overrides": {
      "@copilotkit/runtime": "file:.local-packages/copilotkit-runtime-1.59.5.tgz",
      "@copilotkit/sqlite-runner": "file:.local-packages/copilotkit-sqlite-runner-1.59.5.tgz"
    }
  }
}
```

### `npm`

```json
{
  "overrides": {
    "@copilotkit/runtime": "file:.local-packages/copilotkit-runtime-1.59.5.tgz",
    "@copilotkit/sqlite-runner": "file:.local-packages/copilotkit-sqlite-runner-1.59.5.tgz"
  }
}
```

## Next.js route wiring

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import {
  SqliteAgentRunner,
  SqliteThreadBackend,
} from "@copilotkit/sqlite-runner";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runtimeDataDir = join(process.cwd(), ".data");
mkdirSync(runtimeDataDir, { recursive: true });

const threadDbPath =
  process.env.COPILOTKIT_SQLITE_PATH ??
  join(runtimeDataDir, "copilotkit-runtime.sqlite");

const deepAgent = new LangGraphAgent({
  deploymentUrl: process.env.LANGGRAPH_URL ?? "http://localhost:8000",
  graphId: process.env.LANGGRAPH_GRAPH_ID ?? "deep_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY,
});

const runtimeInstance = new CopilotRuntime({
  agents: {
    deep_agent: deepAgent,
  },
  runner: new SqliteAgentRunner({ dbPath: threadDbPath }),
  threadBackend: new SqliteThreadBackend({ dbPath: threadDbPath }),
});

const handler = createCopilotRuntimeHandler({
  runtime: runtimeInstance,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

## Important notes

- `SqliteAgentRunner` handles chat execution. `SqliteThreadBackend` handles the
  `/threads` REST contract.
- Both must use the same SQLite file.
- `PATCH` and `DELETE` exports are required in Next App Router if the frontend
  will rename or delete threads.
- A downstream `.env.example` should usually expose `COPILOTKIT_SQLITE_PATH` so
  the data location is explicit.
