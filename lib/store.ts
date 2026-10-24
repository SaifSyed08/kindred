import { db, now } from "./db";
import type { AgentMessage, ChatMessage, Friendship, Match, Memory, Profile, RunEvent, User } from "./types";

type Row = Record<string, unknown>;

const toUser = (r: Row): User => ({
  id: r.id as string,
  name: r.name as string,
  firstName: r.first_name as string,
  age: (r.age as number) ?? null,
  city: (r.city as string) ?? null,
  pronouns: (r.pronouns as string) ?? null,
  tagline: (r.tagline as string) ?? "",
  hue: r.hue as number,
  profile: JSON.parse(r.profile as string) as Profile,
});

export function listUsers(): User[] {
  return (db().prepare("SELECT * FROM users ORDER BY created_at, rowid").all() as Row[]).map(toUser);
}

export function getUser(id: string): User | null {
  const r = db().prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return r ? toUser(r) : null;
}

export function saveProfile(id: string, profile: Profile, tagline?: string) {
  if (tagline !== undefined) {
    db().prepare("UPDATE users SET profile = ?, tagline = ? WHERE id = ?").run(JSON.stringify(profile), tagline, id);
  } else {
    db().prepare("UPDATE users SET profile = ? WHERE id = ?").run(JSON.stringify(profile), id);
  }
}

export function getEmbedding(id: string): { vec: number[]; key: string } | null {
  const r = db().prepare("SELECT embedding, embedding_key FROM users WHERE id = ?").get(id) as Row | undefined;
  if (!r?.embedding) return null;
  return { vec: JSON.parse(r.embedding as string), key: r.embedding_key as string };
}

export function setEmbedding(id: string, vec: number[], key: string) {
  db().prepare("UPDATE users SET embedding = ?, embedding_key = ? WHERE id = ?").run(JSON.stringify(vec), key, id);
}

const toMemory = (r: Row): Memory => ({
  id: r.id as number,
  userId: r.user_id as string,
  kind: r.kind as Memory["kind"],
  text: r.text as string,
  source: r.source as string,
  createdAt: r.created_at as string,
});

export function listMemories(userId: string): Memory[] {
  return (db().prepare("SELECT * FROM memories WHERE user_id = ? ORDER BY id").all(userId) as Row[]).map(toMemory);
}

export function addMemory(userId: string, kind: Memory["kind"], text: string, source: string) {
  db().prepare("INSERT INTO memories (user_id, kind, text, source, created_at) VALUES (?,?,?,?,?)").run(userId, kind, text, source, now());
}

export function deleteMemory(userId: string, id: number) {
  db().prepare("DELETE FROM memories WHERE id = ? AND user_id = ?").run(id, userId);
}

export function getFriendship(x: string, y: string): Friendship | null {
  const r = db()
    .prepare("SELECT * FROM friendships WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)")
    .get(x, y, y, x) as Row | undefined;
  return r ? { a: r.a as string, b: r.b as string, context: r.context as string, lastSpoke: r.last_spoke as string } : null;
}

export function listFriendships(userId: string): Friendship[] {
  return (db().prepare("SELECT * FROM friendships WHERE a = ? OR b = ?").all(userId, userId) as Row[]).map((r) => ({
    a: r.a as string,
    b: r.b as string,
    context: r.context as string,
    lastSpoke: r.last_spoke as string,
  }));
}

export function touchFriendship(x: string, y: string, context: string) {
  const f = getFriendship(x, y);
  if (f) db().prepare("UPDATE friendships SET last_spoke = ? WHERE a = ? AND b = ?").run(now(), f.a, f.b);
  else db().prepare("INSERT INTO friendships (a, b, context, last_spoke) VALUES (?,?,?,?)").run(x, y, context, now());
}

export function agentChatHistory(userId: string, limit = 30): { role: "user" | "agent"; text: string; createdAt: string }[] {
  const rows = db()
    .prepare("SELECT role, text, created_at FROM agent_chat WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, limit) as Row[];
  return rows.reverse().map((r) => ({ role: r.role as "user" | "agent", text: r.text as string, createdAt: r.created_at as string }));
}

export function addAgentChat(userId: string, role: "user" | "agent", text: string) {
  db().prepare("INSERT INTO agent_chat (user_id, role, text, created_at) VALUES (?,?,?,?)").run(userId, role, text, now());
}

// ---- discovery runs ----

export function emit(runId: string, ev: RunEvent) {
  db().prepare("INSERT INTO events (run_id, type, data, created_at) VALUES (?,?,?,?)").run(runId, ev.type, JSON.stringify(ev), now());
}

export function eventsSince(runId: string, afterId: number): { id: number; ev: RunEvent }[] {
  const rows = db().prepare("SELECT id, data FROM events WHERE run_id = ? AND id > ? ORDER BY id").all(runId, afterId) as Row[];
  return rows.map((r) => ({ id: r.id as number, ev: JSON.parse(r.data as string) as RunEvent }));
}

export function getRun(runId: string) {
  return db().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as
    | { id: string; user_id: string; status: string; created_at: string; finished_at: string | null }
    | undefined;
}

export function latestRun(userId: string) {
  return db().prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as
    | { id: string; user_id: string; status: string; created_at: string; finished_at: string | null }
    | undefined;
}

export function toAgentMessage(r: Row): AgentMessage {
  return {
    id: r.id as number,
    conversationId: r.conversation_id as string,
    sender: r.sender as string,
    seq: r.seq as number,
    type: r.type as AgentMessage["type"],
    text: r.text as string,
    thought: (r.thought as string) ?? null,
    discoveries: JSON.parse(r.discoveries as string),
    interest: r.interest as number,
    createdAt: r.created_at as string,
  };
}

export function conversationMessages(conversationId: string): AgentMessage[] {
  return (db().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY seq").all(conversationId) as Row[]).map(toAgentMessage);
}

// ---- matches & chats ----

export const toMatch = (r: Row): Match => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  a: r.a as string,
  b: r.b as string,
  kind: r.kind as Match["kind"],
  score: r.score as number,
  headline: r.headline as string,
  explanation: r.explanation as string,
  shared: JSON.parse(r.shared as string),
  activity: JSON.parse(r.activity as string),
  inviteA: r.invite_a as string,
  inviteB: r.invite_b as string,
  statusA: r.status_a as Match["statusA"],
  statusB: r.status_b as Match["statusB"],
  chatId: (r.chat_id as string) ?? null,
  createdAt: r.created_at as string,
});

export function getMatch(id: string): Match | null {
  const r = db().prepare("SELECT * FROM matches WHERE id = ?").get(id) as Row | undefined;
  return r ? toMatch(r) : null;
}

export function matchesFor(userId: string): Match[] {
  return (db().prepare("SELECT * FROM matches WHERE a = ? OR b = ? ORDER BY created_at DESC").all(userId, userId) as Row[]).map(toMatch);
}

export function existingMatch(x: string, y: string): Match | null {
  const r = db()
    .prepare("SELECT * FROM matches WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND status_a != 'declined' AND status_b != 'declined' ORDER BY created_at DESC LIMIT 1")
    .get(x, y, y, x) as Row | undefined;
  return r ? toMatch(r) : null;
}

const toChatMessage = (r: Row): ChatMessage => ({
  id: r.id as number,
  chatId: r.chat_id as string,
  sender: r.sender as string,
  kind: r.kind as ChatMessage["kind"],
  text: r.text as string,
  meta: r.meta ? JSON.parse(r.meta as string) : null,
  createdAt: r.created_at as string,
});

export function chatMessagesSince(chatId: string, afterId: number): ChatMessage[] {
  return (db().prepare("SELECT * FROM chat_messages WHERE chat_id = ? AND id > ? ORDER BY id").all(chatId, afterId) as Row[]).map(toChatMessage);
}

export function addChatMessage(chatId: string, sender: string, kind: ChatMessage["kind"], text: string, meta?: unknown) {
  db()
    .prepare("INSERT INTO chat_messages (chat_id, sender, kind, text, meta, created_at) VALUES (?,?,?,?,?,?)")
    .run(chatId, sender, kind, text, meta ? JSON.stringify(meta) : null, now());
}
