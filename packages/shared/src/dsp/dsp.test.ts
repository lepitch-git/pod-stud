import { describe, expect, it } from "vitest";
import {
  BreathReducer,
  Compressor,
  DEFAULT_TREATMENT,
  Declicker,
  Denoiser,
  GainStage,
  Limiter,
  LoudnessMeter,
  PRESETS,
  Pipeline,
  TruePeakMeter,
  dbToGain,
  finalStages,
  normalizeTreatment,
  treatmentKey,
  voiceChain,
  type Stage,
} from "./index";

const FS = 48000;

/** Générateur pseudo-aléatoire reproductible. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const sine = (f: number, sec: number, amp = 1, fs = FS) =>
  Float32Array.from(
    { length: Math.round(sec * fs) },
    (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs),
  );

function noise(sec: number, amp: number, seed = 1) {
  const r = rng(seed);
  return Float32Array.from({ length: Math.round(sec * FS) }, () => amp * (r() * 2 - 1));
}

const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
};

const lufs = (x: Float32Array) => {
  const m = new LoudnessMeter(FS);
  m.push(x);
  return m.integrated();
};

/** Voix synthétique : harmoniques sur 150 Hz, syllabes de 250 ms modulées. */
function voice(sec: number, amp = 0.3) {
  const n = Math.round(sec * FS);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / FS;
    const env = Math.max(0, Math.sin(Math.PI * ((t * 4) % 1)));
    let v = 0;
    for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * 150 * h * t) / h;
    out[i] = amp * env * v * 0.5;
  }
  return out;
}

describe("mesure du volume (BS.1770)", () => {
  it("un sinus à 997 Hz plein niveau mesure environ -3,01 LUFS", () => {
    expect(lufs(sine(997, 5))).toBeCloseTo(-3.01, 1);
  });
  it("6 dB de moins donne 6 LU de moins", () => {
    expect(lufs(sine(997, 5, 0.5))).toBeCloseTo(-9.03, 1);
  });
  it("le silence rend -Infinity", () => {
    expect(lufs(new Float32Array(FS * 2))).toBe(-Infinity);
  });
  it("le pic vrai voit un pic entre deux échantillons", () => {
    // Sinus à fs/4 décalé de 45° : les échantillons valent ±0,707, le vrai pic vaut 1.
    const x = Float32Array.from({ length: 4000 }, (_, i) =>
      Math.sin((Math.PI / 2) * i + Math.PI / 4),
    );
    const m = new TruePeakMeter();
    m.push(x);
    expect(m.dbtp).toBeGreaterThan(-1);
    expect(m.dbtp).toBeLessThan(0.5);
  });
});

describe("chaîne de traitement : la durée ne change jamais", () => {
  const cases: [string, Stage[]][] = [
    ["gain", [new GainStage(2)]],
    ["débruiteur", [new Denoiser(0.5, 12)]],
    ["anti-clics", [new Declicker(FS, "moyen")]],
    ["respirations", [new BreathReducer(FS, 6)]],
    ["limiteur", [new Limiter(FS)]],
    ["compresseur", [new Compressor(FS, -20, 3)]],
  ];
  for (const [name, stages] of cases) {
    it(`${name} : autant d'échantillons en sortie qu'en entrée`, () => {
      for (const len of [1, 1000, 48000 + 123]) {
        const x = noise(len / FS, 0.1, len);
        const fresh = stages.map((s) => Object.create(Object.getPrototypeOf(s)) as Stage);
        void fresh;
        expect(Pipeline.run(stages, x).length).toBe(x.length);
      }
    });
  }
  it("le retard est compensé : le signal reste aligné", () => {
    const x = new Float32Array(FS);
    x[20000] = 1;
    const y = Pipeline.run([new GainStage(1), new Limiter(FS, 0)], x);
    let at = 0;
    for (let i = 1; i < y.length; i++) if (Math.abs(y[i]!) > Math.abs(y[at]!)) at = i;
    expect(at).toBe(20000);
  });
  it("tous les préréglages gardent la durée exacte", () => {
    const x = voice(3);
    for (const p of PRESETS) {
      const t = normalizeTreatment({
        ...DEFAULT_TREATMENT,
        preset: p.key,
        antiBouche: "moyen",
        respirations: 6,
      });
      expect(Pipeline.run(voiceChain(FS, t, 0), x).length).toBe(x.length);
    }
  });
});

describe("limiteur", () => {
  it("ne dépasse pas -1 dBTP même avec 12 dB de trop", () => {
    const x = voice(4, 0.9);
    const y = Pipeline.run(finalStages(FS, 12, -1), x);
    const m = new TruePeakMeter();
    m.push(y);
    expect(m.dbtp).toBeLessThanOrEqual(-0.95);
  });
  it("laisse passer un signal déjà sous le plafond", () => {
    const x = sine(440, 1, 0.3);
    const y = Pipeline.run([new Limiter(FS, -1)], x);
    expect(rms(y, 1000)).toBeCloseTo(rms(x, 1000), 3);
  });
});

describe("anti-bruits de bouche", () => {
  it("répare des clics courts sans toucher à la voix", () => {
    const clean = voice(2, 0.2);
    const x = clean.slice();
    const r = rng(7);
    const at = [12000, 30000, 51000, 70000];
    for (const p of at)
      for (let i = 0; i < 48; i++) x[p + i] = (x[p + i] as number) + (r() * 2 - 1) * 0.6;
    const d = new Declicker(FS, "moyen");
    const y = Pipeline.run([d], x);
    expect(d.repaired).toBeGreaterThanOrEqual(at.length);
    for (const p of at) {
      const before = rms(x, p, p + 48) - rms(clean, p, p + 48);
      const after = rms(y, p, p + 48) - rms(clean, p, p + 48);
      expect(after).toBeLessThan(before * 0.5);
    }
    expect(y.length).toBe(x.length);
  });
  it("ne répare rien sur une voix propre (réglage léger)", () => {
    const d = new Declicker(FS, "leger");
    Pipeline.run([d], voice(2, 0.2));
    expect(d.repaired).toBe(0);
  });
});

describe("réduction du bruit de fond", () => {
  it("baisse un souffle constant d'au moins 6 dB", () => {
    const x = noise(4, 0.05);
    const y = Pipeline.run([new Denoiser(1, 18)], x);
    const a = FS * 2;
    expect(20 * Math.log10(rms(y, a) / rms(x, a))).toBeLessThan(-6);
  });
  it("garde la voix à peu près au même niveau", () => {
    const v = voice(4, 0.3);
    const n = noise(4, 0.01, 3);
    const x = v.map((s, i) => s + (n[i] as number));
    const y = Pipeline.run([new Denoiser(0.5, 12)], x);
    const a = FS * 2;
    expect(Math.abs(20 * Math.log10(rms(y, a) / rms(x, a)))).toBeLessThan(3);
  });
});

describe("respirations", () => {
  it("baisse un souffle faible entre deux phrases, pas la voix", () => {
    const v = voice(6, 0.3);
    // Silence entre 2 s et 3,4 s avec un bruit de fond faible, et une « respiration » de 400 ms.
    const bg = noise(6, 0.0005, 5);
    const x = v.map((s, i) => s + (bg[i] as number));
    for (let i = 2 * FS; i < 3.4 * FS; i++) x[i] = bg[i] as number;
    const br = noise(0.4, 0.02, 9);
    // Souffle dans les aigus : bruit dérivé (premier ordre).
    const b0 = Math.round(2.5 * FS);
    for (let i = 1; i < br.length; i++)
      x[b0 + i] = (x[b0 + i] as number) + ((br[i] as number) - (br[i - 1] as number));
    const r = new BreathReducer(FS, 12);
    const y = Pipeline.run([r], x);
    expect(r.detected).toBeGreaterThanOrEqual(1);
    const mid = [b0 + 4800, b0 + br.length - 4800] as const;
    expect(20 * Math.log10(rms(y, ...mid) / rms(x, ...mid))).toBeLessThan(-6);
    expect(
      Math.abs(20 * Math.log10(rms(y, FS / 2, FS * 1.5) / rms(x, FS / 2, FS * 1.5))),
    ).toBeLessThan(0.5);
  });
});

describe("préréglages", () => {
  it("normalise un réglage incomplet ou invalide", () => {
    const t = normalizeTreatment({ preset: "inconnu" as never, voix: 500, bruit: -3 });
    expect(PRESETS.map((p) => p.key)).toContain(t.preset);
    expect(t.voix).toBeLessThanOrEqual(100);
    expect(t.bruit).toBeGreaterThanOrEqual(0);
  });
  it("la clé change quand un réglage change", () => {
    const a = treatmentKey(DEFAULT_TREATMENT);
    const b = treatmentKey({ ...DEFAULT_TREATMENT, bruit: DEFAULT_TREATMENT.bruit + 1 });
    expect(a).not.toBe(b);
  });
  it("après normalisation au volume cible, la voix traitée arrive à -16 LUFS et -1 dBTP", () => {
    const x = voice(6, 0.05);
    const t = normalizeTreatment({ preset: "radio" });
    const pre = -20 - lufs(x);
    const y = Pipeline.run(voiceChain(FS, t, pre), x);
    const z = Pipeline.run(finalStages(FS, -16 - lufs(y), -1), y);
    expect(lufs(z)).toBeGreaterThan(-17);
    expect(lufs(z)).toBeLessThan(-15);
    const m = new TruePeakMeter();
    m.push(z);
    expect(m.dbtp).toBeLessThanOrEqual(-0.95);
    expect(dbToGain(0)).toBe(1);
  });
});
