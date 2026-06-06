# Verification Checklist

Use these checks after wiring a target app to the forked packages.

## Preconditions

- The target app installs the tarballs from `.local-packages/`
- The runtime process is running
- Any downstream agent service is running
- You have a valid `agentId`
- If the agent stack requires it, you use UUID `threadId` values

## Basic runtime check

```bash
curl -s http://localhost:3000/api/copilotkit/info | jq
```

Expect `mode` to be `"sse"`.

## Run a thread

```bash
THREAD_ID="11111111-1111-4111-8111-111111111111"

curl -s \
  -X POST \
  http://localhost:3000/api/copilotkit/agent/deep_agent/run \
  -H 'content-type: application/json' \
  -d "{
    \"threadId\": \"$THREAD_ID\",
    \"messages\": [{\"id\":\"m1\",\"role\":\"user\",\"content\":\"hello\"}]
  }"
```

Expect the stream or response body to reach `RUN_FINISHED`.

## Thread list and inspection

```bash
curl -s "http://localhost:3000/api/copilotkit/threads?agentId=deep_agent" | jq
curl -s "http://localhost:3000/api/copilotkit/threads/$THREAD_ID/messages?agentId=deep_agent" | jq
curl -s "http://localhost:3000/api/copilotkit/threads/$THREAD_ID/events?agentId=deep_agent" | jq
curl -s "http://localhost:3000/api/copilotkit/threads/$THREAD_ID/state?agentId=deep_agent" | jq
```

Expect persisted thread data in all four endpoints.

## Mutations

```bash
curl -s \
  -X PATCH \
  "http://localhost:3000/api/copilotkit/threads/$THREAD_ID" \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent","name":"Renamed thread"}' | jq

curl -s \
  -X POST \
  "http://localhost:3000/api/copilotkit/threads/$THREAD_ID/archive" \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent"}' | jq

curl -i \
  -X POST \
  http://localhost:3000/api/copilotkit/threads/subscribe \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent"}'

curl -s \
  -X DELETE \
  "http://localhost:3000/api/copilotkit/threads/$THREAD_ID" \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent"}' | jq
```

Expect:

- Rename works
- Archive works
- Subscribe returns `204 No Content` in SSE plus `threadBackend` mode
- Delete works

## Missing-thread regression checks

```bash
MISSING_ID="44444444-4444-4444-8444-444444444444"

curl -i \
  -X PATCH \
  "http://localhost:3000/api/copilotkit/threads/$MISSING_ID" \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent","name":"missing"}'

curl -i \
  -X DELETE \
  "http://localhost:3000/api/copilotkit/threads/$MISSING_ID" \
  -H 'content-type: application/json' \
  -d '{"agentId":"deep_agent"}'
```

Expect `404` for both requests.
