import { chunkName } from "@pod-stud/shared";
import { getStore, sha256Hex } from "@/lib/server/store";
import { badId, chunkPrefix } from "@/lib/server/takes";

export const runtime = "nodejs";
const MAX_BYTES = 4 * 1024 * 1024;

/** Réception d'un morceau : l'empreinte SHA-256 est recalculée et comparée avant d'enregistrer (ENR-04). */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 999_999)
    return Response.json({ error: "numéro de morceau invalide" }, { status: 400 });
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length === 0 || body.length > MAX_BYTES || body.length % 3 !== 0)
    return Response.json({ error: "taille de morceau invalide" }, { status: 400 });
  const expected = req.headers.get("x-sha256")?.toLowerCase();
  const actual = sha256Hex(body);
  if (!expected || expected !== actual)
    return Response.json(
      { error: "empreinte différente : morceau abîmé en route" },
      { status: 422 },
    );
  await getStore().put(chunkPrefix(id) + chunkName(i), body);
  return Response.json({ ok: true, index: i, bytes: body.length, sha256: actual });
}
