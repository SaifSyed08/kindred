import { bad, json } from "@/lib/http";
import { conversationMessages, getUser, matchesFor } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId || !getUser(userId)) return bad("unknown user", 404);
  // Reconnections first (the rarer, higher-stakes intro), then newest.
  const matches = matchesFor(userId)
    .filter((m) => m.statusA !== "declined" && m.statusB !== "declined")
    .sort((x, y) => Number(y.kind === "reconnect") - Number(x.kind === "reconnect"))
    .map((m) => ({
      ...m,
      other: getUser(m.a === userId ? m.b : m.a),
      transcript: conversationMessages(m.conversationId),
    }));
  return json({ matches });
}
