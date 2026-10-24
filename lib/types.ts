export type Profile = {
  about: string;
  interests: string[];
  values: string[];
  lookingFor: string;
  recent: string[];
  vibe: string;
};

export type User = {
  id: string;
  name: string;
  firstName: string;
  age: number | null;
  city: string | null;
  pronouns: string | null;
  tagline: string;
  hue: number;
  profile: Profile;
};

export type Memory = {
  id: number;
  userId: string;
  kind: "fact" | "private" | "agent_note";
  text: string;
  source: string;
  createdAt: string;
};

export type Friendship = { a: string; b: string; context: string; lastSpoke: string };

export type Discovery = { label: string; detail: string };

export type MessageType = "greet" | "ask" | "share" | "discover" | "propose" | "conclude";

export type AgentMessage = {
  id: number;
  conversationId: string;
  sender: string;
  seq: number;
  type: MessageType;
  text: string;
  thought: string | null;
  discoveries: Discovery[];
  interest: number;
  createdAt: string;
};

export type Verdict = {
  recommend: boolean;
  score: number;
  reason: string;
};

export type Activity = { title: string; when: string; where: string; why: string };

export type Match = {
  id: string;
  conversationId: string;
  a: string;
  b: string;
  kind: "new" | "reconnect";
  score: number;
  headline: string;
  explanation: string;
  shared: string[];
  activity: Activity;
  inviteA: string;
  inviteB: string;
  statusA: "pending" | "accepted" | "declined";
  statusB: "pending" | "accepted" | "declined";
  chatId: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: number;
  chatId: string;
  sender: string;
  kind: "text" | "activity";
  text: string;
  meta: Activity | null;
  createdAt: string;
};

export type ConversationOutcome = {
  verdicts: Record<string, Verdict>;
  matchId: string | null;
  summary: string;
};

// Events streamed to the Discover screen; persisted in the events table so a late viewer replays them.
export type RunEvent =
  | { type: "run_started"; runId: string; userId: string }
  | { type: "shortlist"; candidates: { userId: string; similarity: number; relation: "stranger" | "friend"; reason: string; selected: boolean }[] }
  | { type: "conversation_started"; conversationId: string; a: string; b: string; relation: "stranger" | "friend"; similarity: number }
  | { type: "thinking"; conversationId: string; sender: string }
  | { type: "message"; message: AgentMessage }
  | { type: "deliberating"; conversationId: string }
  | { type: "verdict"; conversationId: string; sender: string; verdict: Verdict }
  | { type: "conversation_done"; conversationId: string; outcome: ConversationOutcome }
  | { type: "match"; match: Match }
  | { type: "run_done"; runId: string; matches: number }
  | { type: "run_error"; runId: string; error: string };
