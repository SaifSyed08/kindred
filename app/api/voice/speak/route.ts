import { bad } from "@/lib/http";
import { speak } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { text, voice } = (await req.json()) as { text?: string; voice?: string };
  if (!text?.trim()) return bad("text required");
  const res = await speak(text.slice(0, 1200), voice);
  if (!res.ok || !res.body) return bad(`tts failed: ${res.status}`, 502);
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
