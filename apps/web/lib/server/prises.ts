import "server-only";
import { dedupeNames, numberPrises, trackFileName, trashExpired } from "@pod-stud/shared";
import { sessionTakes } from "./align";
import { updateCollectif, type Collectif, type Session } from "./db";
import { getStore } from "./store";
import { chunkPrefix, manifestKey, receivedChunks, type StoredManifest } from "./takes";

export interface TrackView {
  takeId: string;
  /** Nom saisi par l'intervenant. */
  participant: string;
  /** Nom utilisé pour les fichiers : corrigé par l'hôte s'il l'a fait (ENR-18). */
  displayName: string;
  fileName: string;
  seconds: number;
  bytes: number;
  complete: boolean;
  browser: string;
}

export interface PriseView {
  key: string;
  number: number;
  startServerMs: number | null;
  recordedAt: string;
  deletedAt: string | null;
  seconds: number;
  bytes: number;
  tracks: TrackView[];
}

export const priseRef = (sessionId: string, key: string) => `${sessionId}/${key}`;

/** Prises d'une session, numérotées (ENR-19), avec les noms de fichiers d'export (ENR-18). */
export async function sessionPrises(c: Collectif, s: Session): Promise<PriseView[]> {
  const emission = c.emissions.find((e) => e.id === s.emissionId)?.name ?? "Emission";
  const episode = c.episodes.find((e) => e.id === s.episodeId)?.title ?? "Episode";
  const takes = await sessionTakes(s.id);
  const sizes = new Map<string, { bytes: number; count: number }>();
  await Promise.all(
    takes.map(async (t) => {
      const ch = await receivedChunks(t.id);
      sizes.set(t.id, { bytes: ch.reduce((a, x) => a + x.size, 0), count: ch.length });
    }),
  );
  return numberPrises(takes).map((g) => {
    const names = dedupeNames(
      g.tracks.map((t) => c.renames[t.id] || t.participant || "Intervenant"),
    );
    const tracks: TrackView[] = g.tracks.map((t: StoredManifest, i) => {
      const sz = sizes.get(t.id) ?? { bytes: 0, count: 0 };
      const displayName = names[i] as string;
      return {
        takeId: t.id,
        participant: t.participant,
        displayName,
        fileName: trackFileName({ emission, episode, prise: g.number, participant: displayName }),
        seconds: sz.bytes / 3 / t.sampleRate,
        bytes: sz.bytes,
        complete: sz.count >= t.chunkCount - (t.lost?.length ?? 0),
        browser: t.browser,
      };
    });
    const first = g.tracks[0];
    return {
      key: g.key,
      number: g.number,
      startServerMs: g.startServerMs,
      recordedAt: first?.startedAt ?? new Date(g.startServerMs ?? 0).toISOString(),
      deletedAt: c.deletedPrises[priseRef(s.id, g.key)] ?? null,
      seconds: Math.max(0, ...tracks.map((t) => t.seconds)),
      bytes: tracks.reduce((a, t) => a + t.bytes, 0),
      tracks,
    };
  });
}

/** Espace occupé par les enregistrements du collectif (quota, ENR-20). */
export async function collectifUsage(c: Collectif): Promise<number> {
  let total = 0;
  for (const s of c.sessions) {
    const takes = await sessionTakes(s.id);
    for (const t of takes) total += (await receivedChunks(t.id)).reduce((a, x) => a + x.size, 0);
  }
  return total;
}

async function eraseTake(id: string) {
  const store = getStore();
  for (const o of await store.list(chunkPrefix(id))) await store.delete(o.key);
  await store.delete(manifestKey(id));
}

/**
 * Suppression définitive des éléments restés plus de 30 jours dans la corbeille (ENR-20) :
 * faite au passage, lors de l'ouverture du collectif.
 */
export async function purgeTrash(c: Collectif) {
  const now = Date.now();
  const expiredPrises = Object.entries(c.deletedPrises).filter(([, d]) => trashExpired(d, now));
  const expiredSessions = c.sessions.filter((s) => s.deletedAt && trashExpired(s.deletedAt, now));
  if (!expiredPrises.length && !expiredSessions.length) return;
  const store = getStore();
  for (const [ref] of expiredPrises) {
    const [sid, key] = ref.split("/") as [string, string];
    const takes = (await sessionTakes(sid)).filter(
      (t) => (t.startServerMs ? String(t.startServerMs) : `seule-${t.id}`) === key,
    );
    for (const t of takes) {
      await eraseTake(t.id);
      await store.delete(`seances/${sid}/prises/${t.id}.json`);
    }
  }
  for (const s of expiredSessions) {
    for (const t of await sessionTakes(s.id)) {
      await eraseTake(t.id);
      await store.delete(`seances/${s.id}/prises/${t.id}.json`);
    }
  }
  await updateCollectif(c.id, (doc) => {
    for (const [ref] of expiredPrises) delete doc.deletedPrises[ref];
    const gone = new Set(expiredSessions.map((s) => s.id));
    doc.sessions = doc.sessions.filter((s) => !gone.has(s.id));
    doc.audit.push({
      at: new Date().toISOString(),
      by: "Pod Stud",
      what: `Corbeille vidée : ${expiredPrises.length} prise(s), ${expiredSessions.length} session(s) supprimées définitivement après 30 jours`,
    });
  });
}
