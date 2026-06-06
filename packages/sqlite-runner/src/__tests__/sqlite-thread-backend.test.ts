import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteAgentRunner } from "..";
import { SqliteThreadBackend } from "../sqlite-thread-backend";
import type { BaseEvent } from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type {
  Message,
  RunAgentInput,
  RunFinishedEvent,
  RunStartedEvent,
} from "@ag-ui/client";
import { EMPTY, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

type RunCallbacks = {
  onEvent: (event: { event: BaseEvent }) => void | Promise<void>;
  onNewMessage?: (args: { message: Message }) => void | Promise<void>;
  onRunStartedEvent?: () => void | Promise<void>;
};

class EmitAgent extends AbstractAgent {
  constructor(
    private readonly agentIdValue: string,
    private readonly events: BaseEvent[],
  ) {
    super({ agentId: agentIdValue });
  }

  async runAgent(input: RunAgentInput, callbacks: RunCallbacks): Promise<void> {
    const runStarted: RunStartedEvent = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
      input,
    };
    await callbacks.onEvent({ event: runStarted });
    await callbacks.onRunStartedEvent?.();

    for (const event of this.events) {
      await callbacks.onEvent({ event });
    }

    const hasTerminalEvent = this.events.some(
      (event) =>
        event.type === EventType.RUN_FINISHED ||
        event.type === EventType.RUN_ERROR,
    );

    if (!hasTerminalEvent) {
      const runFinished: RunFinishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      };
      await callbacks.onEvent({ event: runFinished });
    }
  }

  clone(): AbstractAgent {
    return new EmitAgent(this.agentIdValue, [...this.events]);
  }

  protected run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    return EMPTY;
  }
}

describe("SqliteThreadBackend", () => {
  let tempDir: string;
  let dbPath: string;
  let runner: SqliteAgentRunner;
  let backend: SqliteThreadBackend;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-thread-backend-"));
    dbPath = path.join(tempDir, "threads.db");
    runner = new SqliteAgentRunner({ dbPath });
    backend = new SqliteThreadBackend({ dbPath });
  });

  afterEach(() => {
    try {
      runner.close();
    } catch {}
    try {
      backend.close();
    } catch {}

    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
  });

  it("lists persisted threads with pagination and archived filtering", async () => {
    await runThread({
      runner,
      agentId: "agent-1",
      threadId: "thread-1",
      runId: "run-1",
      userMessage: { id: "u-1", role: "user", content: "hello" },
      events: textReplyEvents("a-1", "First reply"),
    });
    await runThread({
      runner,
      agentId: "agent-1",
      threadId: "thread-2",
      runId: "run-2",
      userMessage: { id: "u-2", role: "user", content: "hello again" },
      events: textReplyEvents("a-2", "Second reply"),
    });
    await runThread({
      runner,
      agentId: "agent-2",
      threadId: "thread-3",
      runId: "run-3",
      userMessage: { id: "u-3", role: "user", content: "different agent" },
      events: textReplyEvents("a-3", "Third reply"),
    });

    const firstPage = await backend.listThreads({
      agentId: "agent-1",
      limit: 1,
    });
    expect(firstPage.threads).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.threads[0]?.id).toBe("thread-2");

    const secondPage = await backend.listThreads({
      agentId: "agent-1",
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.threads.map((thread) => thread.id)).toEqual(["thread-1"]);

    await backend.archiveThread({ threadId: "thread-1", agentId: "agent-1" });

    const activeOnly = await backend.listThreads({ agentId: "agent-1" });
    expect(activeOnly.threads.map((thread) => thread.id)).toEqual(["thread-2"]);

    const withArchived = await backend.listThreads({
      agentId: "agent-1",
      includeArchived: true,
    });
    expect(withArchived.threads.map((thread) => thread.id)).toEqual([
      "thread-2",
      "thread-1",
    ]);
    expect(withArchived.threads[1]?.archived).toBe(true);
  });

  it("persists rename and survives backend restart", async () => {
    await runThread({
      runner,
      agentId: "agent-1",
      threadId: "thread-rename",
      runId: "run-rename",
      userMessage: { id: "u-rename", role: "user", content: "rename me" },
      events: textReplyEvents("a-rename", "ok"),
    });

    const updated = await backend.updateThread({
      threadId: "thread-rename",
      agentId: "agent-1",
      updates: { name: "Renamed Thread" },
    });
    expect(updated.name).toBe("Renamed Thread");

    backend.close();
    backend = new SqliteThreadBackend({ dbPath });

    const listed = await backend.listThreads({ agentId: "agent-1" });
    expect(listed.threads[0]?.name).toBe("Renamed Thread");
  });

  it("backfills thread metadata from legacy agent_runs rows on first list", async () => {
    runner.close();
    backend.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        run_id TEXT NOT NULL UNIQUE,
        parent_run_id TEXT,
        events TEXT NOT NULL,
        input TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_state (
        thread_id TEXT PRIMARY KEY,
        is_running INTEGER DEFAULT 0,
        current_run_id TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    legacyDb
      .prepare(
        `
          INSERT INTO agent_runs (
            thread_id,
            run_id,
            parent_run_id,
            events,
            input,
            created_at,
            version
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "legacy-thread",
        "legacy-run",
        null,
        JSON.stringify([
          {
            type: EventType.RUN_STARTED,
            threadId: "legacy-thread",
            runId: "legacy-run",
            input: {
              threadId: "legacy-thread",
              runId: "legacy-run",
              messages: [{ id: "u-legacy", role: "user", content: "hi" }],
              state: {},
            },
          },
          {
            type: EventType.RUN_FINISHED,
            threadId: "legacy-thread",
            runId: "legacy-run",
          },
        ]),
        JSON.stringify({
          threadId: "legacy-thread",
          runId: "legacy-run",
          messages: [{ id: "u-legacy", role: "user", content: "hi" }],
          state: {},
        }),
        Date.now(),
        1,
      );
    legacyDb.close();

    backend.close();
    backend = new SqliteThreadBackend({ dbPath });

    const listed = await backend.listThreads({ agentId: "agent-legacy" });
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0]).toMatchObject({
      id: "legacy-thread",
      agentId: "agent-legacy",
    });
  });

  it("reconstructs messages, events, and state from persisted runs", async () => {
    const threadId = "thread-inspect";
    const toolCallId = "tool-1";

    await runThread({
      runner,
      agentId: "agent-1",
      threadId,
      runId: "run-inspect",
      userMessage: { id: "u-inspect", role: "user", content: "weather?" },
      events: [
        {
          type: EventType.TEXT_MESSAGE_START,
          messageId: "a-inspect",
          role: "assistant",
        },
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "a-inspect",
          delta: "Checking now.",
        },
        {
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: "get_weather",
          parentMessageId: "a-inspect",
        },
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: '{"city":"Paris"}',
        },
        {
          type: EventType.TOOL_CALL_END,
          toolCallId,
        },
        {
          type: EventType.TOOL_CALL_RESULT,
          messageId: "tool-result-1",
          toolCallId,
          content: '{"temp":18}',
        },
        {
          type: EventType.TEXT_MESSAGE_END,
          messageId: "a-inspect",
        },
        {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { city: "Paris", temp: 18 },
        },
      ],
    });

    const messages = await backend.getThreadMessages({ threadId });
    expect(messages).toEqual([
      { id: "u-inspect", role: "user", content: "weather?" },
      {
        id: "a-inspect",
        role: "assistant",
        content: "Checking now.",
        toolCalls: [
          {
            id: "tool-1",
            name: "get_weather",
            args: '{"city":"Paris"}',
          },
        ],
      },
      {
        id: "tool-result-1",
        role: "tool",
        content: '{"temp":18}',
        toolCallId: "tool-1",
      },
    ]);

    const events = await backend.getThreadEvents({ threadId });
    expect(events.map((event) => event.type)).toContain(EventType.RUN_STARTED);
    expect(events.map((event) => event.type)).toContain(
      EventType.STATE_SNAPSHOT,
    );

    const state = await backend.getThreadState({ threadId });
    expect(state).toEqual({ city: "Paris", temp: 18 });
  });

  it("deletes thread metadata and inspection history", async () => {
    const threadId = "thread-delete";

    await runThread({
      runner,
      agentId: "agent-1",
      threadId,
      runId: "run-delete",
      userMessage: { id: "u-delete", role: "user", content: "delete me" },
      events: textReplyEvents("a-delete", "done"),
    });

    await backend.deleteThread({ threadId, agentId: "agent-1" });

    const listed = await backend.listThreads({ agentId: "agent-1" });
    expect(listed.threads).toEqual([]);
    await expect(backend.getThreadMessages({ threadId })).resolves.toEqual([]);
    await expect(backend.getThreadEvents({ threadId })).resolves.toEqual([]);
    await expect(backend.getThreadState({ threadId })).resolves.toBeNull();
  });

  it("throws when mutating a missing thread instead of fabricating success", async () => {
    await expect(
      backend.updateThread({
        threadId: "missing-thread",
        agentId: "agent-1",
        updates: { name: "Nope" },
      }),
    ).rejects.toThrow("missing-thread");

    await expect(
      backend.archiveThread({
        threadId: "missing-thread",
        agentId: "agent-1",
      }),
    ).rejects.toThrow("missing-thread");
  });
});

async function runThread(params: {
  runner: SqliteAgentRunner;
  agentId: string;
  threadId: string;
  runId: string;
  userMessage: Message;
  events: BaseEvent[];
}) {
  const agent = new EmitAgent(params.agentId, params.events);
  await firstValueFrom(
    params.runner
      .run({
        threadId: params.threadId,
        agent,
        input: {
          threadId: params.threadId,
          runId: params.runId,
          messages: [params.userMessage],
          state: {},
          tools: [],
          context: [],
          forwardedProps: undefined,
        },
      })
      .pipe(toArray()),
  );
}

function textReplyEvents(messageId: string, content: string): BaseEvent[] {
  return [
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: content,
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    },
  ];
}
