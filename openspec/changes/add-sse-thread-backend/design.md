## Context

`AgentRunner` currently owns chat execution flow through `run`, `connect`, `isRunning`, and `stop`. `CopilotSseRuntime` uses the configured runner for `/agent/:agentId/*` endpoints, while `CopilotIntelligenceRuntime` auto-wires `IntelligenceAgentRunner` for runner websocket ingestion.

Thread management is separate in practice. The runtime exposes `/threads` endpoints to the frontend, but those handlers currently route only to `CopilotKitIntelligence` in Intelligence mode or to `InMemoryAgentRunner` local-dev helper methods. `SqliteAgentRunner` persists run events and can replay chat history, but it does not implement thread metadata, mutations, pagination, or the `useThreads` REST contract.

The target deployment model is a forked CopilotKit build where only changed packages are published internally. The design should minimize divergence from upstream and preserve the existing chat/run implementation.

## Goals / Non-Goals

**Goals:**

- Add a self-hosted production path for `useThreads` on SSE runtimes.
- Keep the existing `AgentRunner` contract focused on chat execution.
- Avoid duplicating `CopilotSseRuntime` or fork-only chat/run handler logic.
- Preserve Intelligence mode behavior and the in-memory local-dev fallback.
- Provide a SQLite implementation suitable for single-writer or single-instance production deployments.
- Make the changed package set explicit for internal publishing.

**Non-Goals:**

- Reimplement the managed Intelligence realtime metadata websocket.
- Add multi-instance distributed locking beyond the existing SQLite runner behavior.
- Change the public React `useThreads` hook API.
- Change `/agent/:agentId/run`, `/connect`, or `/stop` behavior.
- Replace CopilotKit Intelligence mode.

## Decisions

### Add `ThreadBackend` as a separate runtime extension point

Introduce a runtime-side interface for thread REST behavior instead of extending `AgentRunner`.

The interface should cover:

- `listThreads`
- `updateThread`
- `archiveThread`
- `deleteThread`
- `getThreadMessages`
- `getThreadEvents`
- `getThreadState`

Rationale: chat execution and thread metadata have different lifecycle, authorization, pagination, deletion, and storage semantics. Keeping them separate avoids forcing every runner to become a database-backed metadata service.

Alternative considered: add optional methods directly to `AgentRunner`. This is simpler initially but makes `AgentRunner` a mixed abstraction and repeats the current accidental shape of `InMemoryAgentRunner`.

### Extend existing SSE runtime options

Add an optional `threadBackend` field to `CopilotSseRuntimeOptions` and the compatibility `CopilotRuntime` SSE branch. Do not create an `EnhancedSseRuntime` subclass.

Rationale: the existing SSE runtime already owns routing, middleware, CORS, hooks, single-route support, telemetry, debug behavior, and chat endpoints. A duplicated runtime would need to track all upstream changes in those areas.

Alternative considered: create a new enhanced runtime class. This reduces changes to the original class but creates long-term fork maintenance risk.

### Dispatch `/threads` by backend capability

Thread handlers should use this order:

1. Intelligence runtime: call `runtime.intelligence`.
2. SSE runtime with `threadBackend`: call `runtime.threadBackend`.
3. SSE runtime with in-memory local fallback: call the existing `InMemoryAgentRunner` helper methods.
4. Otherwise return the existing unsupported thread endpoint error.

Rationale: this preserves existing behavior while adding a self-hosted backend path. Intelligence remains the most capable managed implementation when configured.

### Implement SQLite thread backend alongside SQLite runner

Add a SQLite-backed `ThreadBackend` implementation in the SQLite package. It can share the same database file as `SqliteAgentRunner`, but it should be a distinct class so apps opt into thread REST behavior explicitly.

The implementation should add durable thread metadata, including:

- `thread_id`
- `agent_id`
- `name`
- `archived`
- `created_at`
- `updated_at`
- `last_run_at`

It should derive messages, events, and state from the persisted run/event data already stored by `SqliteAgentRunner` where possible, and maintain metadata when runs are completed or thread mutations occur.

Alternative considered: subclass `InMemoryAgentRunner` and override methods with SQLite logic. This works around the current `instanceof` check but hides the real backend and preserves the wrong abstraction boundary.

### Keep frontend HTTP contract unchanged

`useThreads` should continue using runtime `/threads` endpoints. If runtime info already exposes or later gains thread endpoint capability metadata, it should describe whether list, inspect, mutations, and realtime metadata are available, but this change does not require a new hook API.

## Risks / Trade-offs

- SQLite metadata can drift from run history if run persistence and metadata upsert are not coordinated. Mitigation: update metadata in the same backend code path that records completed runs or expose an explicit backend method the runner calls after storing a run.
- SQLite deployments with multiple app instances can see file locking or divergent local files. Mitigation: document SQLite backend as single-writer or shared-volume only, matching current SQLite runner constraints.
- Realtime metadata is not available without Intelligence. Mitigation: `useThreads` already works without `wsUrl`; clients can refresh after local mutations and run completion.
- Fork divergence can grow as upstream changes thread handlers. Mitigation: keep changes small, optional, and localized to runtime types, handlers, and SQLite package.
- Publishing only changed packages can create dependency skew. Mitigation: version all changed packages with the same internal suffix and use package manager overrides for transitive `@copilotkit/*` references.

## Migration Plan

1. Add the optional runtime `threadBackend` API while preserving existing behavior when omitted.
2. Add SQLite backend schema migrations that create thread metadata tables without changing existing run rows.
3. Update self-hosted apps to pass both `runner` and `threadBackend` with the same SQLite database path.
4. Publish modified packages internally with an internal prerelease suffix.
5. Roll back by removing `threadBackend` from app runtime configuration and returning to existing SSE runner behavior.

## Open Questions

- Should `SqliteAgentRunner` automatically upsert thread metadata, or should a coordinating `SqliteThreadBackend` observe/store completed runs through a shared helper?
- Should local thread mutation endpoints require an application-provided user identity, or remain scoped only by `agentId` for the first fork implementation?
- Should `/threads/subscribe` return unsupported for self-hosted SQLite, or should the runtime expose a lightweight polling-friendly response shape?
