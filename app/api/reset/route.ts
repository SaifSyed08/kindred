import { resetDatabase } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export function POST() {
  resetDatabase();
  return json({ ok: true });
}
