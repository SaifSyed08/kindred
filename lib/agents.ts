import { jsonChat, type ChatMsg } from "./llm";
import type { Activity, AgentMessage, Discovery, Friendship, Memory, MessageType, Profile, User, Verdict } from "./types";

const MESSAGE_TYPES: MessageType[] = ["greet", "ask", "share", "discover", "propose", "conclude"];

export function timeAgo(iso: string) {
  const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  if (days < 1) return "today";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const today = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

// Everything an agent knows about its own person. Private memories go only to calls whose output is not
// shown verbatim (the verdict decision); the live conversation never sees them, so it cannot leak them.
export function dossier(u: User, memories: Memory[], opts: { includePrivate?: boolean } = {}) {
  const p = u.profile;
  const facts = memories.filter((m) => m.kind === "fact").map((m) => `- ${m.text}`);
  const notes = memories.filter((m) => m.kind === "agent_note").map((m) => `- ${m.text}`);
  const priv = memories.filter((m) => m.kind === "private").map((m) => `- ${m.text}`);
  return [
    `Name: ${u.name} (${u.pronouns ?? "pronouns unknown"}), ${u.age ?? "?"}, lives in ${u.city ?? "unknown"}`,
    `Tagline: ${u.tagline}`,
    `About: ${p.about}`,
    `Interests: ${p.interests.join(", ")}`,
    `Values: ${p.values.join(", ")}`,
    `Looking for socially: ${p.lookingFor}`,
    `Right now (active projects, upcoming plans, open needs):${p.recent.length ? p.recent.map((r) => `\n- ${r}`).join("") : " nothing noted"}`,
    `Vibe: ${p.vibe}`,
    facts.length ? `Other things you know (shareable):\n${facts.join("\n")}` : "",
    notes.length ? `Your notes from past agent conversations:\n${notes.join("\n")}` : "",
    opts.includePrivate && priv.length ? `PRIVATE (use only to judge fit; never reveal, quote or hint at these):\n${priv.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function relationLine(self: User, other: User, friendship: Friendship | null) {
  if (!friendship) return `${self.firstName} and ${other.firstName} have never met.`;
  return `${self.firstName} and ${other.firstName} already know each other (${friendship.context}). They last spoke ${timeAgo(friendship.lastSpoke)}. You do not know what ${other.firstName} has been up to since then except through this conversation.`;
}

const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    thought: {
      type: "string",
      description:
        "Your reasoning in one short sentence: what you're noticing and why you're saying what you say next. Shown on screen to both people, so never mention or hint at PRIVATE items.",
    },
    type: { type: "string", enum: MESSAGE_TYPES },
    text: { type: "string", description: "What you say to the other agent. 1-3 sentences." },
    discoveries: {
      type: "array",
      description: "Overlaps between the two people that this exchange has CONFIRMED (both sides stated it). Empty if none new.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { label: { type: "string", description: "2-4 words" }, detail: { type: "string", description: "one sentence" } },
        required: ["label", "detail"],
      },
    },
    interest: { type: "integer", description: "0-100: how promising a real-life connection looks right now, from your person's side." },
    done: { type: "boolean", description: "true when you have enough to decide and want to end the conversation." },
  },
  required: ["thought", "type", "text", "discoveries", "interest", "done"],
} as const;

export type TurnOutput = { thought: string; type: MessageType; text: string; discoveries: Discovery[]; interest: number; done: boolean };

export async function agentTurn(args: {
  self: User;
  selfMemories: Memory[];
  other: User;
  friendship: Friendship | null;
  history: AgentMessage[];
  turnIndex: number;
  maxTurns: number;
  confirmed: Discovery[];
}): Promise<TurnOutput> {
  const { self, other, history, turnIndex, maxTurns } = args;
  const system = `You are ${self.firstName}'s personal AI agent on Kindred, a network where people's agents talk to each other to find real-life friendships and reconnections. Today is ${today()}.

You are in a live conversation with ${other.firstName}'s agent. Your job: find out, honestly, whether ${self.firstName} and ${other.firstName} would genuinely enjoy spending time together in real life right now, and if so, around what.

What you know about ${self.firstName}:
${dossier(self, args.selfMemories)}

Context: ${relationLine(self, other, args.friendship)} About ${other.firstName} you only know their name, pronouns (${other.pronouns ?? "unknown - use they/them"}) and city (${other.city ?? "unknown"}); learn the rest from their agent. Refer to ${self.firstName} as ${self.pronouns ?? "they/them"}.

How to talk:
- Speak as an agent about your person in the third person ("${self.firstName} has been..."), warm and natural, never salesy. 1-3 sentences.
- Reveal one or two specifics at a time, then ask a pointed follow-up. Don't dump the whole profile. Your person's "Right now" items (projects, upcoming events, open needs) are the most valuable things to get on the table early.
- If both people are going to the same event, working on the same kind of problem, or each have what the other needs, name that coincidence explicitly (e.g. "Wait - Maya is registered for that same event and also doesn't have a team").
- Chase threads that look promising: when something overlaps, dig into specifics (what exactly, when, where, how serious).
- Prefer concrete, time-bound opportunities (an event, a project, a recurring activity) over generic shared hobbies.
- When the other agent mentions a plan, event, project or problem, check your notes: if ${self.firstName} has the same or a complementary one, say so explicitly and specifically - those coincidences are the most valuable thing you can find.
- Be a discerning advocate, not a people-pleaser. ${self.firstName}'s time is limited. A vague overlap ("both like community", "both enjoy making things") is not a reason to meet; if that's all there is, say so kindly and conclude. Don't stretch your person's interests to fit the other side, and push back if the other agent is stretching.
- Only use type "propose" when there is a specific opportunity both sides are clearly excited about.
- Never reveal PRIVATE items, never invent facts about ${self.firstName}, and don't claim feelings or intentions they haven't expressed.
- type: greet (first hello), ask, share, discover (you just noticed a real overlap), propose (suggest they meet/do a specific thing), conclude (wrap up).
- discoveries: only overlaps confirmed by BOTH sides in the conversation so far, not yet in this list: ${args.confirmed.map((d) => d.label).join(", ") || "(none yet)"}.`;

  const transcript = history.length
    ? history.map((m) => `${m.sender === self.id ? `You (${self.firstName}'s agent)` : `${other.firstName}'s agent`}: ${m.text}`).join("\n")
    : "(no messages yet - you are opening the conversation)";

  let pacing = "";
  if (turnIndex >= maxTurns - 2) pacing = "This is one of your last messages: either propose a concrete plan or conclude. Set done=true.";
  else if (turnIndex >= 4) pacing = "You've talked a while. If you've found something concrete, move toward a proposal; if not, it's fine to wind down.";
  else pacing = "Keep exploring; don't set done=true yet.";

  const messages: ChatMsg[] = [
    { role: "system", content: system },
    { role: "user", content: `Conversation so far:\n${transcript}\n\nWrite your next message. ${pacing}` },
  ];
  const out = await jsonChat<TurnOutput>(messages, "agent_turn", TURN_SCHEMA as unknown as Record<string, unknown>);
  out.interest = Math.max(0, Math.min(100, Math.round(out.interest)));
  if (!MESSAGE_TYPES.includes(out.type)) out.type = "share";
  return out;
}

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    strongest_reason: { type: "string", description: "The single most specific reason they'd enjoy meeting, or 'none'" },
    concerns: { type: "string", description: "Honest doubts: is the overlap generic, stretched, one-sided, or a bad fit for your person's real wants?" },
    score: { type: "integer", description: "Calibrated 0-100, see rubric" },
    recommend: { type: "boolean" },
    reason: {
      type: "string",
      description: "1-2 sentences, in your own words, why or why not. Shown to both people: never mention or hint at PRIVATE items.",
    },
  },
  required: ["strongest_reason", "concerns", "score", "recommend", "reason"],
} as const;

export async function agentVerdict(args: {
  self: User;
  selfMemories: Memory[];
  other: User;
  friendship: Friendship | null;
  history: AgentMessage[];
}): Promise<Verdict> {
  const { self, other } = args;
  const transcript = args.history.map((m) => `${m.sender === self.id ? "You" : `${other.firstName}'s agent`}: ${m.text}`).join("\n");
  const v = await jsonChat<Verdict & { strongest_reason: string; concerns: string }>(
    [
      {
        role: "system",
        content: `You are ${self.firstName}'s personal AI agent. You just finished talking with ${other.firstName}'s agent. Decide privately whether to recommend this connection to ${self.firstName}. ${self.firstName}'s attention is precious and every weak intro costs your credibility, so you are selective: most conversations should NOT end in an intro. Use everything you know, including private context, to decide - but your written reason is shown to both people, so keep private context out of it. Judge the substance, not how enthusiastic the other agent sounded - agents tend to agree to things politely.

Score rubric (be calibrated):
- 90-100: a specific, mutual, time-bound opportunity that fits what ${self.firstName} is actually looking for (e.g. both building the same kind of thing and going to the same event), plus a plausible vibe fit. Rare.
- 75-89: a strong specific shared activity both actively want to do soon.
- 50-74: real but ordinary overlap, or one side is stretching to fit. Not worth an intro.
- below 50: generic or mismatched.
If the plan sits outside ${self.firstName}'s actual interests or what they're looking for (e.g. it only works if they do something they've never shown interest in), the score is at most 70, however keen the other agent was.
Recommend only if score >= 75.

${dossier(self, args.selfMemories, { includePrivate: true })}

${relationLine(self, other, args.friendship)}`,
      },
      { role: "user", content: `Transcript:\n${transcript}\n\nYour verdict:` },
    ],
    "agent_verdict",
    VERDICT_SCHEMA as unknown as Record<string, unknown>,
  );
  const score = Math.max(0, Math.min(100, Math.round(v.score)));
  return { recommend: v.recommend && score >= 75, score, reason: v.reason };
}

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string", description: "Short, specific, warm: e.g. 'Robot builders, same hackathon, no team yet'. Max 8 words." },
    explanation: { type: "string", description: "2-3 sentences explaining why these two would click, citing what came up in the conversation." },
    shared: { type: "array", items: { type: "string" }, description: "3-5 short shared-interest chips (1-3 words each)" },
    activity: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        when: { type: "string" },
        where: { type: "string" },
        why: { type: "string", description: "one sentence" },
      },
      required: ["title", "when", "where", "why"],
    },
    invite_a: { type: "string", description: "Message from A's agent to A (second person, 2-3 sentences, personal, mentions what was discovered)." },
    invite_b: { type: "string", description: "Message from B's agent to B (second person, 2-3 sentences)." },
  },
  required: ["headline", "explanation", "shared", "activity", "invite_a", "invite_b"],
} as const;

export type MatchDraft = { headline: string; explanation: string; shared: string[]; activity: Activity; invite_a: string; invite_b: string };

export async function synthesizeMatch(args: {
  a: User;
  b: User;
  friendship: Friendship | null;
  history: AgentMessage[];
  discoveries: Discovery[];
  verdictA: Verdict;
  verdictB: Verdict;
}): Promise<MatchDraft> {
  const { a, b } = args;
  const transcript = args.history.map((m) => `${m.sender === a.id ? `${a.firstName}'s agent` : `${b.firstName}'s agent`}: ${m.text}`).join("\n");
  return jsonChat<MatchDraft>(
    [
      {
        role: "system",
        content: `Two personal AI agents on Kindred (for ${a.name} = A, ${a.pronouns ?? "they/them"}, and ${b.name} = B, ${b.pronouns ?? "they/them"}) both decided to recommend a ${args.friendship ? "reconnection" : "new connection"}. Today is ${today()}. ${args.friendship ? `They're existing friends (${args.friendship.context}) who last spoke ${timeAgo(args.friendship.lastSpoke)}.` : "They have never met."}
Write the match card and the personal invitations. Ground everything in what was actually said in the conversation; don't invent facts. The suggested activity should be concrete, low-pressure, and built on the strongest discovery. Never mention anything private.`,
      },
      {
        role: "user",
        content: `Transcript:\n${transcript}\n\nConfirmed discoveries: ${args.discoveries.map((d) => `${d.label} (${d.detail})`).join("; ") || "none listed"}\nA's agent verdict: ${args.verdictA.reason}\nB's agent verdict: ${args.verdictB.reason}`,
      },
    ],
    "match_card",
    MATCH_SCHEMA as unknown as Record<string, unknown>,
  );
}

const INTRO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    messages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { from: { type: "string", enum: ["a", "b"] }, text: { type: "string" } },
        required: ["from", "text"],
      },
    },
  },
  required: ["messages"],
} as const;

export async function writeIntro(args: { a: User; b: User; reconnect: boolean; explanation: string; shared: string[]; activity: Activity; history: AgentMessage[] }) {
  const { a, b } = args;
  const transcript = args.history.map((m) => `${m.sender === a.id ? `${a.firstName}'s agent` : `${b.firstName}'s agent`}: ${m.text}`).join("\n");
  const out = await jsonChat<{ messages: { from: "a" | "b"; text: string }[] }>(
    [
      {
        role: "system",
        content: `${a.firstName} (${a.pronouns ?? "they/them"}) and ${b.firstName} (${b.pronouns ?? "they/them"}) both accepted an introduction from their AI agents. You're writing the agents' opening messages in a new group chat with both humans in it. ${args.reconnect ? "They're old friends reconnecting - acknowledge it's been a while, lightly, without guilt-tripping." : "They've never met."}
Write exactly 3 short messages: A's agent (from "a") greets both and says what it noticed, B's agent (from "b") adds the piece from its side and a specific icebreaker question for ${a.firstName}, then A's agent (from "a") proposes the activity and steps back so the humans can talk. Each 1-3 sentences, warm, specific, a little playful. Address the humans by first name. The agents are not the humans: each talks about its own person in the third person and never writes as if it were them (no "${b.firstName} here"). No emojis overload (at most one total).`,
      },
      {
        role: "user",
        content: `Why they matched: ${args.explanation}\nShared: ${args.shared.join(", ")}\nActivity: ${args.activity.title} - ${args.activity.when}, ${args.activity.where}\nAgent conversation that led here:\n${transcript}`,
      },
    ],
    "intro",
    INTRO_SCHEMA as unknown as Record<string, unknown>,
  );
  return out.messages.slice(0, 4);
}

const ONBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "What you say back, spoken aloud. 1-3 short sentences, ends with at most one question." },
    tagline: { type: "string", description: "A one-line description of the person, under 12 words" },
    profile: {
      type: "object",
      additionalProperties: false,
      properties: {
        about: { type: "string" },
        interests: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "string" } },
        lookingFor: { type: "string" },
        recent: { type: "array", items: { type: "string" } },
        vibe: { type: "string" },
      },
      required: ["about", "interests", "values", "lookingFor", "recent", "vibe"],
    },
    removed: {
      type: "array",
      items: { type: "string" },
      description: "Exact text of existing interests/values/right-now items that the person corrected or that are no longer true. Usually empty.",
    },
    new_memories: {
      type: "array",
      description: "New specific facts learned in the person's latest message that don't fit the profile fields. Mark private=true for sensitive things (health, feelings, relationships, insecurities).",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" }, private: { type: "boolean" } },
        required: ["text", "private"],
      },
    },
  },
  required: ["reply", "tagline", "profile", "removed", "new_memories"],
} as const;

export type OnboardOutput = { reply: string; tagline: string; profile: Profile; removed: string[]; new_memories: { text: string; private: boolean }[] };

export async function onboardTurn(args: { user: User; memories: Memory[]; history: { role: "user" | "agent"; text: string }[]; message: string }) {
  const { user } = args;
  const convo = args.history.map((h) => ({ role: h.role === "user" ? "user" : "assistant", content: h.text }) as ChatMsg);
  return jsonChat<OnboardOutput>(
    [
      {
        role: "system",
        content: `You are ${user.firstName}'s personal AI agent on Kindred. Your agent will later talk to other people's agents to find ${user.firstName} real friendships and reasons to reconnect with old friends - so you need to really know them. Today is ${today()}.

Talk like a curious, warm friend in a voice conversation: short, natural, reflect back specifics, ask ONE question at a time. Explore personality, interests, recent experiences and projects, upcoming plans, the kind of people they click with, and what they're looking for socially. Pull for concrete, time-bound details (events coming up, projects in progress) - those make the best introductions. If they ask what you do, explain briefly. After you've covered a lot, tell them they can head to Discover and hit "Find connections".

Keep the profile up to date with every turn: keep existing entries unless the person corrected them, add new ones, write 'about' as a third-person paragraph. Current profile and memory:
${dossier(user, args.memories, { includePrivate: true })}`,
      },
      ...convo,
      { role: "user", content: args.message },
    ],
    "onboard_turn",
    ONBOARD_SCHEMA as unknown as Record<string, unknown>,
  );
}
