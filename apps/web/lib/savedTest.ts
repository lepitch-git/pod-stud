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
