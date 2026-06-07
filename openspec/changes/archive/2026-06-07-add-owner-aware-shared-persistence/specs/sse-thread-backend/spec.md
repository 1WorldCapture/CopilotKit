## MODIFIED Requirements

### Requirement: Thread backend provides list and mutation operations

The thread backend SHALL provide the thread list and metadata mutation operations required by `useThreads`, and SHALL apply configured ownership rules to those operations.

#### Scenario: List threads for an agent with owner context

- **WHEN** the frontend requests `GET /threads` with an `agentId`
- **AND** ownership mode is enabled
- **THEN** the runtime SHALL return only threads that match both the requested agent and the resolved owner scope for that request
- **AND** the response SHALL include `nextCursor` when more results are available

#### Scenario: Include archived threads

- **WHEN** the frontend requests `GET /threads` with `includeArchived=true`
- **THEN** archived threads SHALL be included in the response subject to the active ownership filter

#### Scenario: Rename a thread

- **WHEN** the frontend sends a thread rename request
- **THEN** the thread backend SHALL persist the new name only if the thread is accessible under the active ownership rules
- **AND** the runtime SHALL return the updated thread record

#### Scenario: Archive a thread

- **WHEN** the frontend archives a thread
- **THEN** the thread backend SHALL persist the archived state only if the thread is accessible under the active ownership rules
- **AND** future list responses without `includeArchived=true` SHALL exclude that thread

#### Scenario: Delete a thread

- **WHEN** the frontend deletes a thread
- **THEN** the thread backend SHALL remove the thread only if it is accessible under the active ownership rules
- **AND** thread inspection endpoints for that thread SHALL no longer expose deleted thread data

### Requirement: Thread backend provides inspection data

The thread backend SHALL provide persisted messages, AG-UI events, and current state for thread inspection endpoints, and SHALL enforce ownership-aware access before returning that data.

#### Scenario: Fetch thread messages

- **WHEN** the frontend requests `GET /threads/:threadId/messages`
- **THEN** the runtime SHALL return the persisted message history for that thread in chronological order only if the thread is accessible under the active ownership rules

#### Scenario: Fetch thread events

- **WHEN** the frontend requests `GET /threads/:threadId/events`
- **THEN** the runtime SHALL return the persisted AG-UI event stream for that thread in replay order only if the thread is accessible under the active ownership rules

#### Scenario: Fetch thread state

- **WHEN** the frontend requests `GET /threads/:threadId/state`
- **THEN** the runtime SHALL return the current state derived from persisted state events only if the thread is accessible under the active ownership rules
- **AND** it SHALL return `null` when no state snapshot exists

### Requirement: SQLite thread backend persists thread metadata

The SQLite thread backend SHALL persist thread metadata durably in SQLite, SHALL be usable with `SqliteAgentRunner`, and SHALL store owner metadata required for owner-aware list and inspection operations.

#### Scenario: Thread metadata survives restart

- **WHEN** a thread has completed at least one run and the process restarts
- **THEN** a new runtime using the same SQLite database SHALL list that thread subject to the active ownership rules

#### Scenario: Thread metadata tracks run activity

- **WHEN** a run completes for a thread
- **THEN** the SQLite thread backend SHALL record or update the thread's `agentId`, `updatedAt`, and `lastRunAt`
- **AND** it SHALL persist the thread's `owner_id` when ownership context is available

#### Scenario: Thread metadata supports user edits

- **WHEN** a thread is renamed or archived
- **THEN** the SQLite thread backend SHALL persist that metadata independently from run events
- **AND** owner-aware access to that metadata SHALL remain enforced after restart
