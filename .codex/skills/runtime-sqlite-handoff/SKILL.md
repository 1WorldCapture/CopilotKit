---
name: runtime-sqlite-handoff
description: Package forked `@copilotkit/runtime` and `@copilotkit/sqlite-runner` from this monorepo, copy the tarballs into another app, wire `SqliteAgentRunner` plus `SqliteThreadBackend`, add dependency overrides when needed, and run the minimum SSE thread verification flow. Use when a target project must consume local or forked CopilotKit runtime changes before upstream publish, especially for self-hosted durable threads.
---

# Runtime SQLite Handoff

## Overview

Use this skill when a CopilotKit app needs to consume forked `@copilotkit/runtime`
and `@copilotkit/sqlite-runner` packages from this repo instead of the public npm
release. It standardizes build, pack, copy, dependency wiring, runtime
integration, and API verification so repeated handoffs stay consistent.

## When To Use It

- Shipping local runtime or SQLite runner fixes into another repo before publish
- Refreshing tarballs after new bug fixes in `packages/runtime` or `packages/sqlite-runner`
- Wiring `useThreads` to a self-hosted SSE runtime with `threadBackend`
- Replacing transitive `@copilotkit/*` resolution with local tarballs or forked prereleases

## Workflow

### 1. Confirm the source changes

- Review `packages/runtime`, `packages/sqlite-runner`, related tests, docs, and
  changesets that belong to the fork.
- Do not commit generated `.tgz` files from packaging.

### 2. Export fresh tarballs into the target app

- Run `scripts/export-local-packages.sh /absolute/path/to/target-app`
- The script uses `nx` to build `@copilotkit/runtime` and
  `@copilotkit/sqlite-runner`, packs them, and copies the tarballs into
  `<target-app>/.local-packages/`.
- Reuse the same tarball filenames on each refresh. Overwrite in place instead
  of inventing `-local2`, `-local3`, and similar suffixes.

### 3. Update target dependencies

- Point the target app's direct dependencies to the copied tarballs with
  `file:.local-packages/...`.
- Add package-manager overrides when the target also pulls these packages
  transitively and everything must resolve to the same fork.
- Read `references/target-app-example.md` for direct dependency, `pnpm`, and
  `npm` override snippets.

### 4. Wire the runtime in the target app

- Keep chat execution on `SqliteAgentRunner`.
- Add `threadBackend: new SqliteThreadBackend({ dbPath })` to the same runtime.
- Use the same SQLite path for both classes.
- For Next App Router handlers, export `PATCH` and `DELETE` in addition to
  `GET`, `POST`, and `OPTIONS` so thread rename and delete routes are reachable.

### 5. Verify the API contract

Minimum checks:

- Target app build succeeds.
- `GET /api/copilotkit/info` returns `mode: "sse"`.
- `POST /api/copilotkit/agent/:agentId/run` completes with `RUN_FINISHED`.
- `GET /threads`, `GET /threads/:id/messages`, `GET /threads/:id/events`, and
  `GET /threads/:id/state` return persisted data.
- `PATCH /threads/:id`, `POST /threads/:id/archive`, and `DELETE /threads/:id`
  succeed for existing threads and return `404` for nonexistent ones.
- `POST /threads/subscribe` returns `204` in SSE plus `threadBackend` mode.

Use a valid UUID `threadId` when the downstream agent stack requires one, such
as LangGraph.

Read `references/verification-checklist.md` for concrete request examples.

## Guardrails

- Keep the runtime fork small. Prefer patching handlers and backend extension
  points over duplicating the whole runtime.
- The SQLite path is for single-writer or shared-volume deployments. Do not
  assume separate local files across many replicas will converge.
- If the target app keeps stale dependency state, reinstall after updating
  tarballs.
- If you switch from local tarballs to an internally published prerelease, keep
  the same runtime wiring and replace only the dependency source.

## References

- `references/target-app-example.md`
- `references/verification-checklist.md`
