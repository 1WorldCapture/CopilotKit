## 1. Runtime Extension Point

- [x] 1.1 Add a `ThreadBackend` interface and related thread record/request/response types in the runtime package.
- [x] 1.2 Add optional `threadBackend` support to `CopilotSseRuntimeOptions`, `CopilotSseRuntimeLike`, and the `CopilotRuntime` compatibility wrapper.
- [x] 1.3 Ensure `CopilotIntelligenceRuntimeOptions` does not accept `threadBackend` so Intelligence mode remains the managed thread backend path.
- [x] 1.4 Export the new thread backend types from the runtime v2 public entrypoint.

## 2. Thread Handler Routing

- [x] 2.1 Update `/threads` list, messages, events, and state handlers to dispatch in order: Intelligence, configured thread backend, in-memory fallback, unsupported error.
- [x] 2.2 Update rename, archive, and delete handlers to support configured thread backend in SSE mode while preserving Intelligence behavior.
- [x] 2.3 Decide and implement the SSE response for `/threads/subscribe` when only a thread backend is configured.
- [x] 2.4 Preserve existing request validation, response envelopes, and error statuses where possible.

## 3. SQLite Thread Backend

- [x] 3.1 Add a `SqliteThreadBackend` class to the SQLite runner package.
- [x] 3.2 Add SQLite schema initialization for durable thread metadata without breaking existing `agent_runs` databases.
- [x] 3.3 Implement thread list filtering, sorting, pagination, and `includeArchived` behavior.
- [x] 3.4 Implement rename, archive, and delete persistence.
- [x] 3.5 Implement messages, events, and state inspection using persisted SQLite run/event data.
- [x] 3.6 Coordinate run completion metadata updates between `SqliteAgentRunner` and `SqliteThreadBackend`.
- [x] 3.7 Export `SqliteThreadBackend` and its options from `@copilotkit/sqlite-runner`.

## 4. Frontend Compatibility

- [x] 4.1 Verify `useThreads` works unchanged against an SSE runtime with `threadBackend`.
- [ ] 4.2 Verify `useThreads` still works against Intelligence mode.
- [x] 4.3 Verify `useThreads` preserves current behavior for an SSE runtime without thread backend.
- [ ] 4.4 Update runtime info capability metadata only if needed for the existing hook and inspector behavior.

## 5. Tests

- [x] 5.1 Add runtime handler tests for all dispatch branches.
- [x] 5.2 Add SQLite backend unit tests for metadata persistence, list filtering, pagination, mutations, and restart behavior.
- [x] 5.3 Add SQLite backend tests for messages, events, and state inspection.
- [x] 5.4 Add regression tests proving chat run/connect/stop behavior still uses `AgentRunner`.
- [x] 5.5 Run affected Nx test targets for runtime, sqlite-runner, core, and react-core as applicable.

## 6. Documentation and Publishing

- [x] 6.1 Document self-hosted SSE thread backend usage with `SqliteAgentRunner` and `SqliteThreadBackend`.
- [x] 6.2 Document SQLite deployment constraints, including single-writer or shared-volume assumptions.
- [x] 6.3 Add changesets for every modified package.
- [ ] 6.4 Publish only modified packages from the fork with a shared internal prerelease version suffix.
- [x] 6.5 Add application-side package manager override examples for consuming the forked packages.
