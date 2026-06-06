import type { BaseEvent } from "@ag-ui/client";

export class ThreadBackendRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ThreadBackendRequestError";
  }
}

export interface ThreadRecord {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: string;
  createdById: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface ThreadBackendMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
  }>;
  toolCallId?: string;
}

export interface ThreadBackendInspectEvent {
  type: string;
  [key: string]: unknown;
}

export interface ThreadBackendListThreadsRequest {
  agentId: string;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

export interface ThreadBackendListThreadsResponse {
  threads: ThreadRecord[];
  nextCursor?: string | null;
}

export interface ThreadBackendUpdateThreadRequest {
  threadId: string;
  agentId: string;
  updates: Record<string, unknown>;
}

export interface ThreadBackendArchiveThreadRequest {
  threadId: string;
  agentId: string;
}

export interface ThreadBackendDeleteThreadRequest {
  threadId: string;
  agentId: string;
}

export interface ThreadBackendGetThreadMessagesRequest {
  threadId: string;
}

export interface ThreadBackendGetThreadEventsRequest {
  threadId: string;
}

export interface ThreadBackendGetThreadStateRequest {
  threadId: string;
}

export interface ThreadBackend {
  listThreads(
    request: ThreadBackendListThreadsRequest,
  ): Promise<ThreadBackendListThreadsResponse>;
  updateThread(
    request: ThreadBackendUpdateThreadRequest,
  ): Promise<ThreadRecord>;
  archiveThread(request: ThreadBackendArchiveThreadRequest): Promise<void>;
  deleteThread(request: ThreadBackendDeleteThreadRequest): Promise<void>;
  getThreadMessages(
    request: ThreadBackendGetThreadMessagesRequest,
  ): Promise<ThreadBackendMessage[]>;
  getThreadEvents(
    request: ThreadBackendGetThreadEventsRequest,
  ): Promise<ThreadBackendInspectEvent[] | BaseEvent[]>;
  getThreadState(
    request: ThreadBackendGetThreadStateRequest,
  ): Promise<unknown | null>;
}
