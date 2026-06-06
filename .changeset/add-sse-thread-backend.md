---
"@copilotkit/runtime": minor
"@copilotkit/sqlite-runner": minor
---

feat: add durable SSE thread backend support

Add a dedicated `threadBackend` runtime extension point for SSE deployments,
route `/threads` handlers through it ahead of the in-memory fallback, and ship
`SqliteThreadBackend` for self-hosted durable thread lists, mutations, message
history, event inspection, and state inspection alongside `SqliteAgentRunner`.
