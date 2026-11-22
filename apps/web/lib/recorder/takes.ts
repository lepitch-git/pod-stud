import {
  parseChunkName,
  type Gap,
  type Marker,
  type SyncPoint,
  type TakeManifest,
} from "@pod-stud/shared";

/**
 * Prises enregistrées sur cet appareil. L'état est gardé dans localStorage (écriture immédiate,
 * survit à un plantage) ; le son lui-même est dans l'espace de fichiers privé (OPFS).
 * Un morceau présent dans OPFS est un morceau pas encore confirmé par le serveur : il est effacé
 * dès que le serveur l'a reçu et vérifié.
 */
export type TakeState = "recording" | "uploading" | "done";

export interface LocalTake {
  id: string;
  name: string;
  participant: string;
  sampleRate: number;
  startedAt: string;
  endedAt: string | null;
  state: TakeState;
  /** Nombre total de morceaux, connu à l'arrêt (ou à la reprise après plantage). */
  chunkCount: number | null;
  sent: number[];
  markers: Marker[];
  gaps: Gap[];
  browser: string;
  sessionId?: string;
  /** Place (séance et rôle) qui a enregistré la prise, pour la reprise après plantage. */
  lockKey?: string;
  startServerMs?: number;
  syncPoints?: SyncPoint[];
  clockRttMs?: number;
  /** Morceaux que le serveur n'a jamais reçus (perdus), signalés à la clôture. */
  lost?: number[];
  /** Vrai si la prise a été interrompue (onglet fermé, plantage) puis reprise. */
  recovered?: boolean;
}

const KEY = "podstud.prises";

export function loadTakes(): LocalTake[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as LocalTake[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveTakes(list: LocalTake[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-30)));
  } catch {
    /* stockage plein ou indisponible */
  }
}

export function getTake(id: string): LocalTake | undefined {
  return loadTakes().find((t) => t.id === id);
}

export function putTake(t: LocalTake) {
  const list = loadTakes().filter((x) => x.id !== t.id);
  list.push(t);
  saveTakes(list);
}

export function updateTake(id: string, f: (t: LocalTake) => void): LocalTake | undefined {
  const list = loadTakes();
  const t = list.find((x) => x.id === id);
  if (!t) return undefined;
  f(t);
  saveTakes(list);
  return t;
}

export function forgetTake(id: string) {
  saveTakes(loadTakes().filter((x) => x.id !== id));
}

export function toManifest(t: LocalTake): TakeManifest {
  return {
    id: t.id,
    name: t.name,
    participant: t.participant,
    sampleRate: t.sampleRate,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    chunkCount: t.chunkCount ?? 0,
    markers: t.markers,
    gaps: t.gaps,
    browser: t.browser,
    sessionId: t.sessionId,
    startServerMs: t.startServerMs,
    syncPoints: t.syncPoints,
    clockRttMs: t.clockRttMs,
  };
}

// --- Fichiers locaux (OPFS) ---

async function takeDir(id: string, create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle("podstud", { create });
    return await base.getDirectoryHandle(id, { create });
  } catch {
    return null;
  }
}

/** Morceaux encore présents sur l'appareil (donc pas encore confirmés par le serveur), avec leur taille. */
export async function localChunks(id: string): Promise<{ index: number; size: number }[]> {
  const dir = await takeDir(id);
  if (!dir) return [];
  const out: { index: number; size: number }[] = [];
  for await (const [name, h] of (
    dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
  ).entries()) {
    const index = parseChunkName(name);
    if (index === null || h.kind !== "file") continue;
    const f = await (h as FileSystemFileHandle).getFile();
    out.push({ index, size: f.size });
  }
  return out.sort((a, b) => a.index - b.index);
}

export async function readChunk(id: string, name: string): Promise<File | null> {
  const dir = await takeDir(id);
  if (!dir) return null;
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function removeChunk(id: string, name: string) {
  const dir = await takeDir(id);
  await dir?.removeEntry(name).catch(() => undefined);
}

export async function removeTakeDir(id: string) {
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle("podstud");
    await base.removeEntry(id, { recursive: true });
  } catch {
    /* déjà effacé */
  }
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
