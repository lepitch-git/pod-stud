import { getStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Type de stockage utilisé par le serveur, pour avertir sur la page quand il est temporaire. */
export function GET() {
  return Response.json({ kind: getStore().kind });
}
