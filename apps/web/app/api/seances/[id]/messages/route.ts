import { isValidTakeId } from "@pod-stud/shared";
import { post, since } from "@/lib/server/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Relais de messages d'une séance (sans LiveKit) : envoi. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidTakeId(id)) return Response.json({ error: "séance invalide" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { from?: string; msg?: unknown } | null;
  const raw = JSON.stringify(body?.msg ?? null);
  if (!body?.from || typeof body.from !== "string" || body.from.length > 64 || raw.length > 4000)
    return Response.json({ error: "message invalide" }, { status: 400 });
  return Response.json(post(id, body.from, body.msg));
}

/** Relais de messages d'une séance : messages reçus après le numéro `after`. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidTakeId(id)) return Response.json({ error: "séance invalide" }, { status: 400 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  return Response.json(
    { messages: since(id, after) },
    { headers: { "cache-control": "no-store" } },
  );
}
