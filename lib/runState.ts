import type { AgentMessage, ConversationOutcome, Discovery, Match, RunEvent, Verdict } from "./types";

export type ConvState = {
  id: string;
  a: string;
  b: string;
  relation: "stranger" | "friend";
  similarity: number;
  messages: (AgentMessage & { fresh: boolean; receivedAt: number })[];
  thinking: string | null;
  deliberating: boolean;
  verdicts: Record<string, Verdict>;
  outcome: ConversationOutcome | null;
  discoveries: Discovery[];
  lastActivity: number;
};

export type Candidate = { userId: string; similarity: number; relation: "stranger" | "friend"; reason: string; selected: boolean };

export type RunState = {
  runId: string | null;
  status: "idle" | "starting" | "scanning" | "running" | "done" | "error";
  error: string | null;
  shortlist: Candidate[];
  convs: Record<string, ConvState>;
  order: string[];
  byUser: Record<string, string>;
  matches: Match[];
  freshMatchIds: string[];
};

export const initialRun: RunState = {
  runId: null,
  status: "idle",
  error: null,
  shortlist: [],
  convs: {},
  order: [],
  byUser: {},
  matches: [],
  freshMatchIds: [],
};

export type RunAction = { kind: "reset" } | { kind: "starting" } | { kind: "event"; ev: RunEvent; fresh: boolean } | { kind: "dismissMatch"; id: string };

export function runReducer(s: RunState, act: RunAction): RunState {
  if (act.kind === "reset") return initialRun;
  if (act.kind === "starting") return { ...initialRun, status: "starting" };
  if (act.kind === "dismissMatch") return { ...s, freshMatchIds: s.freshMatchIds.filter((x) => x !== act.id) };
  const { ev, fresh } = act;
  const t = Date.now();
  const patchConv = (id: string, fn: (c: ConvState) => ConvState) => (s.convs[id] ? { ...s, convs: { ...s.convs, [id]: fn(s.convs[id]) } } : s);
  switch (ev.type) {
    case "run_started":
      return { ...initialRun, runId: ev.runId, status: "scanning" };
    case "shortlist":
      return { ...s, shortlist: ev.candidates, status: "running" };
    case "conversation_started":
      return {
        ...s,
        status: "running",
        order: [...s.order, ev.conversationId],
        byUser: { ...s.byUser, [ev.b]: ev.conversationId },
        convs: {
          ...s.convs,
          [ev.conversationId]: {
            id: ev.conversationId,
            a: ev.a,
            b: ev.b,
            relation: ev.relation,
            similarity: ev.similarity,
            messages: [],
            thinking: null,
            deliberating: false,
            verdicts: {},
            outcome: null,
            discoveries: [],
            lastActivity: t,
          },
        },
      };
    case "thinking":
      return patchConv(ev.conversationId, (c) => ({ ...c, thinking: ev.sender, lastActivity: t }));
    case "message":
      return patchConv(ev.message.conversationId, (c) => ({
        ...c,
        thinking: null,
        messages: [...c.messages, { ...ev.message, fresh, receivedAt: t }],
        discoveries: [...c.discoveries, ...ev.message.discoveries],
        lastActivity: t,
      }));
    case "deliberating":
      return patchConv(ev.conversationId, (c) => ({ ...c, thinking: null, deliberating: true, lastActivity: t }));
    case "verdict":
      return patchConv(ev.conversationId, (c) => ({ ...c, verdicts: { ...c.verdicts, [ev.sender]: ev.verdict }, lastActivity: t }));
    case "conversation_done":
      return patchConv(ev.conversationId, (c) => ({ ...c, thinking: null, deliberating: false, outcome: ev.outcome, lastActivity: t }));
    case "match":
      return { ...s, matches: [...s.matches, ev.match], freshMatchIds: fresh ? [...s.freshMatchIds, ev.match.id] : s.freshMatchIds };
    case "run_done":
      return { ...s, status: "done" };
    case "run_error":
      return { ...s, status: "error", error: ev.error };
  }
  return s;
}

// Latest interest each side expressed; drives the meters and node rings.
export function interestOf(c: ConvState) {
  const last: Record<string, number> = {};
  for (const m of c.messages) last[m.sender] = m.interest;
  const vals = Object.values(last);
  return vals.length ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : 0;
}

export function convPhase(c: ConvState): "talking" | "deliberating" | "matched" | "passed" {
  if (c.outcome) return c.outcome.matchId ? "matched" : "passed";
  if (c.deliberating || Object.keys(c.verdicts).length) return "deliberating";
  return "talking";
}
