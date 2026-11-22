import type { CheckStatus, EquipmentCheck } from "@pod-stud/shared";

/** Résultat du test d'équipement, conservé sur l'appareil pour le jour J (SAL-10). */
export interface SavedTest {
  name: string;
  at: string;
  verdict: CheckStatus;
  checks: EquipmentCheck[];
  browser: string;
}

const KEY = "podstud.testEquipement";

export function loadSavedTest(): SavedTest | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedTest) : null;
  } catch {
    return null;
  }
}

export function saveTest(t: SavedTest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    // stockage indisponible (navigation privée) : le test reste affiché, il ne sera simplement pas conservé
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem("podstud.nom") ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem("podstud.nom", name);
  } catch {
    /* idem */
  }
}

/** Périphériques choisis, mémorisés sur cet appareil (identifiant et nom, car l'identifiant peut changer). */
export interface DevicePref {
  id: string;
  label: string;
}
export interface DevicePrefs {
  mic?: DevicePref;
  cam?: DevicePref;
  out?: DevicePref;
}

export function loadDevicePrefs(): DevicePrefs {
  try {
    const p = JSON.parse(localStorage.getItem("podstud.peripheriques") ?? "{}") as DevicePrefs;
    return typeof p === "object" && p ? p : {};
  } catch {
    return {};
  }
}

export function saveDevicePref(kind: keyof DevicePrefs, id: string, label: string) {
  try {
    const p = loadDevicePrefs();
    p[kind] = { id, label };
    localStorage.setItem("podstud.peripheriques", JSON.stringify(p));
  } catch {
    /* stockage indisponible */
  }
}

/** Retrouve l'appareil mémorisé dans la liste, par identifiant puis par nom. */
export function findPreferred(
  devices: MediaDeviceInfo[],
  pref?: DevicePref,
): MediaDeviceInfo | undefined {
  if (!pref) return undefined;
  return (
    devices.find((d) => d.deviceId === pref.id) ??
    devices.find((d) => d.label && d.label === pref.label)
  );
}
