## 1. Runtime Ownership Configuration

- [x] 1.1 Add SSE runtime ownership configuration types and expose a server-side ownership resolver on `CopilotRuntime`.
- [x] 1.2 Implement shared ownership resolution helpers for SSE handlers and validate resolver output for strict mode failures.
- [x] 1.3 Update SSE run, connect, and thread endpoint handlers to resolve ownership once per request and pass `OwnershipContext` downward.

## 2. Runner and Thread Backend Contracts

- [x] 2.1 Extend `AgentRunner` request types to carry ownership context for `run`, `connect`, `isRunning`, and `stop`.
- [x] 2.2 Extend `ThreadBackend` request types to carry ownership context for list, mutation, and inspection operations.
- [x] 2.3 Update in-repo runner and backend implementations to accept the new contract without breaking disabled-mode behavior.

## 3. SQLite Persistence Enforcement

- [x] 3.1 Add SQLite schema migration support for `owner_id` columns and any supporting indexes in `thread_metadata`, `agent_runs`, and `run_state`.
- [x] 3.2 Update `SqliteThreadBackend` queries and access checks to enforce `required`, `optional`, and `disabled` ownership modes.
- [x] 3.3 Update `SqliteAgentRunner` persistence and read paths to store `owner_id` and enforce ownership-aware connect, state, and stop behavior.

## 4. Verification and Documentation

- [x] 4.1 Add tests covering SSE ownership resolution and propagation through runtime handlers.
- [x] 4.2 Add SQLite runner and thread backend tests for `disabled`, `required`, and `optional` modes, including cross-owner access attempts and legacy row compatibility.
- [x] 4.3 Update relevant runtime/sqlite-runner documentation to describe ownership configuration, default compatibility behavior, and shared-database expectations.
