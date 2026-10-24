import { createHash } from "node:crypto";
import { db, now, uid } from "./db";
import { agentTurn, agentVerdict, synthesizeMatch, timeAgo } from "./agents";
import { embed } from "./llm";
import {
  addMemory,
  emit,
  existingMatch,
  getEmbedding,
  getFriendship,
  getMatch,
  getUser,
  latestRun,
  listMemories,
  listUsers,
  setEmbedding,
  toAgentMessage,
} from "./store";
import type { AgentMessage, ConversationOutcome, Discovery, User, Verdict } from "./types";

const MAX_CONVERSATIONS = 4;
const MAX_TURNS = 8;
const MIN_TURNS = 4;
const RECENT_CONTACT_DAYS = 45;
const MIN_TURN_MS = 2200; // keeps the live feed readable even when the model is fast

const profileText = (u: User) => {
  const p = u.profile;
  return `${p.about}\nInterests: ${p.interests.join(", ")}\nValues: ${p.values.join(", ")}\nLooking for: ${p.lookingFor}\nRecently: ${p.recent.join("; ")}`;
};

async function embeddings(users: User[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const stale: User[] = [];
  for (const u of users) {
    const k = createHash("sha1").update(profileText(u)).digest("hex");
    const cached = getEmbedding(u.id);
    if (cached && cached.key === k) out.set(u.id, cached.vec);
    else stale.push(u);
  }
  if (stale.length) {
    const vecs = await embed(stale.map(profileText));
    stale.forEach((u, i) => {
      out.set(u.id, vecs[i]);
      setEmbedding(u.id, vecs[i], createHash("sha1").update(profileText(u)).digest("hex"));
    });
  }
  return out;
}

const cosine = (x: number[], y: number[]) => {
  let d = 0, nx = 0, ny = 0;
  for (let i = 0; i < x.length; i++) {
    d += x[i] * y[i];
    nx += x[i] * x[i];
    ny += y[i] * y[i];
  }
  return d / (Math.sqrt(nx) * Math.sqrt(ny) || 1);
};

// Kick off a discovery run in the background and return its id. One active run per user.
export function startRun(userId: string): string {
  const current = latestRun(userId);
  if (current && current.status === "running") return current.id;
  const runId = uid("run");
  db().prepare("INSERT INTO runs (id, user_id, status, created_at) VALUES (?,?,?,?)").run(runId, userId, "running", now());
  void execute(runId, userId);
  return runId;
}

async function execute(runId: string, userId: string) {
  try {
    emit(runId, { type: "run_started", runId, userId });
    const me = getUser(userId);
    if (!me) throw new Error("unknown user");
    const others = listUsers().filter((u) => u.id !== userId);
    const vecs = await embeddings([me, ...others]);

    const ranked = others.map((u) => {
      const similarity = cosine(vecs.get(me.id)!, vecs.get(u.id)!);
      const f = getFriendship(me.id, u.id);
      const days = f ? (Date.now() - new Date(f.lastSpoke).getTime()) / 86400000 : Infinity;
      const open = existingMatch(me.id, u.id);
      let reason = `Semantic overlap ${Math.round(similarity * 100)}%`;
      let eligible = true;
      if (open) {
        eligible = false;
        reason = open.chatId ? "Already connected" : "Introduction already pending";
      } else if (f && days < RECENT_CONTACT_DAYS) {
        eligible = false;
        reason = `In touch - talked ${timeAgo(f.lastSpoke)}`;
      } else if (f) {
        reason = `Friend you haven't talked to in ${timeAgo(f.lastSpoke).replace(" ago", "")}`;
      }
      return { user: u, similarity, relation: (f ? "friend" : "stranger") as "friend" | "stranger", reason, eligible };
    });

    // Drifted friends always get a conversation (that's how reconnections surface); strangers fill the rest by overlap.
    const friends = ranked.filter((r) => r.eligible && r.relation === "friend").sort((x, y) => y.similarity - x.similarity);
    const strangers = ranked.filter((r) => r.eligible && r.relation === "stranger").sort((x, y) => y.similarity - x.similarity);
    const picked = [...friends, ...strangers].slice(0, MAX_CONVERSATIONS);
    const pickedIds = new Set(picked.map((p) => p.user.id));

    emit(runId, {
      type: "shortlist",
      candidates: ranked
        .sort((x, y) => y.similarity - x.similarity)
        .map((r) => ({
          userId: r.user.id,
          similarity: r.similarity,
          relation: r.relation,
          reason: r.eligible && !pickedIds.has(r.user.id) ? `Lower overlap (${Math.round(r.similarity * 100)}%) - maybe next time` : r.reason,
          selected: pickedIds.has(r.user.id),
        })),
    });

    // Stagger the starts so the network lights up one edge at a time.
    const results = await Promise.all(
      picked.map(async (p, i) => {
        await sleep(i * 900 + 600);
        return converse(runId, me, p.user, p.similarity, p.relation).catch((e) => {
          console.error("conversation failed", e);
          return 0;
        });
      }),
    );
    const matches = results.reduce((s: number, n) => s + n, 0);
    emit(runId, { type: "run_done", runId, matches });
    db().prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").run(now(), runId);
  } catch (e) {
    console.error("run failed", e);
    emit(runId, { type: "run_error", runId, error: e instanceof Error ? e.message : String(e) });
    db().prepare("UPDATE runs SET status = 'error', finished_at = ? WHERE id = ?").run(now(), runId);
  }
}

async function converse(runId: string, a: User, b: User, similarity: number, relation: "friend" | "stranger"): Promise<number> {
  const convId = uid("conv");
  db()
    .prepare("INSERT INTO conversations (id, run_id, a, b, relation, similarity, status, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(convId, runId, a.id, b.id, relation, similarity, "active", now());
  emit(runId, { type: "conversation_started", conversationId: convId, a: a.id, b: b.id, relation, similarity });

  const friendship = getFriendship(a.id, b.id);
  const memA = listMemories(a.id);
  const memB = listMemories(b.id);
  const history: AgentMessage[] = [];
  const confirmed: Discovery[] = [];
  const doneBy = new Set<string>();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const speaker = turn % 2 === 0 ? a : b;
    const listener = speaker === a ? b : a;
    emit(runId, { type: "thinking", conversationId: convId, sender: speaker.id });
    const started = Date.now();
    const out = await agentTurn({
      self: speaker,
      selfMemories: speaker === a ? memA : memB,
      other: listener,
      friendship,
      history,
      turnIndex: turn,
      maxTurns: MAX_TURNS,
      confirmed,
    });
    const fresh = out.discoveries.filter((d) => !confirmed.some((c) => c.label.toLowerCase() === d.label.toLowerCase())).slice(0, 3);
    confirmed.push(...fresh);
    const wait = MIN_TURN_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);

    const res = db()
      .prepare("INSERT INTO messages (conversation_id, sender, seq, type, text, thought, discoveries, interest, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(convId, speaker.id, turn, out.type, out.text, out.thought, JSON.stringify(fresh), out.interest, now());
    const msg = toAgentMessage(db().prepare("SELECT * FROM messages WHERE id = ?").get(res.lastInsertRowid) as Record<string, unknown>);
    history.push(msg);
    emit(runId, { type: "message", message: msg });

    if (out.done && turn + 1 >= MIN_TURNS) doneBy.add(speaker.id);
    // Stop once both agents are ready, or one concludes with no interest after the minimum.
    if (doneBy.size === 2) break;
    if (out.type === "conclude" && turn + 1 >= MIN_TURNS && doneBy.has(speaker.id) && out.interest < 40) break;
    if (doneBy.size === 1 && out.type === "conclude" && turn + 1 >= MIN_TURNS + 2) break;
  }

  emit(runId, { type: "deliberating", conversationId: convId });
  const [va, vb] = await Promise.all([
    agentVerdict({ self: a, selfMemories: memA, other: b, friendship, history }),
    agentVerdict({ self: b, selfMemories: memB, other: a, friendship, history }),
  ]);
  emit(runId, { type: "verdict", conversationId: convId, sender: a.id, verdict: va });
  await sleep(500);
  emit(runId, { type: "verdict", conversationId: convId, sender: b.id, verdict: vb });

  let matchId: string | null = null;
  const both = va.recommend && vb.recommend;
  if (both) {
    const draft = await synthesizeMatch({ a, b, friendship, history, discoveries: confirmed, verdictA: va, verdictB: vb });
    matchId = uid("match");
    db()
      .prepare(
        `INSERT INTO matches (id, conversation_id, a, b, kind, score, headline, explanation, shared, activity, invite_a, invite_b, status_a, status_b, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending','pending',?)`,
      )
      .run(
        matchId,
        convId,
        a.id,
        b.id,
        friendship ? "reconnect" : "new",
        Math.round((va.score + vb.score) / 2),
        draft.headline,
        draft.explanation,
        JSON.stringify(draft.shared.slice(0, 5)),
        JSON.stringify(draft.activity),
        draft.invite_a,
        draft.invite_b,
        now(),
      );
  }

  const summary = both
    ? `Both agents recommended ${friendship ? "reconnecting" : "an intro"}.`
    : va.recommend || vb.recommend
      ? `Only ${va.recommend ? a.firstName : b.firstName}'s agent was convinced - no intro.`
      : "Neither agent saw a strong enough reason - no intro.";
  const outcome: ConversationOutcome = { verdicts: { [a.id]: va, [b.id]: vb }, matchId, summary };
  db().prepare("UPDATE conversations SET status = 'done', outcome = ? WHERE id = ?").run(JSON.stringify(outcome), convId);

  // Each agent remembers what it learned, so later conversations and onboarding can build on it.
  const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const learned = confirmed.map((d) => d.label).join(", ");
  addMemory(a.id, "agent_note", noteFor(day, b, vb, va, learned, both), "conversation");
  addMemory(b.id, "agent_note", noteFor(day, a, va, vb, learned, both), "conversation");

  emit(runId, { type: "conversation_done", conversationId: convId, outcome });
  if (matchId) {
    const m = getMatch(matchId);
    if (m) emit(runId, { type: "match", match: m });
  }
  return matchId ? 1 : 0;
}

function noteFor(day: string, other: User, _theirs: Verdict, mine: Verdict, learned: string, matched: boolean) {
  return `${day}: talked with ${other.firstName}'s agent. ${learned ? `Overlaps: ${learned}. ` : ""}${mine.reason}${matched ? " Proposed an intro." : ""}`;
}

export function runSnapshot(runId: string) {
  const convs = db().prepare("SELECT * FROM conversations WHERE run_id = ? ORDER BY created_at").all(runId) as Record<string, unknown>[];
  return convs.map((c) => ({
    id: c.id as string,
    a: c.a as string,
    b: c.b as string,
    status: c.status as string,
    outcome: c.outcome ? (JSON.parse(c.outcome as string) as ConversationOutcome) : null,
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
