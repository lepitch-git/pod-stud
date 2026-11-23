import { presetOf, type Treatment } from "./presets";

/**
 * Traitement d'une piste entière (étape 6a) : la chaîne tourne dans le navigateur de la personne
 * qui lance le traitement (aucune limite de durée côté serveur), et le résultat intermédiaire est
 * rangé sur le serveur en morceaux PCM 24 bits, 12 dB plus bas pour ne jamais saturer. La mise au
 * volume finale et le limiteur s'appliquent au téléchargement.
 */
export const POSTPROD_RATE = 48000;
export const STORE_HEADROOM_DB = -12;
export const POSTPROD_CHUNK_FRAMES = POSTPROD_RATE * 10;

export interface PostprodStats {
  /** Volume de la piste avant traitement (LUFS). */
  inputLufs: number;
  /** Volume après la chaîne, avant la mise au volume finale (LUFS). */
  outputLufs: number;
  /** Bruits de bouche réparés. */
  repaired: number;
  /** Respirations atténuées. */
  breaths: number;
}

/** Gain final (dB) à appliquer aux morceaux rangés pour atteindre le volume cible du preset. */
export function finalGainDb(t: Treatment, outputLufs: number): number {
  const target = presetOf(t.preset).targetLufs;
  if (!Number.isFinite(target) || !Number.isFinite(outputLufs)) return -STORE_HEADROOM_DB;
  // Jamais plus de +30 dB : une piste presque muette ne doit pas devenir un mur de bruit.
  return Math.min(30, target - outputLufs) - STORE_HEADROOM_DB;
}

/** Les clés de réglages sont aussi des noms de dossiers : on vérifie leur forme. */
export const isTreatmentKey = (k: string) =>
  /^[a-z]+\.\d{1,3}\.\d{1,3}\.\d{1,3}\.[a-z]+\.\d{1,2}$/.test(k);

export function pcm24ToFloat(b: Uint8Array, out = new Float32Array(Math.floor(b.length / 3))) {
  for (let i = 0, o = 0; i < out.length; i++, o += 3) {
    let v = (b[o] as number) | ((b[o + 1] as number) << 8) | ((b[o + 2] as number) << 16);
    if (v & 0x800000) v -= 0x1000000;
    out[i] = v / (v < 0 ? 0x800000 : 0x7fffff);
  }
  return out;
}

/** Réglages du mixage d'une prise (étape 6b). */
export interface MixSettings {
  /** Durée maximale des silences communs, en secondes (0 : on ne touche pas aux silences). */
  silenceMax: number;
  /** Vitesse de lecture, sans changer la hauteur des voix (0,8 à 1,25). */
  speed: number;
  /** Volume final : -16 LUFS (podcast) ou -23 LUFS (diffusion radio). */
  target: -16 | -23;
}

export const SILENCE_CHOICES = [0, 0.5, 0.7, 1, 1.5];
export const DEFAULT_MIX: MixSettings = { silenceMax: 0, speed: 1, target: -16 };

export function normalizeMix(m: Partial<MixSettings> | undefined): MixSettings {
  const speed = Math.round(Number(m?.speed ?? 1) * 20) / 20;
  return {
    silenceMax: SILENCE_CHOICES.includes(Number(m?.silenceMax)) ? Number(m?.silenceMax) : 0,
    speed: speed >= 0.8 && speed <= 1.25 ? speed : 1,
    target: Number(m?.target) === -23 ? -23 : -16,
  };
}

/** Identifiant d'envoi (dossier) choisi par le navigateur : 16 caractères hexadécimaux. */
export const isUploadId = (u: string) => /^[0-9a-f]{16}$/.test(u);
