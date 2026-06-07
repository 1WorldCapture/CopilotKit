import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import type { ThreadRecord } from "@copilotkit/runtime/v2";

export const SCHEMA_VERSION = 3;

export interface AgentRunRecord {
  id: number;
  thread_id: string;
  run_id: string;
  parent_run_id: string | null;
  events: BaseEvent[];
  input: RunAgentInput;
  created_at: number;
  version: number;
  agent_id: string | null;
  owner_id: string | null;
}

interface SchemaVersionRow {
  version: number;
}

interface ThreadMetadataRow {
  thread_id: string;
  agent_id: string;
  name: string | null;
  archived: number;
  organization_id: string;
  created_by_id: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  owner_id: string | null;
}

export function initializeSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      run_id TEXT NOT NULL UNIQUE,
      parent_run_id TEXT,
      agent_id TEXT,
      owner_id TEXT,
      events TEXT NOT NULL,
      input TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      version INTEGER NOT NULL
    )
  `);

  const agentRunsColumns = db
    .prepare("PRAGMA table_info(agent_runs)")
    .all() as Array<{ name: string }>;
  if (!agentRunsColumns.some((column) => column.name === "agent_id")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN agent_id TEXT");
  }
  if (!agentRunsColumns.some((column) => column.name === "owner_id")) {
    db.exec("ALTER TABLE agent_runs ADD COLUMN owner_id TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS run_state (
      thread_id TEXT PRIMARY KEY,
      owner_id TEXT,
      is_running INTEGER DEFAULT 0,
      current_run_id TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  const runStateColumns = db
    .prepare("PRAGMA table_info(run_state)")
    .all() as Array<{ name: string }>;
  if (!runStateColumns.some((column) => column.name === "owner_id")) {
    db.exec("ALTER TABLE run_state ADD COLUMN owner_id TEXT");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS thread_metadata (
      thread_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT,
      name TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      organization_id TEXT NOT NULL DEFAULT '',
      created_by_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_run_at INTEGER
    )
  `);
  const threadMetadataColumns = db
    .prepare("PRAGMA table_info(thread_metadata)")
    .all() as Array<{ name: string }>;
  if (!threadMetadataColumns.some((column) => column.name === "owner_id")) {
    db.exec("ALTER TABLE thread_metadata ADD COLUMN owner_id TEXT");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_thread_id ON agent_runs(thread_id);
    CREATE INDEX IF NOT EXISTS idx_parent_run_id ON agent_runs(parent_run_id);
    CREATE INDEX IF NOT EXISTS idx_thread_metadata_agent_archived_activity
      ON thread_metadata(agent_id, archived, last_run_at DESC, updated_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_thread_metadata_owner_agent_archived_activity
      ON thread_metadata(owner_id, agent_id, archived, last_run_at DESC, updated_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_owner
      ON agent_runs(thread_id, owner_id);
    CREATE INDEX IF NOT EXISTS idx_run_state_thread_owner
      ON run_state(thread_id, owner_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion = db
    .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    .get() as SchemaVersionRow | undefined;

  if (!currentVersion || currentVersion.version < SCHEMA_VERSION) {
    db.prepare(
      "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)",
    ).run(SCHEMA_VERSION, Date.now());
  }
}

export function listAgentRuns(db: any, threadId: string): AgentRunRecord[] {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM agent_runs
        WHERE thread_id = ?
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all(threadId) as Array<{
    id: number;
    thread_id: string;
    run_id: string;
    parent_run_id: string | null;
    events: string;
    input: string;
    created_at: number;
    version: number;
    owner_id?: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    thread_id: row.thread_id,
    run_id: row.run_id,
    parent_run_id: row.parent_run_id,
    events: JSON.parse(row.events),
    input: JSON.parse(row.input),
    created_at: row.created_at,
    version: row.version,
    agent_id:
      "agent_id" in row
        ? ((row as { agent_id?: string | null }).agent_id ?? null)
        : null,
    owner_id:
      "owner_id" in row
        ? ((row as { owner_id?: string | null }).owner_id ?? null)
        : null,
  }));
}

export function backfillThreadMetadata(
  db: any,
  fallbackAgentId?: string,
): number {
  const rows = db
    .prepare(
      `
        SELECT
          ar.thread_id,
          MIN(ar.created_at) AS created_at,
          MAX(ar.created_at) AS updated_at,
          MAX(ar.created_at) AS last_run_at,
          COALESCE(
            (
              SELECT ar2.agent_id
              FROM agent_runs ar2
              WHERE ar2.thread_id = ar.thread_id
                AND ar2.agent_id IS NOT NULL
                AND ar2.agent_id != ''
              ORDER BY ar2.created_at DESC, ar2.id DESC
              LIMIT 1
            ),
            ''
          ) AS agent_id
          ,
          (
            SELECT ar2.owner_id
            FROM agent_runs ar2
            WHERE ar2.thread_id = ar.thread_id
              AND ar2.owner_id IS NOT NULL
              AND ar2.owner_id != ''
            ORDER BY ar2.created_at DESC, ar2.id DESC
            LIMIT 1
          ) AS owner_id
        FROM agent_runs ar
        LEFT JOIN thread_metadata tm ON tm.thread_id = ar.thread_id
        WHERE tm.thread_id IS NULL
        GROUP BY ar.thread_id
      `,
    )
    .all() as Array<{
    thread_id: string;
    created_at: number;
    updated_at: number;
    last_run_at: number;
    agent_id: string;
    owner_id: string | null;
  }>;

  const insert = db.prepare(
    `
      INSERT OR IGNORE INTO thread_metadata (
        thread_id,
        agent_id,
        owner_id,
        created_at,
        updated_at,
        last_run_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  );

  let inserted = 0;
  for (const row of rows) {
    const agentId = row.agent_id || fallbackAgentId;
    if (!agentId) continue;
    const result = insert.run(
      row.thread_id,
      agentId,
      row.owner_id,
      row.created_at,
      row.updated_at,
      row.last_run_at,
    );
    inserted += Number(result.changes ?? 0);
  }

  return inserted;
}

export function upsertThreadRunMetadata(
  db: any,
  params: {
    threadId: string;
    agentId: string;
    ownerId?: string | null;
    occurredAt?: number;
  },
): void {
  const occurredAt = params.occurredAt ?? Date.now();
  db.prepare(
    `
      INSERT INTO thread_metadata (
        thread_id,
        agent_id,
        owner_id,
        created_at,
        updated_at,
        last_run_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        agent_id = excluded.agent_id,
        owner_id = excluded.owner_id,
        updated_at = excluded.updated_at,
        last_run_at = excluded.last_run_at
    `,
  ).run(
    params.threadId,
    params.agentId,
    params.ownerId ?? null,
    occurredAt,
    occurredAt,
    occurredAt,
  );
}

export function getThreadMetadata(
  db: any,
  threadId: string,
): ThreadRecord | null {
  const row = db
    .prepare("SELECT * FROM thread_metadata WHERE thread_id = ?")
    .get(threadId) as ThreadMetadataRow | undefined;

  return row ? mapThreadMetadataRow(row) : null;
}

export function mapThreadMetadataRow(row: ThreadMetadataRow): ThreadRecord {
  return {
    id: row.thread_id,
    name: row.name,
    agentId: row.agent_id,
    organizationId: row.organization_id,
    createdById: row.created_by_id,
    archived: row.archived === 1,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.last_run_at != null
      ? { lastRunAt: new Date(row.last_run_at).toISOString() }
      : {}),
  };
}
