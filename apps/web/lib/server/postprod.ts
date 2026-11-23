import "server-only";
import {
  DEFAULT_TREATMENT,
  finalGainDb,
  finalStages,
  floatToPcm24,
  normalizeTreatment,
  pcm24ToFloat,
  Pipeline,
  POSTPROD_RATE,
  presetOf,
  treatmentKey,
  wavHeader,
  type Treatment,
} from "@pod-stud/shared";
import type { Collectif, Postprod, Session } from "./db";
import { getStore } from "./store";

/** Traitement qui s'applique à une piste : le sien, sinon celui de l'émission, sinon « Naturel ». */
export function effectiveTreatment(c: Collectif, s: Session, takeId: string): Treatment {
  const own = c.treatments?.[takeId];
  if (own) return normalizeTreatment(own);
  const e = c.emissions.find((x) => x.id === s.emissionId);
  return normalizeTreatment(e?.treatment ?? DEFAULT_TREATMENT);
}

export const postprodPrefix = (cid: string, take: string) => `collectifs/${cid}/postprod/${take}/`;
export const postprodChunkKey = (cid: string, take: string, cle: string, i: number) =>
  `${postprodPrefix(cid, take)}${cle}/${String(i).padStart(5, "0")}.pcm`;

/** État du traitement d'une piste pour l'affichage. */
export function postprodState(c: Collectif, s: Session, takeId: string) {
  const t = effectiveTreatment(c, s, takeId);
  const pp = c.postprods?.[takeId];
  const brut = presetOf(t.preset).key === "brut";
  if (brut) return { treatment: t, state: "brut" as const, pp: null };
  if (!pp) return { treatment: t, state: "a-faire" as const, pp: null };
  return {
    treatment: t,
    state: pp.cle === treatmentKey(t) ? ("a-jour" as const) : ("perime" as const),
    pp,
  };
}

/** Efface les anciens résultats d'une piste (tous sauf la clé `keep`). */
export async function cleanupPostprod(cid: string, take: string, keep?: string) {
  const store = getStore();
  const all = await store.list(postprodPrefix(cid, take));
  await Promise.all(
    all
      .filter((o) => !keep || !o.key.startsWith(`${postprodPrefix(cid, take)}${keep}/`))
      .map((o) => store.delete(o.key)),
  );
}

/** Piste traitée : mise au volume du preset et limiteur à -1 dBTP, produite au fil de l'eau. */
export function processedWav(cid: string, take: string, pp: Postprod) {
  const store = getStore();
  const pipe = new Pipeline(finalStages(POSTPROD_RATE, finalGainDb(pp.treatment, pp.outputLufs)));
  let i = -1;
  let written = 0;
  const emit = (f: Float32Array) => {
    const n = Math.max(0, Math.min(f.length, pp.frames - written));
    const out = new Uint8Array(n * 3);
    floatToPcm24(f.subarray(0, n), out);
    written += n;
    return out;
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i === -1) ctrl.enqueue(wavHeader(pp.frames * 3, POSTPROD_RATE));
      else if (i < pp.chunks) {
        const data = await store.get(postprodChunkKey(cid, take, pp.cle, i));
        if (!data) return ctrl.error(new Error("morceau traité introuvable"));
        const out = emit(pipe.push(pcm24ToFloat(data)));
        if (out.length) ctrl.enqueue(out);
      } else {
        const tail = emit(pipe.end());
        if (tail.length) ctrl.enqueue(tail);
        if (written < pp.frames) ctrl.enqueue(emit(new Float32Array(pp.frames - written)));
        return ctrl.close();
      }
      i++;
    },
  });
  return { stream, size: pp.frames * 3 + 44 };
}

export const processedFileName = (fileName: string) => fileName.replace(/\.wav$/i, "_traitee.wav");
