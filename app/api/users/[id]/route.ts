import { bad, json } from "@/lib/http";
import { agentChatHistory, deleteMemory, getUser, listFriendships, listMemories } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = getUser(id);
  if (!user) return bad("unknown user", 404);
  return json({ user, memories: listMemories(id), friendships: listFriendships(id), history: agentChatHistory(id, 60) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const memoryId = Number(new URL(req.url).searchParams.get("memory"));
  if (!memoryId) return bad("memory id required");
  deleteMemory(id, memoryId);
  return json({ memories: listMemories(id) });
}
