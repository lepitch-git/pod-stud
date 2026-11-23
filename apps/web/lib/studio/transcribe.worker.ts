/// <reference lib="webworker" />
/**
 * Transcription d'une prise (étape 6c) avec Whisper, dans le navigateur (transformers.js) : aucun
 * compte ni service payant. Le modèle (environ 80 Mo en « rapide », 250 Mo en « précis ») est
 * téléchargé une fois puis gardé en cache par le navigateur.
 * Chaque piste est transcrite séparément : on sait donc qui parle sans deviner. Seuls les passages
 * où la personne parle sont envoyés au modèle (pas d'invention sur les silences).
 */
import {
  Biquad,
  ENVELOPE_MS,
  Envelope,
  POSTPROD_RATE,
  silenceThreshold,
  WHISPER_LANGUAGES,
  type Segment,
} from "@pod-stud/shared";
import { readWav } from "./wavstream";

declare const self: DedicatedWorkerGlobalScope;

export type TranscribeIn = {
  tracks: { url: string; speaker: string }[];
  language: string;
  model: "rapide" | "precis";
};
export type TranscribeOut =
  | {
      type: "progress";
      phase: "modele" | "analyse" | "transcription";
      ratio: number;
      detail?: string;
    }
  | { type: "done"; segments: Segment[]; model: string; device: string }
  | { type: "error"; message: string };

const post = (m: TranscribeOut) => self.postMessage(m);
const MODELS = { rapide: "onnx-community/whisper-base", precis: "onnx-community/whisper-small" };
const FS = POSTPROD_RATE;
const SR = 16000;

/** Passages parlés d'une piste (en secondes) : au-dessus du seuil de silence, trous de moins de 0,6 s comblés. */
function speechRegions(db: number[]): [number, number][] {
  const th = silenceThreshold(db);
  const step = ENVELOPE_MS / 1000;
  const out: [number, number][] = [];
  let a = -1;
  let last = -1;
  db.forEach((v, f) => {
    if (v < th) return;
    if (a < 0) a = f;
    else if ((f - last) * step > 0.6) {
      out.push([a, last + 1]);
      a = f;
    }
    last = f;
  });
  if (a >= 0) out.push([a, last + 1]);
  return out
    .filter(([s, e]) => (e - s) * step >= 0.3)
    .map(([s, e]) => [Math.max(0, s * step - 0.25), e * step + 0.25] as [number, number]);
}

/** 48 kHz → 16 kHz : passe-bas à 7 kHz puis un échantillon sur trois. */
class Down {
  private f1 = Biquad.of("lowpass", FS, 7000, 0.7);
  private f2 = Biquad.of("lowpass", FS, 7000, 0.7);
  private phase = 0;
  push(x: Float32Array): Float32Array {
    const y = x.slice();
    this.f1.process(y);
    this.f2.process(y);
    const out: number[] = [];
    for (let i = 0; i < y.length; i++) {
      if (this.phase === 0) out.push(y[i] as number);
      this.phase = (this.phase + 1) % 3;
    }
    return Float32Array.from(out);
  }
}

type Asr = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

async function loadModel(model: TranscribeIn["model"]): Promise<{ asr: Asr; device: string }> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (p.status !== "progress" || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    const all = [...files.values()];
    const total = all.reduce((a, f) => a + f.total, 0);
    post({
      type: "progress",
      phase: "modele",
      ratio: total ? all.reduce((a, f) => a + f.loaded, 0) / total : 0,
      detail: `${Math.round(total / 1e6)} Mo`,
    });
  };
  const gpu =
    "gpu" in navigator &&
    (await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu
      .requestAdapter()
      .catch(() => null));
  const tries = gpu ? (["webgpu", "wasm"] as const) : (["wasm"] as const);
  let lastErr: unknown;
  for (const device of tries) {
    try {
      const asr = (await pipeline("automatic-speech-recognition", MODELS[model], {
        device,
        dtype: device === "webgpu" ? "fp32" : "q8",
        progress_callback,
      } as never)) as unknown as Asr;
      return { asr, device };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Le modèle de transcription n'a pas pu se charger.");
}

async function transcribe(m: TranscribeIn) {
  // 1) Où chacun parle-t-il ?
  const regions: [number, number][][] = [];
  for (let i = 0; i < m.tracks.length; i++) {
    const env = new Envelope(FS);
    for await (const x of readWav(m.tracks[i]!.url, {
      onBytes: (r, t) =>
        post({
          type: "progress",
          phase: "analyse",
          ratio: (i + (t ? r / t : 0)) / m.tracks.length,
        }),
    }))
      env.push(x);
    regions.push(speechRegions(env.db));
  }
  const totalSpeech = regions.flat().reduce((a, [s, e]) => a + e - s, 0);
  // 2) Modèle.
  post({ type: "progress", phase: "modele", ratio: 0 });
  const { asr, device } = await loadModel(m.model);
  // 3) Transcription des passages parlés, piste par piste.
  const language = WHISPER_LANGUAGES[m.language] ?? "french";
  const segments: Segment[] = [];
  let done = 0;
  for (let i = 0; i < m.tracks.length; i++) {
    const regs = regions[i] ?? [];
    if (!regs.length) continue;
    const speaker = m.tracks[i]!.speaker;
    const down = new Down();
    let pos = 0; // en échantillons à 16 kHz
    let r = 0;
    let cur: number[] = [];
    const flush = async (reg: [number, number]) => {
      const audio = Float32Array.from(cur);
      cur = [];
      if (audio.length < SR * 0.3) return;
      const out = await asr(audio, {
        language,
        task: "transcribe",
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
      });
      const chunks = out.chunks?.length
        ? out.chunks
        : [{ timestamp: [0, audio.length / SR] as [number, number], text: out.text }];
      for (const c of chunks) {
        const s = reg[0] + (c.timestamp[0] ?? 0);
        const e = reg[0] + (c.timestamp[1] ?? audio.length / SR);
        segments.push({ start: s, end: Math.min(e, reg[1]), speaker, text: c.text.trim() });
      }
      done += reg[1] - reg[0];
      post({
        type: "progress",
        phase: "transcription",
        ratio: totalSpeech ? Math.min(1, done / totalSpeech) : 1,
        detail: speaker,
      });
    };
    for await (const x of readWav(m.tracks[i]!.url)) {
      const y = down.push(x);
      for (let k = 0; k < y.length && r < regs.length; k++, pos++) {
        const t = pos / SR;
        const reg = regs[r]!;
        if (t >= reg[0] && t < reg[1]) cur.push(y[k] as number);
        else if (t >= reg[1]) {
          await flush(reg);
          r++;
          const next = regs[r];
          if (next && t >= next[0] && t < next[1]) cur.push(y[k] as number);
        }
      }
      if (r >= regs.length) break;
    }
    if (r < regs.length) await flush(regs[r]!);
  }
  post({ type: "done", segments, model: MODELS[m.model], device });
}

self.onmessage = (e: MessageEvent<TranscribeIn>) => {
  transcribe(e.data).catch((err: unknown) =>
    post({
      type: "error",
      message:
        err instanceof Error
          ? `${err.message}${/fetch|network/i.test(err.message) ? " (le modèle se télécharge depuis huggingface.co : vérifiez la connexion)" : ""}`
          : String(err),
    }),
  );
};
