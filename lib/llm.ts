// Thin OpenAI REST client: structured JSON chat, embeddings, speech-to-text and text-to-speech.
const BASE = "https://api.openai.com/v1";
export const CHAT_MODEL = process.env.KINDRED_MODEL || "gpt-5.4-mini";
const EMBED_MODEL = "text-embedding-3-small";

function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type JsonSchema = Record<string, unknown>;

// Strict structured output: every property required, no extras. Retries once on transient failure.
export async function jsonChat<T>(
  messages: ChatMsg[],
  name: string,
  schema: JsonSchema,
  opts: { temperature?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const body: Record<string, unknown> = {
    model: CHAT_MODEL,
    messages,
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  };
  if (/^gpt-5/.test(CHAT_MODEL)) body.reasoning_effort = process.env.KINDRED_REASONING || "low";
  else if (opts.temperature !== undefined) body.temperature = opts.temperature;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: attemptSignal(opts.signal),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
        throw Object.assign(new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`), { fatal: true });
      }
      const data = (await res.json()) as { choices: { message: { content: string | null; refusal?: string | null } }[] };
      const content = data.choices[0]?.message?.content;
      if (!content) throw new Error(`empty completion${data.choices[0]?.message?.refusal ? `: ${data.choices[0].message.refusal}` : ""}`);
      return JSON.parse(content) as T;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal || opts.signal?.aborted) break;
      await backoff(attempt);
    }
  }
  throw lastErr;
}

// Each attempt gets its own deadline so a stalled socket can't hang a run.
const ATTEMPT_TIMEOUT_MS = 30000;
function attemptSignal(outer?: AbortSignal) {
  const t = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
  return outer ? AbortSignal.any([outer, t]) : t;
}
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, 1500 * 2 ** attempt + Math.random() * 500));

export async function embed(texts: string[]): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/embeddings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
        signal: attemptSignal(),
      });
      if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      return data.data.sort((x, y) => x.index - y.index).map((d) => d.embedding);
    } catch (e) {
      lastErr = e;
      await backoff(attempt);
    }
  }
  throw lastErr;
}

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "gpt-4o-mini-transcribe");
  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text: string };
  return data.text.trim();
}

export async function speak(text: string, voice = "coral"): Promise<Response> {
  return fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      instructions: "Warm, upbeat and conversational, like a thoughtful friend. Natural pacing, not salesy.",
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(30000),
  });
}
