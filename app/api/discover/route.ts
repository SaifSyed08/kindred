import { startRun } from "@/lib/discovery";
import { bad, json } from "@/lib/http";
import { getUser, latestRun } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = (await req.json()) as { userId?: string };
  if (!userId || !getUser(userId)) return bad("unknown user", 404);
  if (!process.env.OPENAI_API_KEY) return bad("OPENAI_API_KEY is not set on the server", 500);
  return json({ runId: startRun(userId) });
}

export function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return bad("userId required");
  return json({ run: latestRun(userId) ?? null });
}
