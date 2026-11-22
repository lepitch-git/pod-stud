/**
 * Classement des périphériques audio et vidéo d'après leur nom, pour conseiller le meilleur choix
 * quand plusieurs micros, caméras ou sorties sont branchés (ENR-15).
 */

export type DeviceKind = "micro" | "camera" | "sortie";

export type DeviceCategory =
  | "externe" // micro USB, interface audio, webcam externe
  | "casque-filaire"
  | "integre"
  | "bluetooth"
  | "virtuel"
  | "inconnu";

export interface DeviceInfoLite {
  deviceId: string;
  label: string;
}

export interface DeviceAssessment {
  category: DeviceCategory;
  /** Plus le score est haut, plus l'appareil est conseillé. */
  score: number;
  /** Conseil affiché sous la liste quand cet appareil est choisi ; absent si rien à signaler. */
  note?: string;
}

const BLUETOOTH =
  /bluetooth|airpods|beats|bose|jabra|sony wh|wh-1000|buds|hands-?free|mains libres|\bbt\b/i;
const VIRTUAL =
  /virtual|virtuel|blackhole|soundflower|loopback|obs|zoom|teams|krisp|voicemeeter|nvidia broadcast|camo|snap camera|iriun|droidcam/i;
const BUILTIN =
  /built-?in|intégr|interne|internal|macbook|imac|facetime|realtek|microphone array|réseau de micros|haut-parleurs? (\(|de l)|speakers? \(|laptop|portable/i;
const EXTERNAL =
  /usb|shure|rode|røde|blue yeti|yeti|focusrite|scarlett|audient|motu|zoom h|tascam|behringer|elgato|wave:|samson|audio-technica|at2020|fifine|hyperx|logitech|brio|c920|c922|insta360|obsbot|razer kiyo/i;
const WIRED_HEADSET =
  /casque|headset|headphones|écouteurs|earpods|jack|prise casque|external headphones|line out/i;

/** Retire les préfixes ajoutés par les navigateurs (« Par défaut - », « Default - », « Communications - »). */
export function cleanLabel(label: string): string {
  return label.replace(/^(par défaut|default|communications|communication)\s*-\s*/i, "").trim();
}

export function assessDevice(label: string, kind: DeviceKind): DeviceAssessment {
  const l = cleanLabel(label);
  if (!l) return { category: "inconnu", score: 1 };
  if (VIRTUAL.test(l)) {
    return {
      category: "virtuel",
      score: 0,
      note:
        "Périphérique virtuel (logiciel) : choisissez plutôt votre vrai " +
        (kind === "camera" ? "caméra." : "micro ou casque."),
    };
  }
  if (BLUETOOTH.test(l)) {
    return {
      category: "bluetooth",
      score: kind === "sortie" ? 2 : 0.5,
      note:
        kind === "micro"
          ? "Micro Bluetooth : quand il est utilisé, le son passe en qualité téléphone, pour vous et pour ce que vous entendez. Préférez un micro filaire ou celui de l'ordinateur."
          : kind === "sortie"
            ? "Casque Bluetooth : il convient pour écouter, à condition de ne pas utiliser son micro, sinon tout le son bascule en qualité téléphone."
            : undefined,
    };
  }
  if (EXTERNAL.test(l)) return { category: "externe", score: 5 };
  if (kind !== "camera" && WIRED_HEADSET.test(l))
    return { category: "casque-filaire", score: kind === "sortie" ? 5 : 3 };
  if (BUILTIN.test(l)) {
    return {
      category: "integre",
      score: 2,
      note:
        kind === "micro"
          ? "Micro intégré à l'ordinateur : il fonctionne, mais capte plus la pièce et le clavier. Un micro USB ou un micro-casque filaire sonnera mieux."
          : kind === "sortie"
            ? "Haut-parleurs de l'ordinateur : le son des autres risque de revenir dans votre micro. Branchez un casque."
            : undefined,
    };
  }
  return { category: "inconnu", score: 2.5 };
}

/** Appareil conseillé parmi ceux disponibles (le premier en cas d'égalité, souvent celui par défaut). */
export function recommendDevice(devices: DeviceInfoLite[], kind: DeviceKind): string | null {
  let best: { id: string; score: number } | null = null;
  for (const d of devices) {
    const s = assessDevice(d.label, kind).score;
    if (!best || s > best.score) best = { id: d.deviceId, score: s };
  }
  return best?.id ?? null;
}

/** Ne garde qu'une entrée par appareil réel (Chrome duplique « Par défaut » et « Communications »). */
export function dedupeDevices<T extends DeviceInfoLite>(devices: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const d of devices) {
    if (d.deviceId === "communications") continue;
    const key = cleanLabel(d.label) || d.deviceId;
    if (d.deviceId === "default" || !seen.has(key)) {
      if (d.deviceId !== "default") seen.add(key);
      out.push(d);
    }
  }
  // l'entrée « default » est redondante si l'appareil réel correspondant est aussi présent
  return out.filter(
    (d) =>
      d.deviceId !== "default" ||
      !out.some((o) => o.deviceId !== "default" && cleanLabel(o.label) === cleanLabel(d.label)),
  );
}
