import { Biquad } from "./biquad";
import { Declicker, type Intensity } from "./declick";
import { Denoiser } from "./denoise";
import { BreathReducer } from "./breath";
import { Compressor, DeEsser, Limiter } from "./dynamics";
import { GainStage, type Stage } from "./stage";

/** Presets voix (spécifications, « Presets proposés »), prêts à l'emploi. */
export type PresetKey = "naturel" | "radio" | "clarte" | "diffusion" | "brut";

export interface Preset {
  key: PresetKey;
  label: string;
  help: string;
  highpassHz: number;
  warmthDb: number;
  boxDb: number;
  presenceDb: number;
  deEsser: Exclude<Intensity, "off"> | "off";
  ratio: number;
  targetLufs: number;
}

export const PRESETS: Preset[] = [
  {
    key: "naturel",
    label: "Naturel",
    help: "Fidèle à l'enregistrement",
    highpassHz: 80,
    warmthDb: 0,
    boxDb: 0,
    presenceDb: 0,
    deEsser: "leger",
    ratio: 2,
    targetLufs: -16,
  },
  {
    key: "radio",
    label: "Radio chaleureuse",
    help: "Voix pleine et proche",
    highpassHz: 90,
    warmthDb: 2,
    boxDb: -1,
    presenceDb: 1,
    deEsser: "moyen",
    ratio: 3,
    targetLufs: -16,
  },
  {
    key: "clarte",
    label: "Clarté",
    help: "Débats à plusieurs voix",
    highpassHz: 100,
    warmthDb: 0,
    boxDb: -3,
    presenceDb: 3,
    deEsser: "moyen",
    ratio: 2.5,
    targetLufs: -16,
  },
  {
    key: "diffusion",
    label: "Diffusion radio",
    help: "Comme Radio chaleureuse, au niveau broadcast (-23 LUFS)",
    highpassHz: 90,
    warmthDb: 2,
    boxDb: -1,
    presenceDb: 1,
    deEsser: "moyen",
    ratio: 3,
    targetLufs: -23,
  },
  {
    key: "brut",
    label: "Brut",
    help: "Aucun traitement",
    highpassHz: 0,
    warmthDb: 0,
    boxDb: 0,
    presenceDb: 0,
    deEsser: "off",
    ratio: 1,
    targetLufs: Number.NaN,
  },
];

export const presetOf = (k: string): Preset =>
  PRESETS.find((p) => p.key === k) ?? (PRESETS[0] as Preset);

/** Réglages d'un traitement : un preset, trois curseurs simples et les options de nettoyage. */
export interface Treatment {
  preset: PresetKey;
  /** Curseurs de 0 à 100 (50 = valeurs du preset). */
  voix: number;
  bruit: number;
  ambiance: number;
  antiBouche: Intensity;
  /** Atténuation des respirations en dB : 0 (désactivée), 6 ou 12. */
  respirations: 0 | 6 | 12;
}

export const DEFAULT_TREATMENT: Treatment = {
  preset: "naturel",
  voix: 50,
  bruit: 50,
  ambiance: 50,
  antiBouche: "leger",
  respirations: 0,
};

export function normalizeTreatment(t: Partial<Treatment> | undefined): Treatment {
  const c = (v: unknown, d: number) =>
    typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v) : d;
  return {
    preset: presetOf(String(t?.preset ?? "naturel")).key,
    voix: c(t?.voix, 50),
    bruit: c(t?.bruit, 50),
    ambiance: c(t?.ambiance, 50),
    antiBouche: (["off", "leger", "moyen", "fort"] as const).includes(t?.antiBouche as Intensity)
      ? (t?.antiBouche as Intensity)
      : "leger",
    respirations: t?.respirations === 6 || t?.respirations === 12 ? t.respirations : 0,
  };
}

/** Clé stable des réglages (pour savoir si un traitement déjà calculé est encore à jour). */
export const treatmentKey = (t: Treatment) =>
  `${t.preset}.${t.voix}.${t.bruit}.${t.ambiance}.${t.antiBouche}.${t.respirations}`;

/** Niveau de travail : chaque voix est d'abord ramenée vers -20 LUFS avant la chaîne. */
export const WORK_LUFS = -20;

/**
 * Chaîne de traitement d'une voix (sans la mise au volume finale) :
 * anti-bruits de bouche → passe-haut → réduction de bruit → égalisation (chaleur, son « carton »,
 * présence) → dé-esseur → compression douce → respirations.
 */
export function voiceChain(fs: number, t: Treatment, preGainDb: number): Stage[] {
  const p = presetOf(t.preset);
  const stages: Stage[] = [new GainStage(Math.pow(10, preGainDb / 20))];
  if (p.key === "brut") return stages;
  if (t.antiBouche !== "off") stages.push(new Declicker(fs, t.antiBouche));
  const eq: Biquad[] = [];
  eq.push(Biquad.of("highpass", fs, p.highpassHz, 0.7));
  // Curseur Voix : intensité de l'égalisation et de la compression (0 = neutre, 100 = double).
  const v = t.voix / 50;
  if (p.warmthDb) eq.push(Biquad.of("peaking", fs, 200, 0.9, p.warmthDb * v));
  if (p.boxDb) eq.push(Biquad.of("peaking", fs, 400, 1.0, p.boxDb * v));
  if (p.presenceDb) eq.push(Biquad.of("peaking", fs, 3500, 0.8, p.presenceDb * v));
  stages.push({
    latency: 0,
    process(x: Float32Array) {
      const out = x.slice();
      for (const f of eq.slice(0, 1)) f.process(out);
      return out;
    },
  });
  // Curseurs Bruit de fond (force) et Ambiance (ce que l'on garde de la pièce).
  if (t.bruit > 0) stages.push(new Denoiser(t.bruit / 100, 6 + (100 - t.ambiance) * 0.24));
  stages.push({
    latency: 0,
    process(x: Float32Array) {
      const out = x.slice();
      for (const f of eq.slice(1)) f.process(out);
      return out;
    },
  });
  if (p.deEsser !== "off")
    stages.push(new DeEsser(fs, { leger: -26, moyen: -30, fort: -34 }[p.deEsser]));
  const ratio = 1 + (p.ratio - 1) * v;
  if (ratio > 1.01) stages.push(new Compressor(fs, -26, ratio));
  if (t.respirations) stages.push(new BreathReducer(fs, t.respirations));
  return stages;
}

/** Mise au volume finale et plafond à -1 dBTP. */
export function finalStages(fs: number, gainDb: number, ceilingDb = -1): Stage[] {
  return [new GainStage(Math.pow(10, gainDb / 20)), new Limiter(fs, ceilingDb)];
}
