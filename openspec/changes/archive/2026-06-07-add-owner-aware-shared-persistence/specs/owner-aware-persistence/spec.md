## ADDED Requirements

### Requirement: SSE runtime resolves ownership from authenticated requests

The system SHALL allow self-hosted SSE runtime configuration to provide an ownership resolver that derives the current `ownerId` from the incoming authenticated `Request`.

#### Scenario: Required mode resolves owner for a run request

- **WHEN** an application configures SSE runtime ownership mode as `required`
- **AND** the runtime receives an authenticated run request
- **THEN** the runtime SHALL resolve `ownerId` from the incoming request before invoking the runner

#### Scenario: Frontend payload omits owner identity

- **WHEN** the frontend sends a normal CopilotKit request body without an `ownerId` field
- **THEN** the runtime SHALL NOT require owner identity in the request payload
- **AND** it SHALL rely on the configured ownership resolver to derive owner context server-side

### Requirement: SSE runtime propagates ownership context internally

The system SHALL propagate resolved ownership context from SSE runtime handlers into `AgentRunner` and `ThreadBackend` requests.

#### Scenario: Run and connect requests carry ownership context

- **WHEN** the runtime resolves an `ownerId` for a run or connect request
- **THEN** it SHALL pass that ownership context to the corresponding `AgentRunner` operation

#### Scenario: Thread endpoint requests carry ownership context

- **WHEN** the runtime resolves an `ownerId` for a thread list, mutation, or inspection request
- **THEN** it SHALL pass that ownership context to the corresponding `ThreadBackend` operation

### Requirement: Ownership mode governs enforcement semantics

The system SHALL support `required`, `optional`, and `disabled` ownership modes for SSE persistence operations.

#### Scenario: Required mode rejects missing owner context

- **WHEN** ownership mode is `required`
- **AND** the runtime cannot resolve an `ownerId` for a protected persistence operation
- **THEN** the operation SHALL be rejected

#### Scenario: Optional mode allows public records

- **WHEN** ownership mode is `optional`
- **AND** the runtime cannot resolve an `ownerId`
- **THEN** persistence operations SHALL target unowned records only

#### Scenario: Disabled mode preserves legacy behavior

- **WHEN** ownership mode is `disabled`
- **THEN** SSE persistence operations SHALL ignore ownership metadata
- **AND** they SHALL remain compatible with legacy single-tenant behavior

### Requirement: SQLite runner persists owner-scoped runs and state

The SQLite-backed agent runner SHALL persist owner metadata for run history and run state and SHALL apply ownership mode semantics to runner operations.

#### Scenario: Runner stores owner metadata for a run

- **WHEN** a run executes with resolved ownership context
- **THEN** the SQLite runner SHALL persist `owner_id` with the run record
- **AND** it SHALL persist owner-aware run state for that thread

#### Scenario: Runner enforces owner-aware connect and stop

- **WHEN** ownership mode is enabled for the SQLite runner
- **THEN** `connect`, `isRunning`, and `stop` SHALL use the provided ownership context when accessing persisted run data
