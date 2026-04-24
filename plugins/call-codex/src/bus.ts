import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type RuntimeState = {
  id: string;
  url: string;
  pid: number | null;
  status: string;
  started_at: string;
  last_seen: string;
};

export type CallStatus = "open" | "cancelled" | "closed";
export type ParticipantStatus =
  | "queued"
  | "running"
  | "blocked"
  | "done"
  | "failed"
  | "cancelled"
  | "closed";

export type CallRow = {
  id: string;
  title: string;
  project: string;
  mode: "fork" | "fresh";
  status: CallStatus;
  summary: string;
  created_at: string;
  closed_at: string | null;
};

export type ParticipantRow = {
  id: string;
  call_id: string;
  name: string;
  role: string;
  brief: string;
  thread_id: string;
  cwd: string;
  status: ParticipantStatus;
  current_task: string;
  active_turn_id: string;
  active_turn_started_at: string | null;
  last_seen: string;
  created_at: string;
};

export type MessageRow = {
  id: number;
  call_id: string;
  from_name: string;
  to_name: string;
  content: string;
  message_type: string;
  priority: string;
  injected_at: string | null;
  read_at: string | null;
  created_at: string;
};

export type WorkerTranscriptItemRow = {
  id: number;
  call_id: string;
  participant: string;
  thread_id: string;
  turn_id: string;
  turn_status: string;
  turn_started_at: number | null;
  turn_completed_at: number | null;
  turn_duration_ms: number | null;
  item_index: number;
  item_type: string;
  item_text: string;
  imported_at: string;
};

const DEFAULT_DB_PATH = join(homedir(), ".codex", "call-codex", "bus.db");

let db: Database | null = null;
let dbPath = DEFAULT_DB_PATH;

function now() {
  return new Date().toISOString();
}

export function getDefaultDbPath() {
  return DEFAULT_DB_PATH;
}

export function getDbPath() {
  return dbPath;
}

export function getDb(path = DEFAULT_DB_PATH) {
  if (db) return db;

  dbPath = path;
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode=WAL;");
  db.run("PRAGMA synchronous=NORMAL;");
  db.run("PRAGMA foreign_keys=ON;");
  migrate(db);
  return db;
}

export function resetDbForTests(path: string) {
  db?.close();
  db = null;
  return getDb(path);
}

function migrate(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS runtime (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      pid INTEGER,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'fork',
      status TEXT NOT NULL DEFAULT 'open',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      current_task TEXT NOT NULL DEFAULT '',
      active_turn_id TEXT NOT NULL DEFAULT '',
      active_turn_started_at TEXT,
      last_seen TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(call_id, name)
    );
  `);

  try {
    database.run(
      "ALTER TABLE participants ADD COLUMN active_turn_id TEXT NOT NULL DEFAULT '';",
    );
  } catch (error) {
    if (!String(error).includes("duplicate column name")) throw error;
  }

  try {
    database.run(
      "ALTER TABLE participants ADD COLUMN active_turn_started_at TEXT;",
    );
  } catch (error) {
    if (!String(error).includes("duplicate column name")) throw error;
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'note',
      priority TEXT NOT NULL DEFAULT 'normal',
      injected_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS worker_transcript_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
      participant TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      turn_status TEXT NOT NULL,
      turn_started_at INTEGER,
      turn_completed_at INTEGER,
      turn_duration_ms INTEGER,
      item_index INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      item_text TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      UNIQUE(call_id, participant, turn_id, item_index)
    );
  `);
}

export function upsertRuntime(input: {
  url: string;
  pid?: number | null;
  status: string;
}) {
  const database = getDb();
  const stamp = now();
  database.run(
    `INSERT INTO runtime (id, url, pid, status, started_at, last_seen)
     VALUES ('managed-app-server', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       pid = excluded.pid,
       status = excluded.status,
       last_seen = excluded.last_seen`,
    [input.url, input.pid ?? null, input.status, stamp, stamp],
  );
  return getRuntime();
}

export function getRuntime(): RuntimeState | null {
  return getDb()
    .query<
      RuntimeState,
      []
    >("SELECT * FROM runtime WHERE id = 'managed-app-server'")
    .get();
}

export function createCall(input: {
  title: string;
  project?: string;
  mode?: "fork" | "fresh";
  workers: Array<{ name: string; role: string; brief: string }>;
  cwd?: string;
}) {
  const database = getDb();
  const stamp = now();
  const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
  const mode = input.mode ?? "fork";

  database.transaction(() => {
    database.run(
      `INSERT INTO calls (id, title, project, mode, status, summary, created_at)
       VALUES (?, ?, ?, ?, 'open', '', ?)`,
      [callId, input.title, input.project ?? "", mode, stamp],
    );

    for (const worker of input.workers) {
      database.run(
        `INSERT INTO participants
         (id, call_id, name, role, brief, thread_id, cwd, status, current_task, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, '', ?, 'queued', ?, ?, ?)`,
        [
          `participant-${crypto.randomUUID().slice(0, 8)}`,
          callId,
          worker.name,
          worker.role,
          worker.brief,
          input.cwd ?? "",
          worker.brief,
          stamp,
          stamp,
        ],
      );
    }

    addEvent(callId, "call.created", {
      title: input.title,
      mode,
      worker_count: input.workers.length,
    });
  })();

  return getCallBundle(callId);
}

export function getCall(callId: string) {
  return getDb()
    .query<CallRow, [string]>("SELECT * FROM calls WHERE id = ?")
    .get(callId);
}

export function listCalls(filters: { project?: string } = {}) {
  if (filters.project) {
    return getDb()
      .query<
        CallRow,
        [string]
      >("SELECT * FROM calls WHERE project = ? ORDER BY created_at DESC")
      .all(filters.project);
  }

  return getDb()
    .query<CallRow, []>("SELECT * FROM calls ORDER BY created_at DESC")
    .all();
}

export function listParticipants(input: { callId?: string } = {}) {
  if (input.callId) {
    return getDb()
      .query<
        ParticipantRow,
        [string]
      >("SELECT * FROM participants WHERE call_id = ? ORDER BY created_at ASC")
      .all(input.callId);
  }

  return getDb()
    .query<
      ParticipantRow,
      []
    >("SELECT * FROM participants ORDER BY created_at ASC")
    .all();
}

export function getParticipant(input: { callId: string; name: string }) {
  return getDb()
    .query<
      ParticipantRow,
      [string, string]
    >("SELECT * FROM participants WHERE call_id = ? AND name = ?")
    .get(input.callId, input.name);
}

export function setParticipantThreadId(input: {
  callId: string;
  name: string;
  threadId: string;
}) {
  const stamp = now();
  getDb().run(
    `UPDATE participants
     SET thread_id = ?, status = 'running', last_seen = ?
     WHERE call_id = ? AND name = ?`,
    [input.threadId, stamp, input.callId, input.name],
  );
  addEvent(input.callId, "participant.thread_linked", {
    name: input.name,
    thread_id: input.threadId,
  });
  return getParticipant({ callId: input.callId, name: input.name });
}

export function setParticipantActiveTurn(input: {
  callId: string;
  name: string;
  turnId: string;
  currentTask?: string;
}) {
  const stamp = now();
  getDb().run(
    `UPDATE participants
     SET active_turn_id = ?, active_turn_started_at = ?, status = 'running',
       current_task = COALESCE(NULLIF(?, ''), current_task), last_seen = ?
     WHERE call_id = ? AND name = ?`,
    [
      input.turnId,
      stamp,
      input.currentTask ?? "",
      stamp,
      input.callId,
      input.name,
    ],
  );
  addEvent(input.callId, "participant.turn_started", {
    name: input.name,
    turn_id: input.turnId,
  });
  return getParticipant({ callId: input.callId, name: input.name });
}

export function clearParticipantActiveTurn(input: {
  callId: string;
  name: string;
  status?: ParticipantStatus;
  currentTask?: string;
}) {
  const stamp = now();
  getDb().run(
    `UPDATE participants
     SET active_turn_id = '', active_turn_started_at = NULL,
       status = COALESCE(?, status),
       current_task = COALESCE(NULLIF(?, ''), current_task),
       last_seen = ?
     WHERE call_id = ? AND name = ?`,
    [
      input.status ?? null,
      input.currentTask ?? "",
      stamp,
      input.callId,
      input.name,
    ],
  );
  addEvent(input.callId, "participant.turn_cleared", {
    name: input.name,
    status: input.status ?? null,
  });
  return getParticipant({ callId: input.callId, name: input.name });
}

export function getCallBundle(callId: string, includeRecentMessages = true) {
  const call = getCall(callId);
  if (!call) return null;

  return {
    call,
    participants: listParticipants({ callId }),
    recent_messages: includeRecentMessages
      ? listMessages({ callId, limit: 20 })
      : [],
  };
}

export function addMessage(input: {
  callId: string;
  fromName: string;
  toName: string;
  content: string;
  messageType?: string;
  priority?: string;
}) {
  const stamp = now();
  const result = getDb().run(
    `INSERT INTO messages (call_id, from_name, to_name, content, message_type, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.callId,
      input.fromName,
      input.toName,
      input.content,
      input.messageType ?? "note",
      input.priority ?? "normal",
      stamp,
    ],
  );
  addEvent(input.callId, "message.created", {
    from: input.fromName,
    to: input.toName,
    message_id: Number(result.lastInsertRowid),
  });
  return getMessage(Number(result.lastInsertRowid));
}

export function getMessage(id: number) {
  return getDb()
    .query<MessageRow, [number]>("SELECT * FROM messages WHERE id = ?")
    .get(id);
}

export function markMessageInjected(id: number) {
  const stamp = now();
  getDb().run("UPDATE messages SET injected_at = ? WHERE id = ?", [stamp, id]);
  const message = getMessage(id);
  if (message) {
    addEvent(message.call_id, "message.injected", {
      message_id: id,
      to: message.to_name,
      injected_at: stamp,
    });
  }
  return message;
}

export function listMessages(input: {
  callId?: string;
  participant?: string;
  limit?: number;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  if (input.callId && input.participant) {
    return getDb()
      .query<MessageRow, [string, string, string, number]>(
        `SELECT * FROM messages
         WHERE call_id = ? AND (to_name = ? OR from_name = ?)
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(input.callId, input.participant, input.participant, limit);
  }

  if (input.callId) {
    return getDb()
      .query<
        MessageRow,
        [string, number]
      >("SELECT * FROM messages WHERE call_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(input.callId, limit);
  }

  if (input.participant) {
    return getDb()
      .query<MessageRow, [string, string, number]>(
        `SELECT * FROM messages
         WHERE to_name = ? OR from_name = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(input.participant, input.participant, limit);
  }

  return getDb()
    .query<
      MessageRow,
      [number]
    >("SELECT * FROM messages ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

export function updateCall(input: {
  callId: string;
  participant?: string;
  status: ParticipantStatus;
  summary?: string;
  blocker?: string;
}) {
  const database = getDb();
  const stamp = now();
  const currentTask = input.blocker
    ? `Blocked: ${input.blocker}`
    : (input.summary ?? "");

  if (input.participant) {
    database.run(
      `UPDATE participants
       SET status = ?, current_task = COALESCE(NULLIF(?, ''), current_task), last_seen = ?
       WHERE call_id = ? AND name = ?`,
      [input.status, currentTask, stamp, input.callId, input.participant],
    );
  }

  if (!input.participant || input.summary) {
    database.run(
      "UPDATE calls SET summary = COALESCE(?, summary) WHERE id = ?",
      [input.summary ?? null, input.callId],
    );
  }

  addEvent(input.callId, "call.updated", input);
  return getCallBundle(input.callId);
}

export function setCallStatus(
  callId: string,
  status: CallStatus,
  summary?: string,
) {
  const stamp = now();
  const closedAt = status === "closed" || status === "cancelled" ? stamp : null;
  getDb().run(
    "UPDATE calls SET status = ?, summary = COALESCE(?, summary), closed_at = ? WHERE id = ?",
    [status, summary ?? null, closedAt, callId],
  );
  getDb().run("UPDATE participants SET status = ? WHERE call_id = ?", [
    status === "closed" ? "closed" : "cancelled",
    callId,
  ]);
  addEvent(callId, `call.${status}`, { summary: summary ?? "" });
  return getCallBundle(callId);
}

export function addEvent(
  callId: string | null,
  eventType: string,
  payload: unknown,
) {
  getDb().run(
    "INSERT INTO events (call_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)",
    [callId, eventType, JSON.stringify(payload), now()],
  );
}

export function upsertWorkerTranscriptItems(input: {
  callId: string;
  participant: string;
  threadId: string;
  turns: WorkerTranscriptSection["turns"];
}) {
  const stamp = now();
  const database = getDb();
  let imported = 0;

  database.transaction(() => {
    for (const turn of input.turns) {
      turn.entries.forEach((entry, index) => {
        database.run(
          `INSERT INTO worker_transcript_items
           (call_id, participant, thread_id, turn_id, turn_status, turn_started_at,
            turn_completed_at, turn_duration_ms, item_index, item_type, item_text, imported_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(call_id, participant, turn_id, item_index) DO UPDATE SET
             thread_id = excluded.thread_id,
             turn_status = excluded.turn_status,
             turn_started_at = excluded.turn_started_at,
             turn_completed_at = excluded.turn_completed_at,
             turn_duration_ms = excluded.turn_duration_ms,
             item_type = excluded.item_type,
             item_text = excluded.item_text,
             imported_at = excluded.imported_at`,
          [
            input.callId,
            input.participant,
            input.threadId,
            turn.id,
            turn.status,
            turn.started_at,
            turn.completed_at,
            turn.duration_ms,
            index,
            entry.type,
            entry.text,
            stamp,
          ],
        );
        imported += 1;
      });
    }
  })();

  if (imported > 0) {
    addEvent(input.callId, "worker_transcript.imported", {
      participant: input.participant,
      thread_id: input.threadId,
      item_count: imported,
    });
  }

  return imported;
}

export function listWorkerTranscriptItems(callId: string) {
  return getDb()
    .query<WorkerTranscriptItemRow, [string]>(
      `SELECT * FROM worker_transcript_items
       WHERE call_id = ?
       ORDER BY participant ASC, turn_started_at ASC, turn_id ASC, item_index ASC`,
    )
    .all(callId);
}

export type WorkerTranscriptSection = {
  participant: string;
  thread_id: string;
  source: "live" | "cache";
  imported_at: string | null;
  turns: Array<{
    id: string;
    status: string;
    started_at: number | null;
    completed_at: number | null;
    duration_ms: number | null;
    entries: Array<{
      type: string;
      text: string;
    }>;
  }>;
  error?: string;
};

export function buildWorkerTranscriptSectionsFromCache(
  callId: string,
): WorkerTranscriptSection[] {
  const rows = listWorkerTranscriptItems(callId);
  const sections = new Map<string, WorkerTranscriptSection>();

  for (const row of rows) {
    const sectionKey = `${row.participant}\u0000${row.thread_id}`;
    let section = sections.get(sectionKey);
    if (!section) {
      section = {
        participant: row.participant,
        thread_id: row.thread_id,
        source: "cache",
        imported_at: row.imported_at,
        turns: [],
      };
      sections.set(sectionKey, section);
    } else if (
      section.imported_at === null ||
      row.imported_at > section.imported_at
    ) {
      section.imported_at = row.imported_at;
    }

    let turn = section.turns.find((item) => item.id === row.turn_id);
    if (!turn) {
      turn = {
        id: row.turn_id,
        status: row.turn_status,
        started_at: row.turn_started_at,
        completed_at: row.turn_completed_at,
        duration_ms: row.turn_duration_ms,
        entries: [],
      };
      section.turns.push(turn);
    }

    turn.entries.push({
      type: row.item_type,
      text: row.item_text,
    });
  }

  return [...sections.values()];
}

export function buildTranscript(
  callId: string,
  workerSections: WorkerTranscriptSection[] = [],
) {
  const bundle = getCallBundle(callId, false);
  if (!bundle) return null;

  const messages = listMessages({ callId, limit: 100 });
  const lines = [
    `# CALL-CODEX Transcript: ${bundle.call.title}`,
    "",
    `- Call: ${bundle.call.id}`,
    `- Project: ${bundle.call.project || "global"}`,
    `- Mode: ${bundle.call.mode}`,
    `- Status: ${bundle.call.status}`,
    "",
    "## Participants",
    "",
    ...bundle.participants.map(
      (participant) =>
        `- ${participant.name} (${participant.role}) - ${participant.status}`,
    ),
    "",
    "## Messages",
    "",
    ...messages
      .slice()
      .reverse()
      .map(
        (message) =>
          `- ${message.created_at} ${message.from_name} -> ${message.to_name}: ${message.content}`,
      ),
  ];

  if (workerSections.length > 0) {
    lines.push("", "## Worker Output", "");
    for (const worker of workerSections) {
      lines.push(
        `### ${worker.participant}`,
        "",
        `- Thread: ${worker.thread_id}`,
        `- Source: ${worker.source}`,
        `- Imported: ${worker.imported_at ?? "not cached"}`,
      );
      if (worker.error) {
        lines.push(`- Import error: ${worker.error}`, "");
        continue;
      }

      if (worker.turns.length === 0) {
        lines.push("- No worker turns imported.", "");
        continue;
      }

      lines.push("");
      for (const turn of worker.turns) {
        lines.push(
          `#### Turn ${turn.id}`,
          "",
          `- Status: ${turn.status}`,
          `- Started: ${turn.started_at ?? "unknown"}`,
          `- Completed: ${turn.completed_at ?? "pending"}`,
          `- Duration: ${turn.duration_ms ?? "unknown"} ms`,
          "",
        );
        if (turn.entries.length === 0) {
          lines.push("- No transcript entries.", "");
          continue;
        }
        for (const entry of turn.entries) {
          lines.push(`**${entry.type}**`, "", entry.text, "");
        }
      }
    }
  }

  return lines.join("\n");
}
