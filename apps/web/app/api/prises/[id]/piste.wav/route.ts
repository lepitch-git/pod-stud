import { wavHeader } from "@pod-stud/shared";
import { getStore } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/http";
import { badId, readManifest, receivedChunks } from "@/lib/server/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UNAVAILABLE =
  "Le serveur ne retrouve pas cette piste en entier. Sur le lien de test, les enregistrements sont gardés " +
  "dans un espace temporaire qui peut être vidé à tout moment : c'est ce qui s'est passé ici. " +
  "Le stockage définitif réglera ce problème.";

/** Piste WAV assemblée à partir des morceaux reçus, envoyée au fil de l'eau (ENR-03). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const manifest = await readManifest(id);
  if (!manifest) return errorResponse(req, 404, UNAVAILABLE);
  const chunks = (await receivedChunks(id)).sort((a, b) => a.index - b.index);
  const expected = manifest.chunkCount - manifest.lost.length;
  if (chunks.length < expected) return errorResponse(req, 409, UNAVAILABLE);
  const total = chunks.reduce((s, c) => s + c.size, 0);
  const store = getStore();
  let i = -1;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i === -1) ctrl.enqueue(wavHeader(total, manifest.sampleRate));
      else {
        const c = chunks[i];
        if (!c) return ctrl.close();
        const data = await store.get(c.key);
        if (!data) return ctrl.error(new Error(`morceau ${c.index} introuvable`));
        ctrl.enqueue(data);
      }
      i++;
    },
  });
  const file = `${manifest.name || "prise"}-${manifest.participant || id}`
    .normalize("NFD")
    .replace(/[^\w-]+/g, "_")
    .slice(0, 80);
  return new Response(stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(total + 44),
      "content-disposition": `attachment; filename="${file}.wav"`,
      "cache-control": "no-store",
    },
  });
}
