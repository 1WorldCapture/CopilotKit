import type { CopilotRuntimeLike } from "../../core/runtime";
import type { OwnershipContext } from "../../core/runtime";
import { createSseEventResponse } from "../shared/sse-response";
import { extractForwardableHeaders } from "../header-utils";

interface HandleSseConnectParams {
  runtime: CopilotRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
  ownership: OwnershipContext;
}

export function handleSseConnect({
  runtime,
  request,
  agentId,
  threadId,
  ownership,
}: HandleSseConnectParams): Response {
  return createSseEventResponse({
    request,
    debugEventBus: runtime.debugEventBus,
    // Forward the real agentId so debug envelopes reflect the agent the
    // route resolved to — not the literal string "connect".
    agentId,
    observableFactory: () =>
      runtime.runner.connect({
        threadId,
        headers: extractForwardableHeaders(request),
        ownership,
      }),
  });
}
