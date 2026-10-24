import { sse } from "@/lib/http";
import { chatMessagesSince } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let last = 0;
  return sse(
    req,
    (send) => {
      const msgs = chatMessagesSince(id, last);
      if (msgs.length) {
        last = msgs[msgs.length - 1].id;
        send("messages", msgs);
      }
      return false;
    },
    500,
  );
}
