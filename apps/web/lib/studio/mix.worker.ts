/// <reference lib="webworker" />
/**
 * Mixage d'une prise (étape 6b), dans le navigateur :
 * 1) lit toutes les pistes en même temps, mesure le volume de leur somme et, si demandé, repère les
 *    silences communs ;
 * 2) relit, additionne, raccourcit les silences communs, change la vitesse sans changer la hauteur,
 *    met au volume cible avec un plafond à -1 dBTP, et envoie le mix au serveur par morceaux.
 * Avec `estimer`, on s'arrête après l'étape 1 pour annoncer le temps gagné.
 */
import {
  commonSilenceCuts,
  CutApplier,
  Envelope,
  finalStages,
  floatToPcm24,
  LoudnessMeter,
  Pipeline,
  POSTPROD_CHUNK_FRAMES,
  POSTPROD_RATE,
  removedSamples,
  TimeStretch,
  type Cut,
  type MixSettings,
} from "@pod-stud/shared";
import { readWav } from "./wavstream";

declare const self: DedicatedWorkerGlobalScope;

export type MixIn = {
  urls: string[];
  settings: MixSettings;
  estimer: boolean;
  uploadUrl: string;
  sources: string;
};
export type MixOut =
  | { type: "progress"; phase: "analyse" | "mixage"; ratio: number }
  | { type: "estimation"; seconds: number; removedSec: number; cuts: number; finalSec: number }
  | { type: "done"; seconds: number; finalSec: number; removedSec: number; cuts: number }
  | { type: "error"; message: string };

const post = (m: MixOut) => self.postMessage(m);
const fs = POSTPROD_RATE;
const BLOCK = 8192;

/** Lit plusieurs pistes en parallèle et rend, bloc par bloc, chaque piste (complétée par du silence). */
async function* together(
  urls: string[],
  onRatio: (r: number) => void,
): AsyncGenerator<Float32Array[]> {
  const read = urls.map(() => ({ r: 0, t: 0 }));
  const its = urls.map((u, i) =>
    readWav(u, {
      onBytes: (r, t) => {
        read[i] = { r, t };
        const tot = read.reduce((a, x) => a + x.t, 0);
        onRatio(tot ? read.reduce((a, x) => a + x.r, 0) / tot : 0);
      },
    })[Symbol.asyncIterator](),
  );
  const queues = urls.map(() => ({ buf: new Float32Array(0), done: false }));
  for (;;) {
    await Promise.all(
      queues.map(async (q, i) => {
        while (!q.done && q.buf.length < BLOCK) {
          const n = await (its[i] as AsyncIterator<Float32Array>).next();
          if (n.done) q.done = true;
          else {
            const b = new Float32Array(q.buf.length + n.value.length);
            b.set(q.buf);
            b.set(n.value, q.buf.length);
            q.buf = b;
          }
        }
      }),
    );
    const n = Math.max(...queues.map((q) => Math.min(BLOCK, q.buf.length)));
    if (n === 0) return;
    yield queues.map((q) => {
      const out = new Float32Array(n);
      out.set(q.buf.subarray(0, Math.min(n, q.buf.length)));
      q.buf = q.buf.slice(Math.min(n, q.buf.length));
      return out;
    });
  }
}

const sum = (xs: Float32Array[]) => {
  const out = new Float32Array(xs[0]?.length ?? 0);
  for (const x of xs)
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) + (x[i] as number);
  return out;
};

class Refused extends Error {}
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

async function mix(m: MixIn) {
  const s = m.settings;
  // 1) Analyse.
  const envs = m.urls.map(() => new Envelope(fs));
  const meter = new LoudnessMeter(fs);
  let frames = 0;
  for await (const xs of together(m.urls, (r) =>
    post({ type: "progress", phase: "analyse", ratio: r }),
  )) {
    if (s.silenceMax > 0) xs.forEach((x, i) => envs[i]?.push(x));
    meter.push(sum(xs));
    frames += xs[0]?.length ?? 0;
  }
  const cuts: Cut[] =
    s.silenceMax > 0
      ? commonSilenceCuts(
          envs.map((e) => e.db),
          fs,
          s.silenceMax,
        )
      : [];
  const removedSec = removedSamples(cuts) / fs;
  const finalSec = Math.round((frames - removedSamples(cuts)) / s.speed) / fs;
  if (m.estimer) {
    post({ type: "estimation", seconds: frames / fs, removedSec, cuts: cuts.length, finalSec });
    return;
  }
  // 2) Mixage et envoi.
  const lufs = meter.integrated();
  const gain = Number.isFinite(lufs) ? Math.min(30, s.target - lufs) : 0;
  const cutter = new CutApplier(cuts, fs);
  const stretch = new TimeStretch(fs, s.speed);
  const pipe = new Pipeline(finalStages(fs, gain));
  const u = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const buf = new Float32Array(POSTPROD_CHUNK_FRAMES);
  let fill = 0;
  let index = 0;
  let out = 0;
  const pending: Promise<void>[] = [];
  const flush = async () => {
    if (!fill) return;
    const bytes = new Uint8Array(fill * 3);
    floatToPcm24(buf.subarray(0, fill), bytes);
    out += fill;
    fill = 0;
    pending.push(put(`${m.uploadUrl}?u=${u}&morceau=${index++}`, bytes));
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
  for await (const xs of together(m.urls, (r) =>
    post({ type: "progress", phase: "mixage", ratio: r }),
  ))
    await take(pipe.push(stretch.push(cutter.push(sum(xs)))));
  await take(pipe.push(stretch.push(cutter.push(new Float32Array(0), true))));
  await take(pipe.push(stretch.end()));
  await take(pipe.end());
  await flush();
  await Promise.all(pending);
  const res = await fetch(m.uploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      u,
      settings: s,
      sources: m.sources,
      frames: out,
      removedSec,
      cuts: cuts.length,
    }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `Le serveur a refusé le mix (${res.status}).`);
  }
  post({ type: "done", seconds: frames / fs, finalSec: out / fs, removedSec, cuts: cuts.length });
}

self.onmessage = (e: MessageEvent<MixIn>) => {
  mix(e.data).catch((err: unknown) =>
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }),
  );
};
