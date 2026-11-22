/**
 * Évaluation des capacités du navigateur nécessaires à l'enregistrement (exigences ENR-08 et ENR-15).
 * La collecte se fait dans le navigateur (apps/web/lib/probe.ts) ; l'évaluation est une fonction pure
 * pour pouvoir être testée sans navigateur.
 */

export type CheckStatus = "ok" | "warn" | "ko";

/** Données brutes relevées dans le navigateur. */
export interface CapabilityProbe {
  secureContext: boolean;
  getUserMedia: boolean;
  audioWorklet: boolean;
  webWorker: boolean;
  opfs: boolean;
  indexedDb: boolean;
  /** null : API absente ; true/false : stockage persistant déjà accordé ou non. */
  storagePersisted: boolean | null;
  /** Espace disponible estimé, en octets ; null si inconnu. */
  storageAvailableBytes: number | null;
  webrtc: boolean;
  mediaRecorder: boolean;
  /** Formats vidéo que MediaRecorder sait produire. */
  mediaRecorderTypes: string[];
  wakeLock: boolean;
  webCrypto: boolean;
}

export interface CheckResult {
  id: keyof CapabilityProbe | "storageSpace";
  label: string;
  status: CheckStatus;
  detail: string;
  /** Exigence(s) de la spécification concernée(s). */
  requirement: string;
}

export interface Diagnostic {
  verdict: CheckStatus;
  summary: string;
  checks: CheckResult[];
}

const GB = 1024 ** 3;
/** Une heure d'audio WAV 24 bits 48 kHz mono pèse environ 520 Mo ; on demande une marge confortable. */
export const MIN_FREE_BYTES_AUDIO = 2 * GB;

export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1).replace(".", ",")} Go`;
  return `${Math.round(bytes / 1024 ** 2)} Mo`;
}

export function evaluateCapabilities(p: CapabilityProbe): Diagnostic {
  const checks: CheckResult[] = [];
  const add = (c: CheckResult) => checks.push(c);

  add({
    id: "secureContext",
    label: "Connexion sécurisée (HTTPS)",
    status: p.secureContext ? "ok" : "ko",
    detail: p.secureContext
      ? "La page est servie en HTTPS : le micro et la caméra peuvent être demandés."
      : "La page n'est pas en HTTPS : le navigateur refusera l'accès au micro. Ouvrez le lien officiel en https://.",
    requirement: "ENR-08",
  });
  add({
    id: "getUserMedia",
    label: "Accès au micro et à la caméra",
    status: p.getUserMedia ? "ok" : "ko",
    detail: p.getUserMedia
      ? "Le navigateur sait accéder au micro et à la caméra."
      : "Ce navigateur ne permet pas d'accéder au micro. Utilisez une version récente de Chrome, Firefox, Safari ou Edge.",
    requirement: "ENR-08, ENR-15",
  });
  add({
    id: "audioWorklet",
    label: "Captation audio pleine qualité",
    status: p.audioWorklet ? "ok" : "ko",
    detail: p.audioWorklet
      ? "Le son pourra être enregistré sans perte (PCM 48 kHz) sur cet appareil."
      : "Le navigateur ne sait pas capter le son brut : l'enregistrement local est impossible. Mettez le navigateur à jour.",
    requirement: "ENR-03, ENR-08",
  });
  add({
    id: "webWorker",
    label: "Traitement en arrière-plan",
    status: p.webWorker ? "ok" : "ko",
    detail: p.webWorker
      ? "Les morceaux d'enregistrement pourront être écrits sans ralentir la page."
      : "Le navigateur ne permet pas le traitement en arrière-plan. Mettez le navigateur à jour.",
    requirement: "ENR-04",
  });

  let storageStatus: CheckStatus = "ok";
  let storageDetail =
    "Le navigateur dispose d'un espace de fichiers privé pour protéger l'enregistrement.";
  if (!p.opfs && p.indexedDb) {
    storageStatus = "warn";
    storageDetail =
      "Espace de fichiers privé absent : une solution de repli plus lente sera utilisée. Une mise à jour du navigateur est conseillée.";
  } else if (!p.opfs && !p.indexedDb) {
    storageStatus = "ko";
    storageDetail =
      "Aucun stockage local disponible (navigation privée ?) : l'enregistrement ne serait pas protégé en cas de coupure.";
  }
  add({
    id: "opfs",
    label: "Stockage local de l'enregistrement",
    status: storageStatus,
    detail: storageDetail,
    requirement: "ENR-04, ENR-05",
  });

  if (p.storageAvailableBytes === null) {
    add({
      id: "storageSpace",
      label: "Espace disque disponible",
      status: "warn",
      detail:
        "Le navigateur n'indique pas l'espace disponible. Prévoyez au moins 2 Go libres pour une heure d'audio.",
      requirement: "ENR-15",
    });
  } else {
    const ok = p.storageAvailableBytes >= MIN_FREE_BYTES_AUDIO;
    add({
      id: "storageSpace",
      label: "Espace disque disponible",
      status: ok ? "ok" : "warn",
      detail: ok
        ? `Environ ${formatBytes(p.storageAvailableBytes)} utilisables par le navigateur.`
        : `Seulement ${formatBytes(p.storageAvailableBytes)} utilisables : c'est juste pour une longue session. Libérez de l'espace disque.`,
      requirement: "ENR-15",
    });
  }

  add({
    id: "storagePersisted",
    label: "Stockage persistant",
    // « Pas encore accordé » est normal avant la première session : la demande est faite au démarrage.
    status: p.storagePersisted === null ? "warn" : "ok",
    detail:
      p.storagePersisted === true
        ? "Le navigateur s'engage à ne pas effacer les fichiers de l'enregistrement."
        : p.storagePersisted === false
          ? "Pas encore accordé : il sera demandé au lancement de l'enregistrement."
          : "Option non proposée par ce navigateur : les fichiers sont protégés, mais restez sur la page jusqu'à la fin de l'envoi.",
    requirement: "ENR-04",
  });
  add({
    id: "webrtc",
    label: "Conversation en direct",
    status: p.webrtc ? "ok" : "ko",
    detail: p.webrtc
      ? "La conversation en direct (WebRTC) est possible."
      : "Le navigateur ne gère pas la conversation en direct (WebRTC).",
    requirement: "ENR-01, ENR-08",
  });
  add({
    id: "mediaRecorder",
    label: "Enregistrement vidéo",
    status: p.mediaRecorder && p.mediaRecorderTypes.length > 0 ? "ok" : "warn",
    detail:
      p.mediaRecorder && p.mediaRecorderTypes.length > 0
        ? `Vidéo enregistrable (${p.mediaRecorderTypes.join(", ")}).`
        : "La vidéo ne pourra pas être enregistrée localement ; les sessions audio restent possibles.",
    requirement: "ENR-02",
  });
  add({
    id: "wakeLock",
    label: "Écran maintenu allumé",
    status: p.wakeLock ? "ok" : "warn",
    detail: p.wakeLock
      ? "L'écran pourra rester allumé pendant l'enregistrement."
      : "Le navigateur ne peut pas empêcher la mise en veille : désactivez le verrouillage automatique pendant la session.",
    requirement: "ENR-08",
  });
  add({
    id: "webCrypto",
    label: "Vérification d'intégrité",
    status: p.webCrypto ? "ok" : "ko",
    detail: p.webCrypto
      ? "Chaque morceau envoyé pourra être vérifié (empreinte SHA-256)."
      : "Impossible de vérifier l'intégrité des morceaux envoyés (page non sécurisée ou navigateur trop ancien).",
    requirement: "ENR-04",
  });

  const verdict: CheckStatus = checks.some((c) => c.status === "ko")
    ? "ko"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  const summary =
    verdict === "ok"
      ? "Ce navigateur est prêt pour l'enregistrement."
      : verdict === "warn"
        ? "Ce navigateur peut enregistrer, avec quelques points d'attention ci-dessous."
        : "Ce navigateur ne permet pas d'enregistrer dans de bonnes conditions. Voir les points en rouge.";
  return { verdict, summary, checks };
}
