## Context

CopilotKit self-hosted SSE runtimes currently treat persistence as effectively single-tenant. `threadId` is used as the primary durable identifier for thread metadata, runs, and run state, while request handling for SSE mode does not have a first-class way to resolve the authenticated owner from the incoming request and propagate that context into `AgentRunner` and `ThreadBackend`.

Applications that need authenticated thread isolation have therefore been forced to implement persistence separation outside CopilotKit, such as per-user database files, request-scoped thread ownership guards, and custom metadata forwarding. This duplicates security-sensitive logic across applications and leaves `@copilotkit/sqlite-runner` without a shared-database ownership model.

This change is constrained by several decisions already made during exploration:

- `threadId` remains a frontend-generated globally unique UUID.
- `threadId` does not encode owner or scope information.
- Owner identity must be resolved server-side from authenticated request context, not from frontend payload fields.
- Internal/external thread ID mapping is out of scope for this change.

## Goals / Non-Goals

**Goals:**

- Add an ownership-aware persistence model for self-hosted SSE runtimes and `@copilotkit/sqlite-runner`.
- Let runtime configuration supply a server-side ownership resolver that derives `ownerId` from the incoming authenticated `Request`.
- Propagate ownership context through SSE runtime handlers into `AgentRunner` and `ThreadBackend`.
- Persist owner metadata for SQLite-backed thread metadata, run history, and run state, and enforce ownership-aware reads and writes according to a global mode.
- Preserve current behavior for existing users through a disabled-by-default compatibility mode.

**Non-Goals:**

- Defining or bundling a specific authentication system.
- Reintroducing ownership semantics into `threadId`.
- Introducing internal/external thread binding tables or external runtime ID mapping.
- Replacing current Intelligence mode identity handling.

## Decisions

### 1. Ownership is configured once per runtime, not per request payload

The SSE runtime will gain an ownership configuration with two concerns:

- a global enforcement mode: `required | optional | disabled`
- a request-time resolver that derives `{ ownerId }` from the authenticated request

This mirrors the existing Intelligence pattern where the runtime owns `identifyUser(request)` and handlers call it during request processing. The alternative was to make the frontend send owner information explicitly, but that would move persistence isolation concerns into untrusted client payloads and duplicate cookie/session translation logic in each application.

### 2. Ownership is propagated as internal request context

SSE handlers such as `handleRun`, `handleConnect`, and thread endpoint handlers will resolve ownership once, then pass that internal context down into `AgentRunner` and `ThreadBackend` requests.

The target call flow is:

```text
Request
  -> runtime ownership resolver
  -> handler-level OwnershipContext
  -> AgentRunner / ThreadBackend request
  -> sqlite-runner query and write enforcement
```

The alternative was to have each storage implementation inspect HTTP headers directly. That was rejected because storage backends should not depend on transport-specific header conventions.

### 3. SQLite stores explicit owner metadata

`thread_metadata`, `agent_runs`, and `run_state` will persist `owner_id` alongside their existing identifiers. Because `threadId` is already globally unique, ownership is not needed to form composite primary keys for this change; it is needed to enforce access rules and support owner-filtered listing and inspection.

The alternative was to derive ownership only from request context while leaving durable records owner-less. That was rejected because ownership-aware list, audit, and state inspection queries require persisted owner metadata.

### 4. Ownership mode governs enforcement semantics

The SQLite-backed runtime path will use one global mode:

- `required`: every protected request must resolve an owner and all reads/writes must filter by it
- `optional`: owner-aware filtering applies when an owner is present; otherwise requests operate on public/unowned records
- `disabled`: owner metadata is ignored and current single-tenant behavior is preserved as closely as possible

This keeps compatibility simple while allowing authenticated applications to opt into strict shared-database isolation. The alternative was a single strict mode only, but that would make adoption and migration harder for existing self-hosted projects.

### 5. Existing thread backend capability is extended instead of replaced

The current `sse-thread-backend` capability already defines SSE thread list, mutation, inspection, and SQLite persistence behavior. This change extends those behaviors with owner-aware access control instead of creating a parallel thread backend model.

At the same time, a new capability is introduced for runtime-level ownership resolution and propagation because that concern spans handlers, runner contracts, and persistence in a way the current thread-backend spec does not cover.

## Risks / Trade-offs

- **[Risk] Compatibility drift between `disabled` mode and existing behavior** → Mitigation: keep ownership disabled by default and add regression coverage for existing SQLite thread flows.
- **[Risk] Ambiguity in `optional` mode public-space semantics** → Mitigation: define unowned records consistently as `owner_id IS NULL` in specs and tests.
- **[Risk] Partial enforcement if runner and thread backend use different ownership settings** → Mitigation: define ownership as runtime-level configuration that must be propagated consistently to both runner and thread backend operations.
- **[Risk] Security regressions if applications bypass the runtime resolver** → Mitigation: make owner resolution part of runtime request handling rather than an application convention based on forwarded headers.

## Migration Plan

1. Add runtime-level ownership configuration and internal ownership resolution helpers for SSE mode.
2. Extend `AgentRunner` and `ThreadBackend` request contracts to carry `OwnershipContext`.
3. Add SQLite schema migration for `owner_id` columns and related indexes, preserving existing data with `NULL` owner values.
4. Update SQLite thread backend and runner queries to apply ownership mode semantics.
5. Add regression coverage for `disabled`, `required`, and `optional` modes.
6. Roll out initially with `disabled` as the default so existing applications remain unchanged until they opt in.

Rollback consists of keeping ownership mode disabled and continuing to read legacy rows with `NULL` owner metadata.

## Open Questions

- Should the SSE ownership resolver return only `ownerId`, or should the contract leave room for future metadata such as tenant labels while still standardizing on `ownerId` for enforcement?
- What exact error shape should strict-mode ownership failures return across list, mutation, and inspection endpoints?
