"use client";
import type { Treatment } from "@pod-stud/shared";
import type { PostprodIn, PostprodOut } from "./postprod.worker";

const newWorker = () =>
  new Worker(new URL("./postprod.worker.ts", import.meta.url), { type: "module" });

function run(msg: PostprodIn, onProgress?: (phase: string, ratio: number) => void) {
  return new Promise<Extract<PostprodOut, { type: "done" | "apercu" }>>((resolve, reject) => {
    const w = newWorker();
    w.onmessage = (e: MessageEvent<PostprodOut>) => {
      const m = e.data;
      if (m.type === "progress") return onProgress?.(m.phase, m.ratio);
      w.terminate();
      if (m.type === "error") reject(new Error(m.message));
      else resolve(m);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || "Le traitement s'est arrêté."));
    };
    w.postMessage(msg);
  });
}

export function processTrack(
  cid: string,
  takeId: string,
  treatment: Treatment,
  cle: string,
  onProgress: (phase: string, ratio: number) => void,
) {
  return run(
    {
      type: "traiter",
      url: `/api/collectifs/${cid}/pistes/${takeId}`,
      uploadUrl: `/api/collectifs/${cid}/postprod/${takeId}`,
      treatment,
      cle,
    },
    onProgress,
  ) as Promise<Extract<PostprodOut, { type: "done" }>>;
}

export function previewTrack(cid: string, takeId: string, treatment: Treatment, startSec: number) {
  return run({
    type: "apercu",
    url: `/api/collectifs/${cid}/pistes/${takeId}`,
    treatment,
    startSec,
    seconds: 20,
  }) as Promise<Extract<PostprodOut, { type: "apercu" }>>;
}
