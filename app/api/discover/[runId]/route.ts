import { bad, sse } from "@/lib/http";
import { eventsSince, getRun } from "@/lib/store";

export const dynamic = "force-dynamic";

// SSE: replays the run from the start, marks the end of the replay with `caught_up`,
// then streams new events until the run finishes.
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  if (!getRun(runId)) return bad("unknown run", 404);
  let last = 0;
  let replayed = false;
  return sse(req, (send) => {
    for (const { id, ev } of eventsSince(runId, last)) {
      last = id;
      send("run", ev);
      if (ev.type === "run_done" || ev.type === "run_error") return true;
    }
    if (!replayed) {
      replayed = true;
      send("caught_up", {});
    }
    const run = getRun(runId);
    if (!run || (run.status !== "running" && eventsSince(runId, last).length === 0)) {
      send("run", { type: "run_error", runId, error: "Run ended unexpectedly (server restarted or data reset)" });
      return true;
    }
    return false;
  });
}
