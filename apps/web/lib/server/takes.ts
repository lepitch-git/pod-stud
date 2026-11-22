import "server-only";
import { isValidTakeId, parseChunkName, type TakeManifest } from "@pod-stud/shared";
import { getStore } from "./store";

/** Emplacements : prises/<id>/morceaux/000000.pcm et prises/<id>/manifeste.json. */
export const chunkPrefix = (id: string) => `prises/${id}/morceaux/`;
export const manifestKey = (id: string) => `prises/${id}/manifeste.json`;

export function badId(id: string) {
  return isValidTakeId(id)
    ? null
    : Response.json({ error: "identifiant invalide" }, { status: 400 });
}

export async function receivedChunks(id: string) {
  const list = await getStore().list(chunkPrefix(id));
  return list
    .map((o) => ({ ...o, index: parseChunkName(o.key.slice(chunkPrefix(id).length)) }))
    .filter((o): o is { key: string; size: number; index: number } => o.index !== null);
}

export interface StoredManifest extends TakeManifest {
  receivedAt: string;
  /** Morceaux déclarés perdus (effacés de l'appareil avant d'avoir été envoyés). */
  lost: number[];
}

export async function readManifest(id: string): Promise<StoredManifest | null> {
  const raw = await getStore().get(manifestKey(id));
  return raw ? (JSON.parse(new TextDecoder().decode(raw)) as StoredManifest) : null;
}
