import "server-only";
import { fitClock, planTrack, type ClockFit, type TrackPlan } from "@pod-stud/shared";
import { getStore } from "./store";
import { readManifest, receivedChunks, type StoredManifest } from "./takes";

export const OUT_RATE = 48000;

export interface AlignedTrack {
  manifest: StoredManifest;
  fit: ClockFit;
  plan: TrackPlan;
  referenceMs: number;
  sourceFrames: number;
  outFrames: number;
}

/** Prises d'une séance (index écrit à la clôture de chaque prise). */
export async function sessionTakes(sessionId: string): Promise<StoredManifest[]> {
  const prefix = `seances/${sessionId}/prises/`;
  const list = await getStore().list(prefix);
  const out: StoredManifest[] = [];
  for (const o of list) {
    const id = o.key.slice(prefix.length).replace(/\.json$/, "");
    const m = await readManifest(id);
    if (m) out.push(m);
  }
  return out.sort((a, b) => (a.startServerMs ?? 0) - (b.startServerMs ?? 0));
}

/**
 * Plan d'alignement d'une prise : régression sur ses repères de synchro, puis calage sur le départ
 * commun annoncé par l'hôte. Sans repères (ancienne prise), on se fie au départ programmé.
 */
export async function alignTake(m: StoredManifest): Promise<AlignedTrack> {
  const chunks = await receivedChunks(m.id);
  const sourceFrames = chunks.reduce((s, c) => s + c.size, 0) / 3;
  const ref = m.startServerMs ?? Number.NaN;
  let fit = fitClock(m.syncPoints ?? [], m.sampleRate);
  if (!Number.isFinite(fit.startMs))
    fit = { startMs: Number.isFinite(ref) ? ref : 0, rate: m.sampleRate, residualMs: Number.NaN };
  const referenceMs = Number.isFinite(ref) ? ref : fit.startMs;
  const plan = planTrack(fit, referenceMs, OUT_RATE);
  const outFrames =
    plan.padFrames + Math.max(0, Math.floor((sourceFrames - plan.skipSourceFrames) / plan.step));
  return { manifest: m, fit, plan, referenceMs, sourceFrames, outFrames };
}
