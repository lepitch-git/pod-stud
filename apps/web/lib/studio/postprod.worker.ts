/// <reference lib="webworker" />
/**
 * Traitement de la voix (étape 6a), dans le navigateur, sans bloquer la page :
 * - « traiter » : 1) mesure le volume de la piste, 2) la passe dans la chaîne du preset et envoie le
 *   résultat au serveur par morceaux de 10 s, en mesurant le volume obtenu. La durée ne change pas.
 * - « apercu » : traite un extrait et rend l'avant et l'après au même volume, pour comparer.
 */
import {
  BreathReducer,
  Declicker,
  finalStages,
  floatToPcm24,
  LoudnessMeter,
  Pipeline,
  POSTPROD_CHUNK_FRAMES,
  POSTPROD_RATE,
  presetOf,
  STORE_HEADROOM_DB,
  voiceChain,
  WORK_LUFS,
  type Stage,
  type Treatment,
} from "@pod-stud/shared";
import { readWav } from "./wavstream";

declare const self: DedicatedWorkerGlobalScope;

export type PostprodIn =
  | { type: "traiter"; url: string; uploadUrl: string; treatment: Treatment; cle: string }
  | { type: "apercu"; url: string; treatment: Treatment; startSec: number; seconds: number };

export type PostprodOut =
  | { type: "progress"; phase: "mesure" | "traitement"; ratio: number }
  | {
      type: "done";
      stats: { inputLufs: number; outputLufs: number; repaired: number; breaths: number };
    }
  | {
      type: "apercu";
      before: Float32Array;
      after: Float32Array;
      repaired: number;
      breaths: number;
      startSec: number;
    }
  | { type: "error"; message: string };

const post = (m: PostprodOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);
const fs = POSTPROD_RATE;
const preGain = (lufs: number) =>
  Number.isFinite(lufs) ? Math.max(-30, Math.min(30, WORK_LUFS - lufs)) : 0;

function counts(stages: Stage[]) {
  let repaired = 0;
  let breaths = 0;
  for (const s of stages) {
    if (s instanceof Declicker) repaired += s.repaired;
    if (s instanceof BreathReducer) breaths += s.detected;
  }
  return { repaired, breaths };
}

class Refused extends Error {}

/** Envoi d'un morceau ; réessaie en cas de coupure réseau ou d'erreur passagère du serveur. */
async function put(url: string, body: Uint8Array) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", body: body as BodyInit });
      if (res.ok) return;
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      const err = new Refused(j?.error ?? `Envoi refusé (${res.status}).`);
      if (res.status < 500 || attempt >= 4) throw err;
    } catch (e) {
      if (e instanceof Refused || attempt >= 4) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function traiter(m: Extract<PostprodIn, { type: "traiter" }>) {
  // 1) Volume d'origine.
  const inMeter = new LoudnessMeter(fs);
  for await (const x of readWav(m.url, {
    onBytes: (r, t) => post({ type: "progress", phase: "mesure", ratio: t ? r / t : 0 }),
  }))
    inMeter.push(x);
  const inputLufs = inMeter.integrated();
  // 2) Chaîne, envoi par morceaux de 10 s, mesure du résultat.
  const stages = voiceChain(fs, m.treatment, preGain(inputLufs));
  const pipe = new Pipeline(stages);
  const outMeter = new LoudnessMeter(fs);
  const headroom = Math.pow(10, STORE_HEADROOM_DB / 20);
  const buf = new Float32Array(POSTPROD_CHUNK_FRAMES);
  let fill = 0;
  let index = 0;
  let frames = 0;
  const pending: Promise<void>[] = [];
  const flush = async () => {
    if (!fill) return;
    const block = buf.slice(0, fill);
    outMeter.push(block);
    for (let i = 0; i < block.length; i++) block[i] = (block[i] as number) * headroom;
    const bytes = new Uint8Array(fill * 3);
    floatToPcm24(block, bytes);
    frames += fill;
    fill = 0;
    pending.push(put(`${m.uploadUrl}?cle=${m.cle}&morceau=${index++}`, bytes));
    // Deux envois en parallèle au plus.
    if (pending.length >= 2) await pending.shift();
  };
  const take = async (y: Float32Array) => {
    let o = 0;
    while (o < y.length) {
      const n = Math.min(y.length - o, buf.length - fill);
      buf.set(y.subarray(o, o + n), fill);
      fill += n;
      o += n;
      if (fill === buf.length) await flush();
    }
  };
  for await (const x of readWav(m.url, {
    onBytes: (r, t) => post({ type: "progress", phase: "traitement", ratio: t ? r / t : 0 }),
  }))
    await take(pipe.push(x));
  await take(pipe.end());
  await flush();
  await Promise.all(pending);
  const res = await fetch(m.uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cle: m.cle,
      frames,
      chunks: index,
      inputLufs,
      outputLufs: outMeter.integrated(),
      ...counts(stages),
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `Le serveur a refusé la piste traitée (${res.status}).`);
  }
  post({
    type: "done",
    stats: { inputLufs, outputLufs: outMeter.integrated(), ...counts(stages) },
  });
}

async function apercu(m: Extract<PostprodIn, { type: "apercu" }>) {
  const start = Math.max(0, Math.round(m.startSec * fs));
  const n = Math.round(m.seconds * fs);
  const ctrl = new AbortController();
  const out = new Float32Array(n);
  let pos = 0;
  let got = 0;
  try {
    for await (const x of readWav(m.url, { signal: ctrl.signal })) {
      const a = Math.max(0, start - pos);
      const b = Math.min(x.length, start + n - pos);
      if (b > a) {
        out.set(x.subarray(a, b), got);
        got += b - a;
      }
      pos += x.length;
      if (got >= n) {
        ctrl.abort();
        break;
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
  }
  if (!got) throw new Error("La piste est plus courte que le point de départ choisi.");
  const before = out.slice(0, got);
  const m0 = new LoudnessMeter(fs);
  m0.push(before);
  const lin = m0.integrated();
  const stages = voiceChain(fs, m.treatment, preGain(lin));
  const processed = Pipeline.run(stages, before);
  const m1 = new LoudnessMeter(fs);
  m1.push(processed);
  const target = Number.isFinite(presetOf(m.treatment.preset).targetLufs)
    ? presetOf(m.treatment.preset).targetLufs
    : -16;
  const gain = (l: number) => (Number.isFinite(l) ? Math.min(30, target - l) : 0);
  const after = Pipeline.run(finalStages(fs, gain(m1.integrated())), processed);
  // L'avant est mis au même volume (sans autre traitement) : on compare le son, pas le niveau.
  const ref = Pipeline.run(finalStages(fs, gain(lin)), before);
  post({ type: "apercu", before: ref, after, ...counts(stages), startSec: start / fs }, [
    ref.buffer,
    after.buffer,
  ]);
}

self.onmessage = (e: MessageEvent<PostprodIn>) => {
  const m = e.data;
  (m.type === "traiter" ? traiter(m) : apercu(m)).catch((err: unknown) =>
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }),
  );
};
