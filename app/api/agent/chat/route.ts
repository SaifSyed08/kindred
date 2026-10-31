import { onboardTurn } from "@/lib/agents";
import { currentEpoch, tx } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { addAgentChat, addMemory, agentChatHistory, getUser, listMemories, saveProfile } from "@/lib/store";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

// The model rewrites the whole profile each turn and sometimes drops list items it wasn't asked about.
// Keep earlier list entries unless the model explicitly marked them removed (the person corrected them),
// so a chatty turn can't silently erase the plans discovery relies on.
function mergeList(next: string[], prev: string[], removed: Set<string>, cap: number) {
  const seen = new Set(next.map((x) => x.toLowerCase()));
  const kept = prev.filter((x) => !seen.has(x.toLowerCase()) && !removed.has(x.toLowerCase()));
  return [...next.filter((x) => !removed.has(x.toLowerCase())), ...kept].slice(0, cap);
}

function mergeProfile(prev: Profile, next: Profile, removedList: string[]): Profile {
  const removed = new Set(removedList.map((x) => x.toLowerCase()));
  return {
    ...next,
    interests: mergeList(next.interests, prev.interests, removed, 14),
    values: mergeList(next.values, prev.values, removed, 8),
    recent: mergeList(next.recent, prev.recent, removed, 8),
  };
}

export async function POST(req: Request) {
  const { userId, message } = (await req.json()) as { userId?: string; message?: string };
  const user = userId ? getUser(userId) : null;
  if (!user) return bad("unknown user", 404);
  const text = (message ?? "").trim();
  const history = agentChatHistory(user.id, 24);

  if (!text) {
    if (history.length) return bad("message required");
    const greeting = `Hey ${user.firstName}! I'm your agent. I'll be the one out there talking to other people's agents for you, so I want to really get you. What's been taking up your time and headspace lately?`;
    addAgentChat(user.id, "agent", greeting);
    return json({ reply: greeting, user, memories: listMemories(user.id) });
  }

  const epoch = currentEpoch();
  try {
    const out = await onboardTurn({ user, memories: listMemories(user.id), history, message: text });
    // Demo data was reset while the agent was thinking; don't write this turn into the fresh profile.
    if (currentEpoch() !== epoch) return bad("demo data was reset", 409);
    tx(() => {
      addAgentChat(user.id, "user", text);
      addAgentChat(user.id, "agent", out.reply);
      saveProfile(user.id, mergeProfile(user.profile, out.profile, out.removed), out.tagline || user.tagline);
      for (const m of out.new_memories.slice(0, 4)) addMemory(user.id, m.private ? "private" : "fact", m.text, "onboarding");
    });
    return json({ reply: out.reply, user: getUser(user.id), memories: listMemories(user.id) });
  } catch (e) {
    console.error("onboard failed", e);
    return bad(e instanceof Error ? e.message : "agent failed", 502);
  }
}
