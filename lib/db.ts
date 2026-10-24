import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";

// node:sqlite ships with Node 22 behind --experimental-sqlite (set in package.json scripts).
// getBuiltinModule keeps the bundler from trying to resolve it.
type SqliteModule = typeof import("node:sqlite");
const sqlite = process.getBuiltinModule("node:sqlite") as SqliteModule | undefined;

export type DB = InstanceType<SqliteModule["DatabaseSync"]>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  age INTEGER,
  city TEXT,
  pronouns TEXT,
  tagline TEXT,
  hue INTEGER NOT NULL,
  profile TEXT NOT NULL,
  embedding TEXT,
  embedding_key TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- fact | private | agent_note
  text TEXT NOT NULL,
  source TEXT NOT NULL,        -- seed | onboarding | conversation
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  context TEXT NOT NULL,
  last_spoke TEXT NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS agent_chat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,          -- user | agent
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,        -- running | done | error
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  relation TEXT NOT NULL,      -- stranger | friend
  similarity REAL NOT NULL,
  status TEXT NOT NULL,        -- active | done | error
  outcome TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  thought TEXT,
  discoveries TEXT NOT NULL,
  interest INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  kind TEXT NOT NULL,          -- new | reconnect
  score INTEGER NOT NULL,
  headline TEXT NOT NULL,
  explanation TEXT NOT NULL,
  shared TEXT NOT NULL,
  activity TEXT NOT NULL,
  invite_a TEXT NOT NULL,
  invite_b TEXT NOT NULL,
  status_a TEXT NOT NULL,      -- pending | accepted | declined
  status_b TEXT NOT NULL,
  chat_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  sender TEXT NOT NULL,        -- user id, agent:<user id>, or system
  kind TEXT NOT NULL,          -- text | activity
  text TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, id);
`;

const g = globalThis as unknown as { __kindredDb?: DB };

export function db(): DB {
  if (g.__kindredDb) return g.__kindredDb;
  if (!sqlite) {
    throw new Error("node:sqlite is unavailable - start the app with `npm run dev` (it passes --experimental-sqlite)");
  }
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const conn = new sqlite.DatabaseSync(path.join(dir, "kindred.db"));
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  conn.exec(SCHEMA);
  const count = conn.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n === 0) seedDatabase(conn);
  // A run that was mid-flight when the server stopped will never finish; close it out.
  conn.prepare("UPDATE runs SET status = 'error', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
  g.__kindredDb = conn;
  return conn;
}

export function resetDatabase() {
  const conn = db();
  conn.exec(`
    DELETE FROM users; DELETE FROM memories; DELETE FROM friendships; DELETE FROM agent_chat;
    DELETE FROM runs; DELETE FROM events; DELETE FROM conversations; DELETE FROM messages;
    DELETE FROM matches; DELETE FROM chat_messages;
  `);
  seedDatabase(conn);
}

export const now = () => new Date().toISOString();

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}
