/**
 * chat-db.js — SQLite-backed chat history + events persistence for Hermes Office.
 * Ported from Claude-Office server/chat-db.js (MIT).
 *
 * DB location: <repo>/data/office.db (override with OFFICE_DATA_DIR)
 * WAL mode for concurrent read performance.
 */
import Database from "better-sqlite3";
import { join } from "path";
import { config } from "./config.js";

const DB_PATH = join(config.dataDir, "office.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sender     TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT 'default',
  text       TEXT    NOT NULL,
  timestamp  INTEGER NOT NULL,
  is_system  INTEGER NOT NULL DEFAULT 0,
  reactions  TEXT    NOT NULL DEFAULT '[]',
  thread_id  INTEGER,
  seen       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (timestamp);
`);

// Prepared statements
const stmtInsert = db.prepare(
  "INSERT INTO messages (sender, role, text, timestamp, is_system, thread_id) " +
    "VALUES (@sender, @role, @text, @timestamp, @isSystem, @threadId)"
);
const stmtGetAll = db.prepare(
  "SELECT * FROM (SELECT * FROM messages ORDER BY timestamp DESC, id DESC LIMIT @limit) " +
    "ORDER BY timestamp ASC, id ASC"
);
const stmtGetSince = db.prepare(
  "SELECT * FROM messages WHERE timestamp > @since ORDER BY timestamp ASC, id ASC LIMIT @limit"
);
const stmtMarkSeen = db.prepare("UPDATE messages SET seen = 1 WHERE id = @id");
const stmtGetReactions = db.prepare("SELECT reactions FROM messages WHERE id = @id");
const stmtSetReactions = db.prepare("UPDATE messages SET reactions = @reactions WHERE id = @id");
const stmtGetThread = db.prepare(
  "SELECT * FROM messages WHERE thread_id = @threadId ORDER BY timestamp ASC, id ASC"
);
const stmtGetById = db.prepare("SELECT * FROM messages WHERE id = @id");
const stmtDeleteAll = db.prepare("DELETE FROM messages");

export function addMessage({ sender, role = "default", text, isSystem = false, threadId = null }) {
  const timestamp = Date.now();
  const info = stmtInsert.run({
    sender,
    role,
    text,
    timestamp,
    isSystem: isSystem ? 1 : 0,
    threadId: threadId ?? null,
  });
  return stmtGetById.get({ id: info.lastInsertRowid });
}

export function getMessages({ since = 0, limit = 50 } = {}) {
  if (since) return stmtGetSince.all({ since, limit });
  return stmtGetAll.all({ limit });
}

export function markSeen(messageId) {
  stmtMarkSeen.run({ id: messageId });
}

export function addReaction(messageId, emoji) {
  const row = stmtGetReactions.get({ id: messageId });
  if (!row) return [];
  let reactions;
  try {
    reactions = JSON.parse(row.reactions);
    if (!Array.isArray(reactions)) reactions = [];
  } catch {
    reactions = [];
  }
  const idx = reactions.indexOf(emoji);
  if (idx === -1) reactions.push(emoji);
  else reactions.splice(idx, 1);
  stmtSetReactions.run({ id: messageId, reactions: JSON.stringify(reactions) });
  return reactions;
}

export function getThread(threadId) {
  return stmtGetThread.all({ threadId });
}

export function clearMessages() {
  stmtDeleteAll.run();
}

export default db;
