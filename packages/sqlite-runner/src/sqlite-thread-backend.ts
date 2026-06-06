import type { BaseEvent } from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import type {
  Message,
  RunStartedEvent,
  StateSnapshotEvent,
} from "@ag-ui/client";
import type {
  ThreadBackend,
  ThreadBackendMessage,
  ThreadRecord,
} from "@copilotkit/runtime/v2";
import Database from "better-sqlite3";
import {
  backfillThreadMetadata,
  getThreadMetadata,
  initializeSchema,
  listAgentRuns,
  mapThreadMetadataRow,
} from "./sqlite-thread-storage.js";

export interface SqliteThreadBackendOptions {
  dbPath?: string;
}

interface CursorPayload {
  sortKey: number;
  threadId: string;
}

interface ListedThreadRow {
  thread_id: string;
  agent_id: string;
  name: string | null;
  archived: number;
  organization_id: string;
  created_by_id: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
}

interface ToolCall {
  id: string;
  name: string;
  args: string;
}

class SqliteThreadBackendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SqliteThreadBackendError";
  }
}

export class SqliteThreadBackend implements ThreadBackend {
  private db: any;

  constructor(options: SqliteThreadBackendOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";

    if (!Database) {
      throw new Error(
        "better-sqlite3 is required for SqliteThreadBackend but was not found.",
      );
    }

    this.db = new Database(dbPath);
    initializeSchema(this.db);
  }

  async listThreads(request: {
    agentId: string;
    includeArchived?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<{ threads: ThreadRecord[]; nextCursor: string | null }> {
    backfillThreadMetadata(this.db, request.agentId);
    const cursor = decodeCursor(request.cursor);
    const limit =
      typeof request.limit === "number" &&
      Number.isFinite(request.limit) &&
      request.limit > 0
        ? Math.floor(request.limit)
        : null;
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM thread_metadata
          WHERE agent_id = @agentId
            AND (@includeArchived = 1 OR archived = 0)
            AND (
              @cursorSortKey IS NULL OR
              COALESCE(last_run_at, updated_at, created_at) < @cursorSortKey OR
              (
                COALESCE(last_run_at, updated_at, created_at) = @cursorSortKey
                AND thread_id < @cursorThreadId
              )
            )
          ORDER BY
            COALESCE(last_run_at, updated_at, created_at) DESC,
            thread_id DESC
          LIMIT @limitPlusOne
        `,
      )
      .all({
        agentId: request.agentId,
        includeArchived: request.includeArchived ? 1 : 0,
        cursorSortKey: cursor?.sortKey ?? null,
        cursorThreadId: cursor?.threadId ?? null,
        limitPlusOne: limit == null ? Number.MAX_SAFE_INTEGER : limit + 1,
      }) as ListedThreadRow[];

    const pageRows = limit == null ? rows : rows.slice(0, limit);
    const nextRow = limit == null ? undefined : rows[limit];
    const lastPageRow =
      pageRows.length > 0 ? pageRows[pageRows.length - 1] : undefined;

    return {
      threads: pageRows.map(mapThreadMetadataRow),
      nextCursor:
        nextRow && lastPageRow
          ? encodeCursor({
              sortKey:
                lastPageRow.last_run_at ??
                lastPageRow.updated_at ??
                lastPageRow.created_at,
              threadId: lastPageRow.thread_id,
            })
          : null,
    };
  }

  async updateThread(request: {
    threadId: string;
    agentId: string;
    updates: Record<string, unknown>;
  }): Promise<ThreadRecord> {
    this.ensureThreadExists(request.threadId, request.agentId);
    const name =
      typeof request.updates.name === "string" || request.updates.name === null
        ? request.updates.name
        : undefined;

    if (name !== undefined) {
      this.db
        .prepare(
          `
            UPDATE thread_metadata
            SET name = ?, updated_at = ?
            WHERE thread_id = ? AND agent_id = ?
          `,
        )
        .run(name, Date.now(), request.threadId, request.agentId);
    }

    return (
      getThreadMetadata(this.db, request.threadId) ??
      this.throwThreadNotFound(request.threadId)
    );
  }

  async archiveThread(request: {
    threadId: string;
    agentId: string;
  }): Promise<void> {
    this.ensureThreadExists(request.threadId, request.agentId);
    this.db
      .prepare(
        `
          UPDATE thread_metadata
          SET archived = 1, updated_at = ?
          WHERE thread_id = ? AND agent_id = ?
        `,
      )
      .run(Date.now(), request.threadId, request.agentId);
  }

  async deleteThread(request: {
    threadId: string;
    agentId: string;
  }): Promise<void> {
    this.ensureThreadExists(request.threadId, request.agentId);
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM thread_metadata WHERE thread_id = ? AND agent_id = ?",
        )
        .run(request.threadId, request.agentId);
      this.db
        .prepare("DELETE FROM agent_runs WHERE thread_id = ?")
        .run(request.threadId);
      this.db
        .prepare("DELETE FROM run_state WHERE thread_id = ?")
        .run(request.threadId);
    })();
  }

  async getThreadMessages(request: {
    threadId: string;
  }): Promise<ThreadBackendMessage[]> {
    const runs = listAgentRuns(this.db, request.threadId);
    return reconstructThreadMessages(runs);
  }

  async getThreadEvents(request: { threadId: string }): Promise<BaseEvent[]> {
    return getCompactedThreadEvents(this.db, request.threadId);
  }

  async getThreadState(request: {
    threadId: string;
  }): Promise<Record<string, unknown> | null> {
    const events = getCompactedThreadEvents(this.db, request.threadId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]!;
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as StateSnapshotEvent).snapshot;
        if (snapshot && typeof snapshot === "object") {
          return snapshot as Record<string, unknown>;
        }
        return null;
      }
    }

    return null;
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  private ensureThreadExists(threadId: string, agentId: string): void {
    backfillThreadMetadata(this.db, agentId);
    const row = this.db
      .prepare(
        "SELECT 1 FROM thread_metadata WHERE thread_id = ? AND agent_id = ?",
      )
      .get(threadId, agentId) as { 1: number } | undefined;

    if (!row) {
      this.throwThreadNotFound(threadId);
    }
  }

  private throwThreadNotFound(threadId: string): never {
    throw new SqliteThreadBackendError(`Thread '${threadId}' not found`, 404);
  }
}

function getCompactedThreadEvents(db: any, threadId: string): BaseEvent[] {
  const runs = listAgentRuns(db, threadId);
  const events: BaseEvent[] = [];
  for (const run of runs) {
    events.push(...run.events);
  }
  return compactEvents(events);
}

function normalizeMessage(message: Message): ThreadBackendMessage {
  switch (message.role) {
    case "assistant": {
      const toolCalls = message.toolCalls ?? [];
      return {
        id: message.id,
        role: message.role,
        ...(message.content !== undefined ? { content: message.content } : {}),
        ...(toolCalls.length > 0
          ? {
              toolCalls: toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                args: toolCall.function.arguments,
              })),
            }
          : {}),
      };
    }
    case "tool":
      return {
        id: message.id,
        role: message.role,
        content:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content),
        toolCallId: message.toolCallId,
      };
    default:
      return {
        id: message.id,
        role: message.role,
        ...("content" in message && message.content !== undefined
          ? {
              content:
                typeof message.content === "string"
                  ? message.content
                  : JSON.stringify(message.content),
            }
          : {}),
      };
  }
}

function reconstructThreadMessages(
  runs: ReturnType<typeof listAgentRuns>,
): ThreadBackendMessage[] {
  const ordered: ThreadBackendMessage[] = [];
  const messagesById = new Map<string, ThreadBackendMessage>();
  const toolCallsById = new Map<string, ToolCall>();
  const toolCallParents = new Map<string, string>();

  const pushMessage = (message: ThreadBackendMessage) => {
    if (!messagesById.has(message.id)) {
      ordered.push(message);
    }
    messagesById.set(message.id, message);
  };

  const ensureMessage = (messageId: string, role: string) => {
    let message = messagesById.get(messageId);
    if (!message) {
      message = {
        id: messageId,
        role,
        content: "",
      };
      pushMessage(message);
    }
    return message;
  };

  for (const run of runs) {
    const runStarted = run.events.find(
      (event) => event.type === EventType.RUN_STARTED,
    ) as RunStartedEvent | undefined;

    for (const message of runStarted?.input?.messages ?? []) {
      if (!messagesById.has(message.id)) {
        pushMessage(normalizeMessage(message));
      }
    }

    for (const event of run.events) {
      switch (event.type) {
        case EventType.TEXT_MESSAGE_START: {
          const textStartEvent = event as unknown as {
            messageId: string;
            role?: string;
          };
          const message = ensureMessage(
            textStartEvent.messageId,
            textStartEvent.role ?? "assistant",
          );
          message.role = textStartEvent.role ?? message.role;
          message.content ??= "";
          break;
        }
        case EventType.TEXT_MESSAGE_CONTENT: {
          const textContentEvent = event as unknown as {
            messageId: string;
            delta?: string;
          };
          const message = ensureMessage(
            textContentEvent.messageId,
            "assistant",
          );
          message.content = `${message.content ?? ""}${textContentEvent.delta ?? ""}`;
          break;
        }
        case EventType.TEXT_MESSAGE_CHUNK: {
          const textChunkEvent = event as unknown as {
            messageId: string;
            role?: string;
            delta?: string;
          };
          const message = ensureMessage(
            textChunkEvent.messageId,
            textChunkEvent.role ?? "assistant",
          );
          message.role = textChunkEvent.role ?? message.role;
          message.content = `${message.content ?? ""}${textChunkEvent.delta ?? ""}`;
          break;
        }
        case EventType.TOOL_CALL_START: {
          const toolCallStartEvent = event as unknown as {
            toolCallId: string;
            toolCallName: string;
            parentMessageId?: string;
          };
          toolCallsById.set(toolCallStartEvent.toolCallId, {
            id: toolCallStartEvent.toolCallId,
            name: toolCallStartEvent.toolCallName,
            args: "",
          });
          if (toolCallStartEvent.parentMessageId) {
            toolCallParents.set(
              toolCallStartEvent.toolCallId,
              toolCallStartEvent.parentMessageId,
            );
          }
          break;
        }
        case EventType.TOOL_CALL_ARGS: {
          const toolCallArgsEvent = event as unknown as {
            toolCallId: string;
            delta?: string;
          };
          const toolCall = toolCallsById.get(toolCallArgsEvent.toolCallId);
          if (toolCall) {
            toolCall.args += toolCallArgsEvent.delta ?? "";
          }
          break;
        }
        case EventType.TOOL_CALL_CHUNK: {
          const toolCallChunkEvent = event as unknown as {
            toolCallId: string;
            toolCallName?: string;
            parentMessageId?: string;
            delta?: string;
          };
          let toolCall = toolCallsById.get(toolCallChunkEvent.toolCallId);
          if (!toolCall) {
            toolCall = {
              id: toolCallChunkEvent.toolCallId,
              name: toolCallChunkEvent.toolCallName ?? "",
              args: "",
            };
            toolCallsById.set(toolCallChunkEvent.toolCallId, toolCall);
            if (toolCallChunkEvent.parentMessageId) {
              toolCallParents.set(
                toolCallChunkEvent.toolCallId,
                toolCallChunkEvent.parentMessageId,
              );
            }
          }
          if (toolCallChunkEvent.toolCallName) {
            toolCall.name = toolCallChunkEvent.toolCallName;
          }
          toolCall.args += toolCallChunkEvent.delta ?? "";
          break;
        }
        case EventType.TOOL_CALL_END: {
          const toolCallEndEvent = event as unknown as {
            toolCallId: string;
          };
          attachToolCall(
            messagesById,
            toolCallsById.get(toolCallEndEvent.toolCallId),
            toolCallParents.get(toolCallEndEvent.toolCallId),
          );
          break;
        }
        case EventType.TOOL_CALL_RESULT: {
          const toolCallResultEvent = event as unknown as {
            messageId: string;
            content: unknown;
            toolCallId?: string;
          };
          pushMessage({
            id: toolCallResultEvent.messageId,
            role: "tool",
            content: normalizeResultContent(toolCallResultEvent.content),
            toolCallId: toolCallResultEvent.toolCallId,
          });
          break;
        }
      }
    }
  }

  for (const [toolCallId, toolCall] of toolCallsById) {
    attachToolCall(messagesById, toolCall, toolCallParents.get(toolCallId));
  }

  return ordered;
}

function attachToolCall(
  messagesById: Map<string, ThreadBackendMessage>,
  toolCall: ToolCall | undefined,
  parentMessageId: string | undefined,
): void {
  if (!toolCall || !parentMessageId) return;
  const parent = messagesById.get(parentMessageId);
  if (!parent) return;

  parent.toolCalls ??= [];
  if (!parent.toolCalls.some((item) => item.id === toolCall.id)) {
    parent.toolCalls.push(toolCall);
  }
}

function normalizeResultContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { text: string } =>
          !!part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("");
  }

  const serialized = JSON.stringify(content);
  return typeof serialized === "string" ? serialized : String(content ?? "");
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(cursor?: string): CursorPayload | null {
  if (!cursor) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorPayload>;
    if (
      typeof decoded.sortKey === "number" &&
      Number.isFinite(decoded.sortKey) &&
      typeof decoded.threadId === "string" &&
      decoded.threadId.length > 0
    ) {
      return {
        sortKey: decoded.sortKey,
        threadId: decoded.threadId,
      };
    }
  } catch {
    return null;
  }

  return null;
}
