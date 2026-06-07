import type {
  CopilotRuntimeLike,
  OwnershipContext,
  ResolvedCopilotRuntimeOwnershipConfig,
} from "../../core/runtime";
import { errorResponse } from "./json-response";
import { isValidIdentifier } from "./intelligence-utils";

function getOwnershipConfig(
  runtime: CopilotRuntimeLike,
): ResolvedCopilotRuntimeOwnershipConfig {
  return runtime.ownership ?? { mode: "disabled" };
}

export async function resolveOwnership(params: {
  runtime: CopilotRuntimeLike;
  request: Request;
}): Promise<OwnershipContext | Response> {
  const { runtime, request } = params;
  const ownership = getOwnershipConfig(runtime);

  if (ownership.mode === "disabled") {
    return {};
  }

  if (typeof ownership.resolveOwner !== "function") {
    return errorResponse(
      "Ownership resolver is required when ownership mode is enabled",
      500,
    );
  }

  try {
    const result = await ownership.resolveOwner(request);
    const ownerId = result?.ownerId ?? null;

    if (ownerId !== null && !isValidIdentifier(ownerId)) {
      return errorResponse("resolveOwner must return a valid owner id", 500);
    }

    if (ownership.mode === "required" && ownerId === null) {
      return errorResponse("Owner context required", 403);
    }

    return { ownerId };
  } catch (error) {
    console.error("Error resolving ownership:", error);
    return errorResponse("Failed to resolve ownership", 500);
  }
}
