/**
 * Évaluation du test d'équipement d'avant-session (exigence ENR-15).
 * Les mesures sont faites dans le navigateur ; les seuils et les conseils sont ici, en fonctions pures testées.
 */
import type { CheckStatus } from "./capabilities";

export interface EquipmentCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Conseil concret quand le contrôle n'est pas vert. */
  advice?: string;
}

/** Niveau en décibels pleine échelle (dBFS) d'une amplitude linéaire ; -120 pour le silence. */
export function toDb(linear: number): number {
  return linear > 0 ? Math.max(-120, 20 * Math.log10(linear)) : -120;
}

export interface FrameStats {
  rmsDb: number;
  peakDb: number;
  clipped: number;
}

/** Niveau moyen (RMS), crête et nombre d'échantillons saturés d'un bloc d'échantillons entre -1 et 1. */
export function frameStats(samples: ArrayLike<number>, clipThreshold = 0.999): FrameStats {
  let sum = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i] as number);
    sum += v * v;
    if (v > peak) peak = v;
    if (v >= clipThreshold) clipped++;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return { rmsDb: toDb(rms), peakDb: toDb(peak), clipped };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return -120;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx] as number;
}

export interface MicMeasure {
  /** Bruit de fond mesuré pendant le silence (médiane des blocs), en dBFS. */
  noiseFloorDb: number;
  /** Niveau de la voix pendant la lecture (90e centile des blocs), en dBFS. */
  speechDb: number;
  /** Crête maximale pendant la lecture, en dBFS. */
  peakDb: number;
  /** Nombre d'échantillons saturés. */
  clipped: number;
}

/** Synthèse des blocs mesurés pendant les phases « silence » et « lecture ». */
export function summarizeMic(silence: FrameStats[], speech: FrameStats[]): MicMeasure {
  return {
    noiseFloorDb: percentile(
      silence.map((f) => f.rmsDb),
      50,
    ),
    speechDb: percentile(
      speech.map((f) => f.rmsDb),
      90,
    ),
    peakDb: Math.max(-120, ...speech.map((f) => f.peakDb)),
    clipped: speech.reduce((n, f) => n + f.clipped, 0),
  };
}

const fmt = (db: number) => `${Math.round(db)} dB`;

export function evaluateMic(m: MicMeasure): EquipmentCheck[] {
  const checks: EquipmentCheck[] = [];
  const voiceAboveNoise = m.speechDb - m.noiseFloorDb;

  if (voiceAboveNoise < 6) {
    checks.push({
      id: "voice",
      label: "Voix détectée",
      status: "ko",
      detail: "Aucune voix nettement au-dessus du bruit de fond n'a été entendue.",
      advice:
        "Vérifiez que le bon micro est choisi, qu'il n'est pas coupé (bouton mute du casque ou du micro), puis recommencez en parlant normalement.",
    });
  } else if (m.speechDb < -42) {
    checks.push({
      id: "voice",
      label: "Niveau de la voix",
      status: "ko",
      detail: `Voix trop faible (${fmt(m.speechDb)}).`,
      advice:
        "Rapprochez-vous du micro (10 à 20 cm) ou montez le gain du micro dans les réglages son de l'ordinateur, puis recommencez.",
    });
  } else if (m.speechDb < -32) {
    checks.push({
      id: "voice",
      label: "Niveau de la voix",
      status: "warn",
      detail: `Voix un peu faible (${fmt(m.speechDb)}).`,
      advice: "Rapprochez-vous un peu du micro ou montez légèrement son gain.",
    });
  } else if (m.speechDb > -14) {
    checks.push({
      id: "voice",
      label: "Niveau de la voix",
      status: "warn",
      detail: `Voix très forte (${fmt(m.speechDb)}) : les éclats de rire risquent de saturer.`,
      advice: "Reculez un peu du micro ou baissez son gain.",
    });
  } else {
    checks.push({
      id: "voice",
      label: "Niveau de la voix",
      status: "ok",
      detail: `Bon niveau de voix (${fmt(m.speechDb)}).`,
    });
  }

  checks.push(
    m.clipped > 0
      ? {
          id: "clipping",
          label: "Saturation",
          status: "ko",
          detail: `Le micro a saturé (${m.clipped} échantillons écrêtés, crête à ${fmt(m.peakDb)}). Une saturation ne se corrige pas après coup.`,
          advice: "Baissez le gain du micro ou éloignez-vous un peu, puis recommencez.",
        }
      : {
          id: "clipping",
          label: "Saturation",
          status: "ok",
          detail: `Aucune saturation (crête à ${fmt(m.peakDb)}).`,
        },
  );

  if (m.noiseFloorDb > -35) {
    checks.push({
      id: "noise",
      label: "Bruit de fond",
      status: "ko",
      detail: `Bruit de fond très présent (${fmt(m.noiseFloorDb)}).`,
      advice:
        "Éloignez les sources de bruit (ventilateur, fenêtre, machine), fermez la porte, ou changez de pièce.",
    });
  } else if (m.noiseFloorDb > -50) {
    checks.push({
      id: "noise",
      label: "Bruit de fond",
      status: "warn",
      detail: `Bruit de fond audible (${fmt(m.noiseFloorDb)}).`,
      advice: "Si possible, coupez ventilateur ou climatisation et fermez la fenêtre.",
    });
  } else {
    checks.push({
      id: "noise",
      label: "Bruit de fond",
      status: "ok",
      detail: `Pièce calme (${fmt(m.noiseFloorDb)}).`,
    });
  }
  return checks;
}

export interface EchoMeasure {
  /** La personne déclare porter un casque ou des écouteurs. */
  headphones: boolean;
  /** Le son joué par les haut-parleurs a été entendu dans le micro. null : test non fait. */
  echoDetected: boolean | null;
}

export function evaluateEcho(e: EchoMeasure): EquipmentCheck {
  if (e.echoDetected) {
    return {
      id: "echo",
      label: "Casque et écho",
      status: e.headphones ? "warn" : "ko",
      detail: "Le son de vos haut-parleurs revient dans votre micro.",
      advice: e.headphones
        ? "Votre casque laisse passer le son : baissez son volume ou utilisez des écouteurs fermés."
        : "Branchez un casque ou des écouteurs filaires : sinon les voix des autres seront enregistrées sur votre piste.",
    };
  }
  if (!e.headphones) {
    return {
      id: "echo",
      label: "Casque et écho",
      status: "warn",
      detail:
        e.echoDetected === false
          ? "Pas d'écho détecté, mais vous n'avez pas de casque."
          : "Vous n'avez pas de casque.",
      advice:
        "Un casque ou des écouteurs filaires sont fortement conseillés. Évitez le Bluetooth sur téléphone, qui dégrade le micro.",
    };
  }
  return {
    id: "echo",
    label: "Casque et écho",
    status: "ok",
    detail: "Casque en place, pas d'écho détecté.",
  };
}

export interface CameraMeasure {
  width: number;
  height: number;
  /** Luminosité moyenne de l'image, de 0 (noir) à 255 (blanc). */
  brightness: number;
}

export function evaluateCamera(c: CameraMeasure): EquipmentCheck[] {
  const checks: EquipmentCheck[] = [];
  const res = `${c.width} × ${c.height}`;
  if (c.height >= 1080) {
    checks.push({
      id: "resolution",
      label: "Définition de la caméra",
      status: "ok",
      detail: `Full HD (${res}).`,
    });
  } else if (c.height >= 720) {
    checks.push({
      id: "resolution",
      label: "Définition de la caméra",
      status: "ok",
      detail: `HD 720p (${res}).`,
    });
  } else {
    checks.push({
      id: "resolution",
      label: "Définition de la caméra",
      status: "warn",
      detail: `Définition faible (${res}) : la vidéo sera en dessous de 720p.`,
      advice:
        "Utilisez une autre caméra si vous en avez une, ou fermez les autres applications qui l'utilisent.",
    });
  }
  if (c.brightness < 60) {
    checks.push({
      id: "light",
      label: "Lumière",
      status: "warn",
      detail: "Image trop sombre.",
      advice: "Allumez une lampe face à vous ; évitez d'avoir une fenêtre dans le dos.",
    });
  } else if (c.brightness > 215) {
    checks.push({
      id: "light",
      label: "Lumière",
      status: "warn",
      detail: "Image surexposée.",
      advice: "Réduisez la lumière directe sur la caméra ou tournez-vous légèrement.",
    });
  } else {
    checks.push({ id: "light", label: "Lumière", status: "ok", detail: "Bonne luminosité." });
  }
  return checks;
}

export interface NetworkMeasure {
  /** Temps d'aller-retour médian vers le serveur, en millisecondes. */
  rttMs: number;
  /** Débit montant mesuré, en mégabits par seconde. */
  uploadMbps: number;
}

/** Envoi de l'audio pleine qualité : environ 1,2 Mbit/s ; la conversation en direct s'y ajoute. */
export function evaluateNetwork(n: NetworkMeasure): EquipmentCheck[] {
  const checks: EquipmentCheck[] = [];
  const mbps = n.uploadMbps.toFixed(1).replace(".", ",");
  if (n.uploadMbps < 1.5) {
    checks.push({
      id: "upload",
      label: "Débit d'envoi",
      status: "ko",
      detail: `Débit montant faible (${mbps} Mbit/s).`,
      advice:
        "L'enregistrement restera complet, mais l'envoi prendra du retard : restez sur la page après la fin. Rapprochez-vous de la box, branchez un câble, ou coupez les autres usages (vidéos, sauvegardes).",
    });
  } else if (n.uploadMbps < 3) {
    checks.push({
      id: "upload",
      label: "Débit d'envoi",
      status: "warn",
      detail: `Débit montant juste (${mbps} Mbit/s).`,
      advice: "Évitez les autres usages de la connexion pendant la session.",
    });
  } else {
    checks.push({
      id: "upload",
      label: "Débit d'envoi",
      status: "ok",
      detail: `Bon débit montant (${mbps} Mbit/s).`,
    });
  }
  const rtt = Math.round(n.rttMs);
  if (n.rttMs > 800) {
    checks.push({
      id: "latency",
      label: "Temps de réponse",
      status: "ko",
      detail: `Connexion très lente à répondre (${rtt} ms).`,
      advice:
        "La conversation en direct sera difficile : changez de réseau si possible (Wi-Fi plus proche, câble, 4G).",
    });
  } else if (n.rttMs > 300) {
    checks.push({
      id: "latency",
      label: "Temps de réponse",
      status: "warn",
      detail: `Temps de réponse élevé (${rtt} ms).`,
      advice: "Le direct peut avoir un léger décalage ; l'enregistrement n'est pas affecté.",
    });
  } else {
    checks.push({
      id: "latency",
      label: "Temps de réponse",
      status: "ok",
      detail: `Bonne réactivité (${rtt} ms).`,
    });
  }
  return checks;
}

export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("ko")) return "ko";
  if (statuses.includes("warn")) return "warn";
  return "ok";
}

export const VERDICT_TEXT: Record<CheckStatus, string> = {
  ok: "Tout est prêt pour l'enregistrement.",
  warn: "Vous pouvez enregistrer, mais suivez les conseils en orange pour un meilleur son.",
  ko: "Un problème empêche un bon enregistrement : suivez les conseils en rouge puis refaites le test.",
};

export type SessionMode = "audio" | "video";

/**
 * Espace disque selon le type de session choisi par l'hôte. Les morceaux sont effacés après envoi :
 * la marge sert surtout en cas de longue coupure réseau. Jamais rouge, au pire orange.
 */
export function evaluateStorage(availableBytes: number | null, mode: SessionMode): EquipmentCheck {
  const GB = 1024 ** 3;
  const perHour = mode === "video" ? 3.5 * GB : 0.52 * GB;
  const minHours = mode === "video" ? 2 : 3;
  const what = mode === "video" ? "de vidéo 1080p" : "d'audio";
  if (availableBytes === null) {
    return {
      id: "storage",
      label: "Espace pour l'enregistrement",
      status: "warn",
      detail: "Le navigateur n'indique pas l'espace disponible.",
      advice:
        mode === "video"
          ? "Gardez au moins 8 Go libres sur l'appareil."
          : "Gardez au moins 2 Go libres sur l'appareil.",
    };
  }
  const hours = availableBytes / perHour;
  const h =
    hours >= 20
      ? "plus de 20 h"
      : hours < 1
        ? `${Math.floor(hours * 60)} min`
        : `${Math.floor(hours)} h${Math.floor((hours % 1) * 6) ? " " + Math.floor((hours % 1) * 6) * 10 : ""}`;
  return hours >= minHours
    ? {
        id: "storage",
        label: "Espace pour l'enregistrement",
        status: "ok",
        detail: `Place pour environ ${h} ${what}.`,
      }
    : {
        id: "storage",
        label: "Espace pour l'enregistrement",
        status: "warn",
        detail: `Place pour seulement ${h} ${what}.`,
        advice:
          "Cela suffit si la connexion tient, car les fichiers sont effacés de l'appareil au fur et à mesure de l'envoi. Par sécurité, libérez de l'espace disque.",
      };
}
