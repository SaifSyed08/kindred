import { Abandoned, db, epochGuard, uid } from "./db";
import { writeIntro } from "./agents";
import { addChatMessage, conversationMessages, getMatch, getUser, touchFriendship } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Called when the second person accepts. Creates the shared chat and has both agents open it.
export function openChat(matchId: string): string | null {
  const m = getMatch(matchId);
  if (!m || m.statusA !== "accepted" || m.statusB !== "accepted") return null;
  if (m.chatId) return m.chatId;
  const chatId = uid("chat");
  // Guard against a double accept racing: only the first writer sets chat_id.
  const res = db().prepare("UPDATE matches SET chat_id = ? WHERE id = ? AND chat_id IS NULL").run(chatId, matchId);
  if (Number(res.changes) === 0) return getMatch(matchId)?.chatId ?? null;
  void runIntro(matchId, chatId).catch((e) => {
    if (!(e instanceof Abandoned)) console.error("intro failed", e);
  });
  return chatId;
}

async function runIntro(matchId: string, chatId: string) {
  // Stops writing if the demo data is reset while the agents are still typing.
  const guard = epochGuard();
  const m = getMatch(matchId)!;
  const a = getUser(m.a)!;
  const b = getUser(m.b)!;
  const post = (sender: string, kind: "text" | "activity", text: string, meta?: unknown) => {
    guard();
    addChatMessage(chatId, sender, kind, text, meta);
  };
  post("system", "text", `${a.firstName} and ${b.firstName} both said yes. Your agents are saying hello.`);
  try {
    const msgs = await writeIntro({
      a,
      b,
      reconnect: m.kind === "reconnect",
      explanation: m.explanation,
      shared: m.shared,
      activity: m.activity,
      history: conversationMessages(m.conversationId),
    });
    for (const msg of msgs) {
      await sleep(1400);
      post(`agent:${msg.from === "a" ? a.id : b.id}`, "text", msg.text);
    }
  } catch (e) {
    if (e instanceof Abandoned) throw e;
    console.error("intro failed", e);
    post(
      `agent:${a.id}`,
      "text",
      `${a.firstName}, ${b.firstName} - our conversation turned up something you two share: ${m.shared.join(", ")}. I'll let you take it from here.`,
    );
  }
  await sleep(1000);
  post("system", "activity", m.activity.title, m.activity);
  guard();
  touchFriendship(a.id, b.id, m.kind === "reconnect" ? "Reconnected through Kindred" : "Introduced by their agents on Kindred");
}
