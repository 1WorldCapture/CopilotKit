# CopilotKit Threads (React)

This skill builds on `copilotkit/agent-access`. Durable threads work in:

- Intelligence mode — a runtime pointed at `api.cloud.copilotkit.ai` or a
  self-managed Intelligence instance.
- Self-hosted SSE mode when the runtime is configured with a `threadBackend`
  such as `SqliteThreadBackend`.

Plain SSE mode without a configured thread backend still falls back to the
in-memory local-dev path only.

## Setup

```tsx
"use client";
import { useThreads } from "@copilotkit/react-core/v2";

export function ThreadSidebar({ agentId }: { agentId: string }) {
  const {
    threads,
    isLoading,
    error,
    hasMoreThreads,
    fetchMoreThreads,
    renameThread,
    archiveThread,
    deleteThread,
  } = useThreads({ agentId });

  if (error) return <div className="text-red-500">{error.message}</div>;
  if (isLoading) return <div>Loading threads…</div>;

  return (
    <ul className="space-y-1">
      {threads.map((t) => (
        <li key={t.id} className="flex gap-2">
          <span>{t.name ?? "Untitled"}</span>
          <button onClick={() => renameThread(t.id, "Renamed")}>Rename</button>
          <button onClick={() => archiveThread(t.id)}>Archive</button>
        </li>
      ))}
      {hasMoreThreads && <button onClick={fetchMoreThreads}>Load more</button>}
    </ul>
  );
}
```

## Core Patterns

### Self-hosted SSE runtime with SQLite thread storage

```ts
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import {
  SqliteAgentRunner,
  SqliteThreadBackend,
} from "@copilotkit/sqlite-runner";

const dbPath = "/data/copilotkit.sqlite";

const runtime = new CopilotRuntime({
  agents,
  runner: new SqliteAgentRunner({ dbPath }),
  threadBackend: new SqliteThreadBackend({ dbPath }),
});
```

`useThreads` continues to use the same REST contract in this setup. There is
no realtime thread-metadata websocket in the SQLite path, so list/mutation
flows work over HTTP and refresh on the next fetch or mutation result.

### Paginated list

```tsx
const { threads, hasMoreThreads, fetchMoreThreads, isFetchingMoreThreads } =
  useThreads({ agentId: "default", limit: 25 });
```

### Include archived threads

```tsx
const { threads: archived } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

### Optimistic archive with error rollback

```tsx
const { threads, archiveThread } = useThreads({ agentId: "default" });

async function onArchive(id: string) {
  try {
    await archiveThread(id);
    toast.success("Archived");
  } catch (err) {
    toast.error(`Failed to archive: ${String(err)}`);
  }
}
```

### Thread-switcher + `<CopilotChat>`

```tsx
import { CopilotChat, useThreads } from "@copilotkit/react-core/v2";
import { useState } from "react";

export function ThreadSwitcher() {
  const { threads } = useThreads({ agentId: "default" });
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-[200px_1fr]">
      <ul>
        {threads.map((t) => (
          <li key={t.id}>
            <button onClick={() => setActiveId(t.id)}>
              {t.name ?? "Untitled"}
            </button>
          </li>
        ))}
      </ul>
      {activeId && (
        <CopilotChat key={activeId} agentId="default" threadId={activeId} />
      )}
    </div>
  );
}
```

## Common Mistakes

### HIGH — Using `useThreads` with plain SSE and no thread backend

Wrong:

```tsx
// Runtime has no Intelligence and no thread backend configured
new CopilotRuntime({ agents });

// Client side:
const { threads, error } = useThreads({ agentId: "default" });
// error: "Runtime URL is not configured" or empty list forever
```

Correct:

```ts
// Server — either upgrade to Intelligence mode:
import {
  CopilotIntelligenceRuntime,
  CopilotKitIntelligence,
} from "@copilotkit/runtime/v2";

const intelligence = new CopilotKitIntelligence({
  apiUrl: process.env.COPILOTKIT_INTELLIGENCE_API_URL!,
  wsUrl: process.env.COPILOTKIT_INTELLIGENCE_WS_URL!,
  apiKey: process.env.COPILOTKIT_INTELLIGENCE_API_KEY!,
  organizationId: process.env.COPILOTKIT_ORG_ID!,
});

const runtime = new CopilotIntelligenceRuntime({
  agents,
  intelligence,
  identifyUser: async (req) => ({ userId: await getUserId(req) }),
});
```

Or:

```ts
// Server — stay on SSE and add a durable thread backend:
import { CopilotRuntime } from "@copilotkit/runtime/v2";
import {
  SqliteAgentRunner,
  SqliteThreadBackend,
} from "@copilotkit/sqlite-runner";

const dbPath = "/data/copilotkit.sqlite";

const runtime = new CopilotRuntime({
  agents,
  runner: new SqliteAgentRunner({ dbPath }),
  threadBackend: new SqliteThreadBackend({ dbPath }),
});
```

Plain SSE without a thread backend cannot serve durable `/threads` data. Add
Intelligence or configure a self-hosted backend such as SQLite.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:207-213,229`

### HIGH — Deploying SQLite thread storage to a multi-writer fleet

Wrong:

```ts
// Multiple stateless app replicas, each with its own local filesystem.
const dbPath = "/tmp/copilotkit.sqlite";
```

Correct:

```ts
// Single writer, or a shared volume with the same SQLite file visible to
// the runtime and the thread backend.
const dbPath = "/data/copilotkit.sqlite";
```

`SqliteAgentRunner` and `SqliteThreadBackend` assume one logical SQLite
database. Use a single writer or a shared-volume deployment; do not expect
independent per-instance local files to converge.

### MEDIUM — Forgetting package overrides when consuming a forked prerelease

Example `pnpm` override:

```json
{
  "pnpm": {
    "overrides": {
      "@copilotkit/runtime": "npm:@your-scope/runtime@1.59.5-internal-sse-thread.0",
      "@copilotkit/sqlite-runner": "npm:@your-scope/sqlite-runner@1.59.5-internal-sse-thread.0"
    }
  }
}
```

Example `npm` override:

```json
{
  "overrides": {
    "@copilotkit/runtime": "npm:@your-scope/runtime@1.59.5-internal-sse-thread.0",
    "@copilotkit/sqlite-runner": "npm:@your-scope/sqlite-runner@1.59.5-internal-sse-thread.0"
  }
}
```

### HIGH — Expecting `deleteThread` to be recoverable

Wrong:

```tsx
await deleteThread(id); // user expected a trash bin
```

Correct:

```tsx
// For soft-delete UX, use archive:
await archiveThread(id);

// Then expose archived threads in a separate view:
const { threads: archived } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

`deleteThread` is irreversible at the Intelligence platform level. Use
`archiveThread` for user-facing delete UX and only call `deleteThread` for
genuine "permanently erase" flows.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:101-105`

### MEDIUM — Assuming archived threads appear by default

Wrong:

```tsx
const { threads } = useThreads({ agentId: "default" });
// User archived a thread. User opens the "Archived" tab. It's empty.
```

Correct:

```tsx
const { threads: activeThreads } = useThreads({ agentId: "default" });
const { threads: archivedThreads } = useThreads({
  agentId: "default",
  includeArchived: true,
});
```

`includeArchived` defaults to `false`. Archived threads are filtered out of
the default list; opt in explicitly for an archived-view tab.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:60-62`

### MEDIUM — Not handling `error`

Wrong:

```tsx
const { threads } = useThreads({ agentId: "default" });
return <ul>{threads.map(...)}</ul>;
// Silent failures — handshake errors, network errors all vanish.
```

Correct:

```tsx
const { threads, isLoading, error } = useThreads({ agentId: "default" });
if (error) return <ErrorBanner message={error.message} />;
if (isLoading) return <Spinner />;
return <ul>{threads.map(...)}</ul>;
```

`error` holds the most recent fetch/mutation error until the next
successful fetch clears it. Surface it or you'll miss Intelligence-mode
mis-configuration.

Source: `packages/react-core/src/v2/hooks/use-threads.tsx:70-74`
