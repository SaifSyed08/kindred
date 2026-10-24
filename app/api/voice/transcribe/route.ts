import { bad, json } from "@/lib/http";
import { transcribe } from "@/lib/llm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size < 800) return bad("no audio");
  try {
    const t = audio.type;
    const ext = t.includes("mp4") ? "mp4" : t.includes("ogg") ? "ogg" : t.includes("mpeg") ? "mp3" : t.includes("wav") ? "wav" : "webm";
    return json({ text: await transcribe(audio, `speech.${ext}`) });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "transcription failed", 502);
  }
}
