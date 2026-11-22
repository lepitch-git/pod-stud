import { BYTES_PER_SAMPLE } from "@pod-stud/shared";
import { badId, readManifest, receivedChunks } from "@/lib/server/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** État d'une prise côté serveur : morceaux reçus, durée, manifeste s'il est clôturé. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const chunks = await receivedChunks(id);
  const manifest = await readManifest(id);
  const bytes = chunks.reduce((s, c) => s + c.size, 0);
  const rate = manifest?.sampleRate ?? 48000;
  return Response.json(
    {
      id,
      complete: !!manifest,
      chunks: chunks.length,
      bytes,
      seconds: bytes / BYTES_PER_SAMPLE / rate,
      manifest,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
