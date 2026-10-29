export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });

// Polls a source and streams new items as Server-Sent Events until `tick` returns true or the client leaves.
export function sse(req: Request, tick: (send: (event: string, data: unknown) => void) => boolean, intervalMs = 250) {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let beat = 0;
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {}
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const step = () => {
        if (closed) return;
        try {
          if (tick(send)) return close();
          // Comment line every ~15 s keeps proxies from timing the stream out.
          if (++beat * intervalMs >= 15000) {
            beat = 0;
            controller.enqueue(enc.encode(": ping\n\n"));
          }
        } catch (e) {
          send("server_error", { error: e instanceof Error ? e.message : String(e) });
          close();
        }
      };
      req.signal.addEventListener("abort", close);
      // Interval first, so a stream that finishes on its very first step still gets it cleared.
      timer = setInterval(step, intervalMs);
      step();
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
