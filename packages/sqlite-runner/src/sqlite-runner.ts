import { AgentRunner, finalizeRunEvents } from "@copilotkit/runtime/v2";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
} from "@copilotkit/runtime/v2";
import type { Observable } from "rxjs";
import { ReplaySubject } from "rxjs";
import type {
  AbstractAgent,
  BaseEvent,
  RunAgentInput,
  RunStartedEvent,
} from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import Database from "better-sqlite3";
import type { OwnershipContext, OwnershipMode } from "@copilotkit/runtime/v2";
import {
  backfillThreadMetadata,
  initializeSchema,
  listAgentRuns,
  SCHEMA_VERSION,
  upsertThreadRunMetadata,
} from "./sqlite-thread-storage.js";
import { getOwnershipOwnerId, normalizeOwnershipMode } from "./ownership.js";
import type { SqliteOwnershipOptions } from "./ownership.js";

export interface SqliteAgentRunnerOptions {
  dbPath?: string;
  ownership?: SqliteOwnershipOptions;
}

interface ActiveConnectionContext {
  subject: ReplaySubject<BaseEvent>;
  agent?: AbstractAgent;
  runSubject?: ReplaySubject<BaseEvent>;
  currentEvents?: BaseEvent[];
  stopRequested?: boolean;
}

// Active connections for streaming events and stop support
const ACTIVE_CONNECTIONS = new Map<string, ActiveConnectionContext>();

export class SqliteAgentRunner extends AgentRunner {
  private db: any;
  private ownershipMode: OwnershipMode;

  constructor(options: SqliteAgentRunnerOptions = {}) {
    super();
    const dbPath = options.dbPath ?? ":memory:";

    if (!Database) {
      throw new Error(
        "better-sqlite3 is required for SqliteAgentRunner but was not found.\n" +
          "Please install it in your project:\n" +
          "  npm install better-sqlite3\n" +
          "  or\n" +
          "  pnpm add better-sqlite3\n" +
          "  or\n" +
          "  yarn add better-sqlite3\n\n" +
          "If you don't need persistence, use InMemoryAgentRunner instead.",
      );
    }

    this.db = new Database(dbPath);
    this.ownershipMode = normalizeOwnershipMode(options.ownership?.mode);
    this.initializeSchema();
  }

  private initializeSchema(): void {
    initializeSchema(this.db);
    backfillThreadMetadata(this.db);
  }

  private storeRun(
    threadId: string,
    runId: string,
    events: BaseEvent[],
    input: RunAgentInput,
    agentId: string,
    ownerId: string | null | undefined,
    parentRunId?: string | null,
  ): void {
    // Compact ONLY the events from this run
    const compactedEvents = compactEvents(events);

    const stmt = this.db.prepare(`
      INSERT INTO agent_runs (thread_id, run_id, parent_run_id, agent_id, owner_id, events, input, created_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      threadId,
      runId,
      parentRunId ?? null,
      agentId,
      ownerId ?? null,
      JSON.stringify(compactedEvents), // Store only this run's compacted events
      JSON.stringify(input),
      Date.now(),
      SCHEMA_VERSION,
    );
  }

  private getHistoricRuns(threadId: string): ReturnType<typeof listAgentRuns> {
    return listAgentRuns(this.db, threadId);
  }

  private getLatestRunId(threadId: string): string | null {
    const stmt = this.db.prepare(`
      SELECT run_id FROM agent_runs 
      WHERE thread_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `);

    const result = stmt.get(threadId) as { run_id: string } | undefined;
    return result?.run_id ?? null;
  }

  private setRunState(
    threadId: string,
    isRunning: boolean,
    ownerId: string | null | undefined,
    runId?: string,
  ): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO run_state (thread_id, owner_id, is_running, current_run_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      threadId,
      ownerId ?? null,
      isRunning ? 1 : 0,
      runId ?? null,
      Date.now(),
    );
  }

  private getRunState(
    threadId: string,
    ownership?: OwnershipContext,
  ): {
    isRunning: boolean;
    currentRunId: string | null;
  } {
    const ownerId = getOwnershipOwnerId(this.ownershipMode, ownership);
    if (
      this.ownershipMode !== "disabled" &&
      !this.isThreadAccessible(threadId, ownership)
    ) {
      return {
        isRunning: false,
        currentRunId: null,
      };
    }

    const stmt = this.db.prepare(`
      SELECT is_running, current_run_id FROM run_state
      WHERE thread_id = @threadId
      ${this.getOwnerClause("owner_id", ownerId)}
    `);
    const result = stmt.get({ threadId, ownerId }) as
      | { is_running: number; current_run_id: string | null }
      | undefined;

    return {
      isRunning: result?.is_running === 1,
      currentRunId: result?.current_run_id ?? null,
    };
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const ownerId = this.getOwnerIdOrThrow(request.ownership);
    this.assertThreadAccessibleForWrite(request.threadId, request.ownership);

    // Check if thread is already running in database
    const runState = this.getRunState(request.threadId, request.ownership);
    if (runState.isRunning) {
      throw new Error("Thread already running");
    }

    // Mark thread as running in database
    this.setRunState(request.threadId, true, ownerId, request.input.runId);
    upsertThreadRunMetadata(this.db, {
      threadId: request.threadId,
      agentId: request.agent.agentId ?? "default",
      ownerId,
    });

    // Track seen message IDs and current run events in memory for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];

    // Get all previously seen message IDs from historic runs
    const historicRuns = this.getHistoricRuns(request.threadId);
    const historicMessageIds = new Set<string>();
    for (const run of historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
        if (event.type === EventType.RUN_STARTED) {
          const runStarted = event as RunStartedEvent;
          const messages = runStarted.input?.messages ?? [];
          for (const message of messages) {
            historicMessageIds.add(message.id);
          }
        }
      }
    }

    // Get or create subject for this thread's connections
    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    const prevConnection = ACTIVE_CONNECTIONS.get(request.threadId);
    const prevSubject = prevConnection?.subject;

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);

    // Update the active connection for this thread
    ACTIVE_CONNECTIONS.set(request.threadId, {
      subject: nextSubject,
      agent: request.agent,
      runSubject,
      currentEvents: currentRunEvents,
      stopRequested: false,
    });

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const parentRunId = this.getLatestRunId(request.threadId);

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            let processedEvent: BaseEvent = event;
            if (event.type === EventType.RUN_STARTED) {
              const runStartedEvent = event as RunStartedEvent;
              if (!runStartedEvent.input) {
                const sanitizedMessages = request.input.messages
                  ? request.input.messages.filter(
                      (message) => !historicMessageIds.has(message.id),
                    )
                  : undefined;
                const updatedInput = {
                  ...request.input,
                  ...(sanitizedMessages !== undefined
                    ? { messages: sanitizedMessages }
                    : {}),
                };
                processedEvent = {
                  ...runStartedEvent,
                  input: updatedInput,
                } as RunStartedEvent;
              }
            }

            runSubject.next(processedEvent); // For run() return - only agent events
            nextSubject.next(processedEvent); // For connect() / store - all events
            currentRunEvents.push(processedEvent); // Accumulate for database storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Mark input messages as seen without emitting duplicates
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                }
              }
            }
          },
        });

        const connection = ACTIVE_CONNECTIONS.get(request.threadId);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: connection?.stopRequested ?? false,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run in database
        this.storeRun(
          request.threadId,
          request.input.runId,
          currentRunEvents,
          request.input,
          request.agent.agentId ?? "default",
          ownerId,
          parentRunId,
        );
        upsertThreadRunMetadata(this.db, {
          threadId: request.threadId,
          agentId: request.agent.agentId ?? "default",
          ownerId,
        });

        // Mark run as complete in database
        this.setRunState(request.threadId, false, ownerId);

        if (connection) {
          connection.agent = undefined;
          connection.runSubject = undefined;
          connection.currentEvents = undefined;
          connection.stopRequested = false;
        }

        // Complete the subjects
        runSubject.complete();
        nextSubject.complete();

        ACTIVE_CONNECTIONS.delete(request.threadId);
      } catch {
        const connection = ACTIVE_CONNECTIONS.get(request.threadId);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: connection?.stopRequested ?? false,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run even if it failed (partial events)
        if (currentRunEvents.length > 0) {
          this.storeRun(
            request.threadId,
            request.input.runId,
            currentRunEvents,
            request.input,
            request.agent.agentId ?? "default",
            ownerId,
            parentRunId,
          );
          upsertThreadRunMetadata(this.db, {
            threadId: request.threadId,
            agentId: request.agent.agentId ?? "default",
            ownerId,
          });
        }

        // Mark run as complete in database
        this.setRunState(request.threadId, false, ownerId);

        if (connection) {
          connection.agent = undefined;
          connection.runSubject = undefined;
          connection.currentEvents = undefined;
          connection.stopRequested = false;
        }

        // Don't emit error to the subject, just complete it
        // This allows subscribers to get events emitted before the error
        runSubject.complete();
        nextSubject.complete();

        ACTIVE_CONNECTIONS.delete(request.threadId);
      }
    };

    // Bridge previous events if they exist
    if (prevSubject) {
      prevSubject.subscribe({
        next: (e) => nextSubject.next(e),
        error: (err) => nextSubject.error(err),
        complete: () => {
          // Don't complete nextSubject here - it needs to stay open for new events
        },
      });
    }

    // Start the agent execution immediately (not lazily)
    runAgent();

    // Return the run subject (only agent events, no injected messages)
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);
    if (!this.isThreadAccessible(request.threadId, request.ownership)) {
      connectionSubject.complete();
      return connectionSubject.asObservable();
    }

    // Load historic runs from database
    const historicRuns = this.getHistoricRuns(request.threadId);

    // Collect all historic events from database
    const allHistoricEvents: BaseEvent[] = [];
    for (const run of historicRuns) {
      allHistoricEvents.push(...run.events);
    }

    // Compact all events together before emitting
    const compactedEvents = compactEvents(allHistoricEvents);

    // Emit compacted events and track message IDs
    const emittedMessageIds = new Set<string>();
    for (const event of compactedEvents) {
      connectionSubject.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    // Bridge active run to connection if exists
    const activeConnection = ACTIVE_CONNECTIONS.get(request.threadId);
    const runState = this.getRunState(request.threadId, request.ownership);

    if (
      activeConnection &&
      (runState.isRunning || activeConnection.stopRequested)
    ) {
      activeConnection.subject.subscribe({
        next: (event) => {
          // Skip message events that we've already emitted from historic
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connectionSubject.next(event);
        },
        complete: () => connectionSubject.complete(),
        error: (err) => connectionSubject.error(err),
      });
    } else {
      // No active run, complete after historic events
      connectionSubject.complete();
    }

    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const runState = this.getRunState(request.threadId, request.ownership);
    return Promise.resolve(runState.isRunning);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const runState = this.getRunState(request.threadId, request.ownership);
    if (!runState.isRunning) {
      return Promise.resolve(false);
    }

    const connection = ACTIVE_CONNECTIONS.get(request.threadId);
    const agent = connection?.agent;

    if (!connection || !agent) {
      return Promise.resolve(false);
    }

    if (connection.stopRequested) {
      return Promise.resolve(false);
    }

    connection.stopRequested = true;
    this.setRunState(
      request.threadId,
      false,
      getOwnershipOwnerId(this.ownershipMode, request.ownership),
    );

    try {
      agent.abortRun();
      return Promise.resolve(true);
    } catch (error) {
      console.error("Failed to abort sqlite agent run", error);
      connection.stopRequested = false;
      this.setRunState(
        request.threadId,
        true,
        getOwnershipOwnerId(this.ownershipMode, request.ownership),
      );
      return Promise.resolve(false);
    }
  }

  private getOwnerIdOrThrow(
    ownership?: OwnershipContext,
  ): string | null | undefined {
    const ownerId = getOwnershipOwnerId(this.ownershipMode, ownership);

    if (this.ownershipMode === "required" && ownerId === null) {
      throw new Error("Owner context required");
    }

    return ownerId;
  }

  private assertThreadAccessibleForWrite(
    threadId: string,
    ownership?: OwnershipContext,
  ): void {
    if (this.ownershipMode === "disabled") {
      return;
    }

    const existingOwner = this.db
      .prepare("SELECT owner_id FROM thread_metadata WHERE thread_id = ?")
      .get(threadId) as { owner_id: string | null } | undefined;

    if (!existingOwner) {
      return;
    }

    const ownerId = this.getOwnerIdOrThrow(ownership);
    const matches =
      ownerId === null
        ? existingOwner.owner_id === null
        : existingOwner.owner_id === ownerId;

    if (!matches) {
      throw new Error(`Thread '${threadId}' is not accessible`);
    }
  }

  private isThreadAccessible(
    threadId: string,
    ownership?: OwnershipContext,
  ): boolean {
    if (this.ownershipMode === "disabled") {
      return true;
    }

    const ownerId = getOwnershipOwnerId(this.ownershipMode, ownership);
    if (this.ownershipMode === "required" && ownerId === null) {
      return false;
    }

    const row = this.db
      .prepare(
        `
          SELECT 1
          FROM thread_metadata
          WHERE thread_id = @threadId
          ${this.getOwnerClause("owner_id", ownerId)}
        `,
      )
      .get({ threadId, ownerId }) as { 1: number } | undefined;

    if (row) {
      return true;
    }

    const runStateRow = this.db
      .prepare(
        `
          SELECT 1
          FROM run_state
          WHERE thread_id = @threadId
          ${this.getOwnerClause("owner_id", ownerId)}
        `,
      )
      .get({ threadId, ownerId }) as { 1: number } | undefined;

    return !!runStateRow;
  }

  private getOwnerClause(
    columnName: string,
    ownerId: string | null | undefined,
  ): string {
    if (this.ownershipMode === "disabled") {
      return "";
    }

    return ownerId === null
      ? `AND ${columnName} IS NULL`
      : `AND ${columnName} = @ownerId`;
  }

  /**
   * Close the database connection (for cleanup)
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
