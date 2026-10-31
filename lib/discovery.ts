import { createHash } from "node:crypto";
import { Abandoned, db, epochGuard, now, uid } from "./db";
import { agentTurn, agentVerdict, synthesizeMatch, timeAgo, type MatchDraft } from "./agents";
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
import type { AgentMessage, ConversationOutcome, Discovery, RunEvent, User } from "./types";

const MAX_CONVERSATIONS = 4;
const MAX_TURNS = 8;
const MIN_TURNS = 4;
const RECENT_CONTACT_DAYS = 45;
const MIN_TURN_MS = 2200; // keeps the live feed readable even when the model is fast
// A run older than this is treated as dead (stalled network, crashed task) and a new one may start.
const RUN_WATCHDOG_MS = 4 * 60 * 1000;
const DECLINE_COOLDOWN_DAYS = 30;
// Runs the watchdog gave up on. Their background work checks this and stops writing.
const cancelledRuns = new Set<string>();

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

// Kick off a discovery run in the background and return its id. One active run per user: if one is
// already going, its id comes back with resumed=true so the client treats the backlog as history.
export function startRun(userId: string): { runId: string; resumed: boolean } {
  const current = latestRun(userId);
  if (current && current.status === "running") {
    if (Date.now() - new Date(current.created_at).getTime() < RUN_WATCHDOG_MS) return { runId: current.id, resumed: true };
    cancelledRuns.add(current.id);
    db().prepare("UPDATE runs SET status = 'error', finished_at = ? WHERE id = ?").run(now(), current.id);
    emit(current.id, { type: "run_error", runId: current.id, error: "Run timed out" });
  }
  const runId = uid("run");
  db().prepare("INSERT INTO runs (id, user_id, status, created_at) VALUES (?,?,?,?)").run(runId, userId, "running", now());
  void execute(runId, userId);
  return { runId, resumed: false };
}

function recentlyDeclined(x: string, y: string) {
  const since = new Date(Date.now() - DECLINE_COOLDOWN_DAYS * 86400000).toISOString();
  return !!db()
    .prepare(
      "SELECT 1 FROM matches WHERE ((a = ? AND b = ?) OR (a = ? AND b = ?)) AND (status_a = 'declined' OR status_b = 'declined') AND created_at > ? LIMIT 1",
    )
    .get(x, y, y, x, since);
}

async function execute(runId: string, userId: string) {
  const epochOk = epochGuard();
  const guard = () => {
    epochOk();
    if (cancelledRuns.has(runId)) throw new Abandoned("run cancelled by watchdog");
  };
  const say = (ev: RunEvent) => {
    guard();
    emit(runId, ev);
  };
  try {
    say({ type: "run_started", runId, userId });
    const me = getUser(userId);
    if (!me) throw new Error("unknown user");
    const others = listUsers().filter((u) => u.id !== userId);
    const vecs = await embeddings([me, ...others]);
    guard();

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
      } else if (recentlyDeclined(me.id, u.id)) {
        eligible = false;
        reason = "Passed on recently";
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

    say({
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
        return converse(runId, me, p.user, p.similarity, p.relation, say, guard);
      }),
    );
    const matches = results.reduce((s: number, n) => s + n, 0);
    say({ type: "run_done", runId, matches });
    db().prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").run(now(), runId);
  } catch (e) {
    if (e instanceof Abandoned) return;
    console.error("run failed", e);
    emit(runId, { type: "run_error", runId, error: e instanceof Error ? e.message : String(e) });
    db().prepare("UPDATE runs SET status = 'error', finished_at = ? WHERE id = ?").run(now(), runId);
  }
}

// Runs one agent-to-agent conversation. Only a reset escapes; any other failure closes the conversation in the UI.
async function converse(
  runId: string,
  a: User,
  b: User,
  similarity: number,
  relation: "friend" | "stranger",
  say: (ev: RunEvent) => void,
  guard: () => void,
): Promise<number> {
  guard();
  const convId = uid("conv");
  db()
    .prepare("INSERT INTO conversations (id, run_id, a, b, relation, similarity, status, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(convId, runId, a.id, b.id, relation, similarity, "active", now());
  say({ type: "conversation_started", conversationId: convId, a: a.id, b: b.id, relation, similarity });

  try {
    return await converseInner(convId, a, b, say, guard);
  } catch (e) {
    if (e instanceof Abandoned) throw e;
    console.error("conversation failed", e);
    const outcome: ConversationOutcome = { verdicts: {}, matchId: null, summary: "The connection dropped before the agents finished - no intro this time." };
    db().prepare("UPDATE conversations SET status = 'error', outcome = ? WHERE id = ?").run(JSON.stringify(outcome), convId);
    say({ type: "conversation_done", conversationId: convId, outcome });
    return 0;
  }
}

async function converseInner(convId: string, a: User, b: User, say: (ev: RunEvent) => void, guard: () => void): Promise<number> {
  const friendship = getFriendship(a.id, b.id);
  const memA = listMemories(a.id);
  const memB = listMemories(b.id);
  const history: AgentMessage[] = [];
  const confirmed: Discovery[] = [];
  const doneBy = new Set<string>();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const speaker = turn % 2 === 0 ? a : b;
    const listener = speaker === a ? b : a;
    say({ type: "thinking", conversationId: convId, sender: speaker.id });
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

    guard();
    const res = db()
      .prepare("INSERT INTO messages (conversation_id, sender, seq, type, text, thought, discoveries, interest, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(convId, speaker.id, turn, out.type, out.text, out.thought, JSON.stringify(fresh), out.interest, now());
    const msg = toAgentMessage(db().prepare("SELECT * FROM messages WHERE id = ?").get(res.lastInsertRowid) as Record<string, unknown>);
    history.push(msg);
    say({ type: "message", message: msg });

    if (out.done && turn + 1 >= MIN_TURNS) doneBy.add(speaker.id);
    // Stop once both agents are ready, or one concludes with no interest after the minimum.
    if (doneBy.size === 2) break;
    if (out.type === "conclude" && turn + 1 >= MIN_TURNS && doneBy.has(speaker.id) && out.interest < 40) break;
    if (doneBy.size === 1 && out.type === "conclude" && turn + 1 >= MIN_TURNS + 2) break;
  }

  say({ type: "deliberating", conversationId: convId });
  const [va, vb] = await Promise.all([
    agentVerdict({ self: a, selfMemories: memA, other: b, friendship, history }),
    agentVerdict({ self: b, selfMemories: memB, other: a, friendship, history }),
  ]);
  say({ type: "verdict", conversationId: convId, sender: a.id, verdict: va });
  await sleep(500);
  say({ type: "verdict", conversationId: convId, sender: b.id, verdict: vb });

  let matchId: string | null = null;
  // Another person's run may have introduced this pair in the meantime.
  const agreed = va.recommend && vb.recommend;
  let both = agreed && !existingMatch(a.id, b.id);
  let card: MatchDraft | null = null;
  if (both) {
    try {
      card = await synthesizeMatch({ a, b, friendship, history, discoveries: confirmed, verdictA: va, verdictB: vb });
    } catch (e) {
      console.error("match card failed, using fallback", e);
      card = fallbackDraft(a, b, !!friendship, confirmed);
    }
    guard();
    // Re-check after the await: a concurrent run may have just introduced this pair.
    // The check and the insert run in one synchronous step, so no other run can slip in between.
    if (existingMatch(a.id, b.id)) both = false;
  }
  if (both) {
    const draft = card!;
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
    : agreed
      ? "Both agents said yes, but these two already have an intro open."
      : va.recommend || vb.recommend
        ? `Only ${va.recommend ? a.firstName : b.firstName}'s agent was convinced - no intro.`
        : "Neither agent saw a strong enough reason - no intro.";
  const outcome: ConversationOutcome = { verdicts: { [a.id]: va, [b.id]: vb }, matchId, summary };
  guard();
  db().prepare("UPDATE conversations SET status = 'done', outcome = ? WHERE id = ?").run(JSON.stringify(outcome), convId);

  // Each agent remembers what came up. Built from confirmed overlaps only: verdict reasons can draw on
  // private context, and these notes are treated as shareable.
  const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const learned = confirmed.map((d) => d.label).join(", ");
  addMemory(a.id, "agent_note", noteFor(day, b, learned, both), "conversation");
  addMemory(b.id, "agent_note", noteFor(day, a, learned, both), "conversation");

  say({ type: "conversation_done", conversationId: convId, outcome });
  if (matchId) {
    const m = getMatch(matchId);
    if (m) say({ type: "match", match: m });
  }
  return matchId ? 1 : 0;
}

// Used only if the match-card call fails after both agents agreed, so the intro isn't lost.
function fallbackDraft(a: User, b: User, reconnect: boolean, confirmed: Discovery[]): MatchDraft {
  const shared = confirmed.map((d) => d.label).slice(0, 5);
  const top = confirmed[0];
  const verb = reconnect ? "reconnect" : "meet";
  return {
    headline: top ? top.label : reconnect ? "Worth reconnecting" : "Worth meeting",
    explanation: confirmed.map((d) => d.detail).slice(0, 3).join(" ") || `Both agents think ${a.firstName} and ${b.firstName} would get along.`,
    shared,
    activity: {
      title: top ? `Get together over ${top.label.toLowerCase()}` : "Grab a coffee",
      when: "Sometime in the next two weeks",
      where: "Somewhere convenient for both",
      why: "Your agents found real common ground.",
    },
    invite_a: `I talked with ${b.firstName}'s agent and think you two should ${verb}${shared.length ? `: ${shared.join(", ")}` : ""}.`,
    invite_b: `I talked with ${a.firstName}'s agent and think you two should ${verb}${shared.length ? `: ${shared.join(", ")}` : ""}.`,
  };
}

function noteFor(day: string, other: User, learned: string, matched: boolean) {
  return `${day}: talked with ${other.firstName}'s agent. ${learned ? `Overlaps: ${learned}.` : "No strong overlap found."}${matched ? " Both agents proposed an intro." : ""}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
