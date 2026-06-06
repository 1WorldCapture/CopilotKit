## Why

SSE runtimes can use production-capable runners such as `SqliteAgentRunner` for chat execution history, but `useThreads` only works against CopilotKit Intelligence or the local-dev `InMemoryAgentRunner` fallback. This blocks self-hosted production apps from using the official thread list and inspector flows without adopting the managed Intelligence platform.

## What Changes

- Add an optional thread backend extension point for SSE runtimes.
- Route `/threads` REST endpoints to the configured thread backend when Intelligence is not enabled.
- Keep chat run/connect/stop behavior on the existing `AgentRunner` abstraction.
- Provide a SQLite-backed thread backend that can power `useThreads` in self-hosted production deployments.
- Preserve existing Intelligence behavior and the current in-memory local-dev fallback.
- Publish only the modified CopilotKit packages from the fork with compatible package names and internal version suffixes.

## Capabilities

### New Capabilities

- `sse-thread-backend`: Defines the self-hosted thread backend contract and runtime routing behavior for SSE runtimes.

### Modified Capabilities

None.

## Impact

- Runtime API: adds an optional `threadBackend` option to SSE runtime configuration.
- Runtime handlers: changes `/threads` dispatch to prefer Intelligence, then configured thread backend, then in-memory fallback.
- SQLite support: adds durable thread metadata and query/mutation behavior needed by `useThreads`.
- Frontend contract: `useThreads` continues to call the same runtime endpoints; no app-facing hook API change is required.
- Packaging: modified packages are expected to be published from the fork with internal prerelease versions and consumed via package manager overrides or an internal registry.
