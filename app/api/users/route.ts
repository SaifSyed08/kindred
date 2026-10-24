import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { listUsers } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  const friendships = db().prepare("SELECT a, b, context, last_spoke AS lastSpoke FROM friendships").all();
  return json({ users: listUsers(), friendships });
}
