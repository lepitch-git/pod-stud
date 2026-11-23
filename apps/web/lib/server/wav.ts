import "server-only";
import { floatToPcm24, pcm24ToFloat, StreamResampler, wavHeader } from "@pod-stud/shared";
import { alignTake, OUT_RATE } from "./align";
import { getStore } from "./store";
import { receivedChunks, type StoredManifest } from "./takes";

/** La piste est-elle complète sur le serveur ? */
export async function isComplete(m: StoredManifest) {
  return (await receivedChunks(m.id)).length >= m.chunkCount - m.lost.length;
}

/**
 * Piste alignée (ENR-07) : 48 kHz, calée sur le départ commun de la séance, dérive de la carte son
 * corrigée, produite au fil de l'eau. `size` est la taille exacte du fichier WAV.
 */
export async function alignedWav(m: StoredManifest) {
  const chunks = (await receivedChunks(m.id)).sort((a, b) => a.index - b.index);
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
  return { stream, size: a.outFrames * 3 + 44, align: a };
}

export function attachment(name: string) {
  const ascii = name
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
