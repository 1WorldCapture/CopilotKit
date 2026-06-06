import type { CopilotRuntimeLike } from "../core/runtime";
import { isIntelligenceRuntime } from "../core/runtime";
import { errorResponse, isHandlerResponse } from "./shared/json-response";
import { isValidIdentifier } from "./shared/intelligence-utils";
import type { ThreadBackend } from "../threads";
import {
  handleArchiveThread as handleArchiveThreadIntelligence,
  handleClearThreads,
  handleDeleteThread as handleDeleteThreadIntelligence,
  handleGetThreadEvents as handleGetThreadEventsIntelligence,
  handleGetThreadMessages as handleGetThreadMessagesIntelligence,
  handleGetThreadState as handleGetThreadStateIntelligence,
  handleListThreads as handleListThreadsIntelligence,
  handleSubscribeToThreads as handleSubscribeToThreadsIntelligence,
  handleUpdateThread as handleUpdateThreadIntelligence,
} from "./intelligence/threads";

interface ThreadsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

function getSseThreadBackend(
  runtime: CopilotRuntimeLike,
): ThreadBackend | undefined {
  return isIntelligenceRuntime(runtime) ? undefined : runtime.threadBackend;
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid request body", 400);
  }
}

function getValidatedAgentId(body: Record<string, unknown>): string | Response {
  const agentId = body.agentId;
  if (!isValidIdentifier(agentId)) {
    return errorResponse("Valid agentId is required", 400);
  }

  return agentId;
}

function toThreadBackendErrorResponse(
  error: unknown,
  fallback: string,
): Response {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return errorResponse(
      (error as { message: string }).message,
      (error as { status: number }).status,
    );
  }

  return errorResponse(fallback, 500);
}

export async function handleListThreads(
  params: ThreadsHandlerParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleListThreadsIntelligence(params);
  }

  const url = new URL(params.request.url);
  const agentId = url.searchParams.get("agentId");
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");

  if (!isValidIdentifier(agentId)) {
    return errorResponse("Valid agentId query param is required", 400);
  }

  try {
    const data = await threadBackend.listThreads({
      agentId,
      ...(includeArchived ? { includeArchived: true } : {}),
      ...(limitParam ? { limit: Number(limitParam) } : {}),
      ...(cursor ? { cursor } : {}),
    });

    return Response.json({
      threads: data.threads,
      nextCursor: data.nextCursor ?? null,
    });
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to list threads");
  }
}

export { handleClearThreads };

export async function handleUpdateThread(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleUpdateThreadIntelligence(params);
  }

  const body = await parseJsonBody(params.request);
  if (isHandlerResponse(body)) return body;

  const agentId = getValidatedAgentId(body);
  if (isHandlerResponse(agentId)) return agentId;

  const updates = { ...body };
  delete updates.agentId;
  delete updates.userId;

  try {
    const thread = await threadBackend.updateThread({
      threadId: params.threadId,
      agentId,
      updates,
    });
    return Response.json(thread);
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to update thread");
  }
}

export async function handleSubscribeToThreads(
  params: ThreadsHandlerParams,
): Promise<Response> {
  if (getSseThreadBackend(params.runtime)) {
    return new Response(null, { status: 204 });
  }

  return handleSubscribeToThreadsIntelligence(params);
}

export async function handleArchiveThread(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleArchiveThreadIntelligence(params);
  }

  const body = await parseJsonBody(params.request);
  if (isHandlerResponse(body)) return body;

  const agentId = getValidatedAgentId(body);
  if (isHandlerResponse(agentId)) return agentId;

  try {
    await threadBackend.archiveThread({
      threadId: params.threadId,
      agentId,
    });
    return Response.json({ threadId: params.threadId, archived: true });
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to archive thread");
  }
}

export async function handleDeleteThread(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleDeleteThreadIntelligence(params);
  }

  const body = await parseJsonBody(params.request);
  if (isHandlerResponse(body)) return body;

  const agentId = getValidatedAgentId(body);
  if (isHandlerResponse(agentId)) return agentId;

  try {
    await threadBackend.deleteThread({
      threadId: params.threadId,
      agentId,
    });
    return Response.json({ threadId: params.threadId, deleted: true });
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to delete thread");
  }
}

export async function handleGetThreadMessages(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleGetThreadMessagesIntelligence(params);
  }

  try {
    const messages = await threadBackend.getThreadMessages({
      threadId: params.threadId,
    });
    return Response.json({ messages });
  } catch (error) {
    return toThreadBackendErrorResponse(
      error,
      "Failed to fetch thread messages",
    );
  }
}

export async function handleGetThreadEvents(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleGetThreadEventsIntelligence(params);
  }

  try {
    const events = await threadBackend.getThreadEvents({
      threadId: params.threadId,
    });
    return Response.json({ events });
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to fetch thread events");
  }
}

export async function handleGetThreadState(
  params: ThreadMutationParams,
): Promise<Response> {
  const threadBackend = getSseThreadBackend(params.runtime);
  if (!threadBackend) {
    return handleGetThreadStateIntelligence(params);
  }

  try {
    const state = await threadBackend.getThreadState({
      threadId: params.threadId,
    });
    return Response.json({ state });
  } catch (error) {
    return toThreadBackendErrorResponse(error, "Failed to fetch thread state");
  }
}
