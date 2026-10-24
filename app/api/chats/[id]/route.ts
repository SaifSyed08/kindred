import { db } from "@/lib/db";
import { bad, json } from "@/lib/http";
import { addChatMessage } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { userId, text } = (await req.json()) as { userId?: string; text?: string };
  const m = db().prepare("SELECT a, b FROM matches WHERE chat_id = ?").get(id) as { a: string; b: string } | undefined;
  if (!m) return bad("unknown chat", 404);
  if (userId !== m.a && userId !== m.b) return bad("not a member", 403);
  if (!text?.trim()) return bad("empty message");
  addChatMessage(id, userId, "text", text.trim().slice(0, 2000));
  return json({ ok: true });
}
