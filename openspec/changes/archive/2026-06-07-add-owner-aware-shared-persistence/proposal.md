## Why

Authenticated CopilotKit applications need to isolate thread, run, and state data by owner even when they share a single persistence database. Today, self-hosted SSE runtimes and `@copilotkit/sqlite-runner` do not have a built-in way to resolve owner identity from authenticated requests and enforce owner-aware reads and writes, which pushes security-sensitive persistence logic into each application.

## What Changes

- Add owner-aware shared persistence support to the SSE runtime and `@copilotkit/sqlite-runner`.
- Introduce a runtime-level ownership configuration that resolves owner identity from the incoming authenticated request instead of requiring the frontend to send owner information in the payload.
- Extend SSE runtime request handling so owner context is passed through `AgentRunner` and `ThreadBackend` operations.
- Persist owner metadata for SQLite-backed thread metadata, run history, and run state, and enforce owner-aware filtering according to a configurable ownership mode.
- Preserve backward compatibility for existing self-hosted runtimes by keeping ownership enforcement disabled unless explicitly configured.

## Capabilities

### New Capabilities

- `owner-aware-persistence`: Resolve owner identity server-side and enforce shared-database owner isolation for SSE runtime persistence.

### Modified Capabilities

- `sse-thread-backend`: Thread backend and SQLite-backed thread inspection/mutation requirements now include owner-aware access control and owner-scoped persistence behavior.

## Impact

- Affected packages: `packages/runtime`, `packages/sqlite-runner`
- Affected APIs: SSE runtime configuration, `AgentRunner` request contract, `ThreadBackend` request contract
- Affected persistence: SQLite `thread_metadata`, `agent_runs`, and `run_state` tables and related query behavior
- Compatibility: Existing self-hosted SSE runtimes remain supported through a disabled-by-default ownership mode
