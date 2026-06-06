# sse-thread-backend Specification

## Purpose

Define the self-hosted SSE thread backend contract for CopilotKit runtimes, including runtime routing, durable SQLite-backed thread storage, and `useThreads` compatibility without requiring Intelligence mode.

## Requirements

### Requirement: SSE runtime accepts a thread backend

The system SHALL allow SSE runtime configuration to include an optional thread backend without changing the existing `AgentRunner` contract.

#### Scenario: Runtime configured with runner and thread backend

- **WHEN** an application creates an SSE runtime with both `runner` and `threadBackend`
- **THEN** chat execution endpoints SHALL continue to use the configured runner
- **AND** thread endpoints SHALL use the configured thread backend

#### Scenario: Runtime configured without thread backend

- **WHEN** an application creates an SSE runtime without `threadBackend`
- **THEN** existing chat execution behavior SHALL remain unchanged
- **AND** existing thread endpoint fallback behavior SHALL remain unchanged

### Requirement: Thread endpoints dispatch to the correct backend

The system SHALL route runtime thread endpoints according to the active runtime mode and available thread backend.

#### Scenario: Intelligence runtime handles thread endpoint

- **WHEN** the runtime is configured in Intelligence mode
- **THEN** `/threads` endpoints SHALL delegate to the `CopilotKitIntelligence` API client
- **AND** they SHALL NOT use the SSE thread backend path

#### Scenario: SSE runtime handles thread endpoint with thread backend

- **WHEN** the runtime is configured in SSE mode with a thread backend
- **THEN** `/threads` endpoints SHALL delegate to the configured thread backend

#### Scenario: SSE runtime handles thread endpoint without thread backend

- **WHEN** the runtime is configured in SSE mode without a thread backend
- **THEN** `/threads` endpoints SHALL preserve the existing in-memory fallback behavior when the runner supports it
- **AND** otherwise SHALL return an unsupported thread endpoint error

### Requirement: Thread backend provides list and mutation operations

The thread backend SHALL provide the thread list and metadata mutation operations required by `useThreads`.

#### Scenario: List threads for an agent

- **WHEN** the frontend requests `GET /threads` with an `agentId`
- **THEN** the runtime SHALL return threads for that agent sorted by most recent activity first
- **AND** the response SHALL include `nextCursor` when more results are available

#### Scenario: Include archived threads

- **WHEN** the frontend requests `GET /threads` with `includeArchived=true`
- **THEN** archived threads SHALL be included in the response

#### Scenario: Rename a thread

- **WHEN** the frontend sends a thread rename request
- **THEN** the thread backend SHALL persist the new name
- **AND** the runtime SHALL return the updated thread record

#### Scenario: Archive a thread

- **WHEN** the frontend archives a thread
- **THEN** the thread backend SHALL persist the archived state
- **AND** future list responses without `includeArchived=true` SHALL exclude that thread

#### Scenario: Delete a thread

- **WHEN** the frontend deletes a thread
- **THEN** the thread backend SHALL remove the thread from future list responses
- **AND** thread inspection endpoints for that thread SHALL no longer expose deleted thread data

### Requirement: Thread backend provides inspection data

The thread backend SHALL provide persisted messages, AG-UI events, and current state for thread inspection endpoints.

#### Scenario: Fetch thread messages

- **WHEN** the frontend requests `GET /threads/:threadId/messages`
- **THEN** the runtime SHALL return the persisted message history for that thread in chronological order

#### Scenario: Fetch thread events

- **WHEN** the frontend requests `GET /threads/:threadId/events`
- **THEN** the runtime SHALL return the persisted AG-UI event stream for that thread in replay order

#### Scenario: Fetch thread state

- **WHEN** the frontend requests `GET /threads/:threadId/state`
- **THEN** the runtime SHALL return the current state derived from persisted state events
- **AND** it SHALL return `null` when no state snapshot exists

### Requirement: SQLite thread backend persists thread metadata

The SQLite thread backend SHALL persist thread metadata durably in SQLite and SHALL be usable with `SqliteAgentRunner`.

#### Scenario: Thread metadata survives restart

- **WHEN** a thread has completed at least one run and the process restarts
- **THEN** a new runtime using the same SQLite database SHALL list that thread

#### Scenario: Thread metadata tracks run activity

- **WHEN** a run completes for a thread
- **THEN** the SQLite thread backend SHALL record or update the thread's `agentId`, `updatedAt`, and `lastRunAt`

#### Scenario: Thread metadata supports user edits

- **WHEN** a thread is renamed or archived
- **THEN** the SQLite thread backend SHALL persist that metadata independently from run events

### Requirement: Frontend hook contract remains unchanged

The system SHALL allow existing frontend code using `useThreads` to work with an SSE thread backend without changing hook input or output types.

#### Scenario: useThreads lists self-hosted threads

- **WHEN** the frontend calls `useThreads({ agentId })` against an SSE runtime with a thread backend
- **THEN** the hook SHALL fetch thread records from the runtime `/threads` endpoint
- **AND** the returned thread objects SHALL match the existing `Thread` shape

#### Scenario: useThreads handles no realtime metadata

- **WHEN** the runtime does not expose a realtime thread metadata websocket
- **THEN** `useThreads` SHALL still support initial list fetching and explicit mutations over HTTP
