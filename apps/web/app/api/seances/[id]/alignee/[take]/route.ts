import { floatToPcm24, isValidTakeId, StreamResampler, wavHeader } from "@pod-stud/shared";
import { alignTake, OUT_RATE } from "@/lib/server/align";
import { errorResponse } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import { readManifest, receivedChunks } from "@/lib/server/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function pcm24ToFloat(b: Uint8Array): Float32Array {
  const out = new Float32Array(Math.floor(b.length / 3));
  for (let i = 0, o = 0; i < out.length; i++, o += 3) {
    let v = (b[o] as number) | ((b[o + 1] as number) << 8) | ((b[o + 2] as number) << 16);
    if (v & 0x800000) v -= 0x1000000;
    out[i] = v / (v < 0 ? 0x800000 : 0x7fffff);
  }
  return out;
}

/**
 * Piste alignée (ENR-07) : 48 kHz, calée sur le départ commun de la séance, dérive de la carte son
 * corrigée. Toutes les pistes d'une même prise ont la même origine et se superposent sans clap.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; take: string }> },
) {
  const { id, take } = await params;
  const takeId = take.replace(/\.wav$/, "");
  if (!isValidTakeId(id) || !isValidTakeId(takeId))
    return errorResponse(req, 400, "Lien de piste invalide.");
  const m = await readManifest(takeId);
  if (!m || m.sessionId !== id)
    return errorResponse(req, 404, "Le serveur ne retrouve pas cette piste dans la séance.");
  const chunks = (await receivedChunks(takeId)).sort((a, b) => a.index - b.index);
  if (chunks.length < m.chunkCount - m.lost.length)
    return errorResponse(
      req,
      409,
      "Le serveur ne retrouve pas cette piste en entier (stockage temporaire du lien de test).",
    );
  const a = await alignTake(m);
  const store = getStore();
  const resampler = new StreamResampler(a.plan.step, a.plan.skipSourceFrames);
  let written = 0;
  let i = -1;
  const emit = (f: Float32Array): Uint8Array => {
    const n = Math.max(0, Math.min(f.length, a.outFrames - written));
    const out = new Uint8Array(n * 3);
    floatToPcm24(f.subarray(0, n), out);
    written += n;
    return out;
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i === -1) {
        ctrl.enqueue(wavHeader(a.outFrames * 3, OUT_RATE));
        if (a.plan.padFrames) ctrl.enqueue(emit(new Float32Array(a.plan.padFrames)));
      } else if (i < chunks.length) {
        const data = await store.get((chunks[i] as { key: string }).key);
        if (!data) return ctrl.error(new Error("morceau introuvable"));
        const out = emit(resampler.push(pcm24ToFloat(data)));
        if (out.length) ctrl.enqueue(out);
      } else {
        const tail = emit(resampler.push(new Float32Array(0), true));
        if (tail.length) ctrl.enqueue(tail);
        // Complète au besoin pour respecter exactement la taille annoncée dans l'en-tête.
        if (written < a.outFrames) ctrl.enqueue(emit(new Float32Array(a.outFrames - written)));
        return ctrl.close();
      }
      i++;
    },
  });
  const file = `${m.name || "prise"}-${m.participant || takeId}-alignee`
    .normalize("NFD")
    .replace(/[^\w-]+/g, "_")
    .slice(0, 80);
  return new Response(stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(a.outFrames * 3 + 44),
      "content-disposition": `attachment; filename="${file}.wav"`,
      "cache-control": "no-store",
    },
  });
}
