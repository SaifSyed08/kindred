import { onboardTurn } from "@/lib/agents";
import { tx } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { addAgentChat, addMemory, agentChatHistory, getUser, listMemories, saveProfile } from "@/lib/store";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

// The model rewrites the whole profile each turn and sometimes drops list items it wasn't asked about.
// Keep earlier list entries (new ones first), so a chatty turn can't erase the plans discovery relies on.
function mergeList(next: string[], prev: string[], cap: number) {
  const seen = new Set(next.map((x) => x.toLowerCase()));
  return [...next, ...prev.filter((x) => !seen.has(x.toLowerCase()))].slice(0, cap);
}

function mergeProfile(prev: Profile, next: Profile): Profile {
  return {
    ...next,
    interests: mergeList(next.interests, prev.interests, 14),
    values: mergeList(next.values, prev.values, 8),
    recent: mergeList(next.recent, prev.recent, 8),
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

  try {
    const out = await onboardTurn({ user, memories: listMemories(user.id), history, message: text });
    tx(() => {
      addAgentChat(user.id, "user", text);
      addAgentChat(user.id, "agent", out.reply);
      saveProfile(user.id, mergeProfile(user.profile, out.profile), out.tagline || user.tagline);
      for (const m of out.new_memories.slice(0, 4)) addMemory(user.id, m.private ? "private" : "fact", m.text, "onboarding");
    });
    return json({ reply: out.reply, user: getUser(user.id), memories: listMemories(user.id) });
  } catch (e) {
    console.error("onboard failed", e);
    return bad(e instanceof Error ? e.message : "agent failed", 502);
  }
}
