import { db } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { openChat } from "@/lib/intro";
import { getMatch } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, accept } = (await req.json()) as { userId?: string; accept?: boolean };
  const m = getMatch(id);
  if (!m) return bad("unknown match", 404);
  if (userId !== m.a && userId !== m.b) return bad("not your match", 403);
  const col = userId === m.a ? "status_a" : "status_b";
  db().prepare(`UPDATE matches SET ${col} = ? WHERE id = ?`).run(accept ? "accepted" : "declined", id);
  const chatId = accept ? openChat(id) : null;
  return json({ match: getMatch(id), chatId });
}
