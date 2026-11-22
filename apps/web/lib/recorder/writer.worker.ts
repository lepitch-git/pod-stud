/// <reference lib="webworker" />
/**
 * Worker d'écriture (ENR-04) : reçoit le son brut du processeur audio, le convertit en PCM 24 bits
 * et l'écrit au fil de l'eau dans l'espace de fichiers privé du navigateur (OPFS), un fichier par
 * morceau de quelques secondes. Le fichier en cours est vidé sur le disque chaque seconde : en cas de
 * plantage, on ne perd au plus qu'une seconde. Chaque morceau terminé est annoncé à la page avec son
 * empreinte SHA-256, pour être envoyé puis vérifié par le serveur.
 */
import { chunkFrames, chunkName, floatToPcm24 } from "@pod-stud/shared";

declare const self: DedicatedWorkerGlobalScope;

interface SyncHandle {
  write(buf: ArrayBufferView, opts?: { at?: number }): number;
  flush(): void;
  close(): void;
  truncate(size: number): void;
}

export type WriterIn = { type: "init"; takeId: string; sampleRate: number; port: MessagePort };
export type WriterOut =
  | { type: "ready" }
  | { type: "chunk"; index: number; bytes: number; sha256: string }
  | { type: "progress"; frames: number }
  | { type: "done"; chunkCount: number; frames: number }
  | { type: "error"; message: string };

let dir: FileSystemDirectoryHandle;
let frameSize = 0;
let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
let pos = 0;
let index = 0;
let handle: SyncHandle | null = null;
let written = 0; // octets du morceau en cours déjà écrits sur le disque
let frames = 0;
let lastFlush = 0;
let lastProgress = 0;
let queue: Promise<void> = Promise.resolve();
let failed = false;

const post = (m: WriterOut) => self.postMessage(m);

async function hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function openChunk() {
  const fh = await dir.getFileHandle(chunkName(index), { create: true });
  handle = (await (
    fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }
  ).createSyncAccessHandle()) as SyncHandle;
  handle.truncate(0);
  pos = 0;
  written = 0;
}

function writePending() {
  if (!handle || pos === written) return;
  handle.write(buf.subarray(written, pos), { at: written });
  written = pos;
}

async function closeChunk() {
  if (!handle) return;
  writePending();
  handle.flush();
  handle.close();
  handle = null;
  if (pos > 0) {
    const data = buf.slice(0, pos);
    post({ type: "chunk", index, bytes: pos, sha256: await hex(data) });
    index++;
  } else {
    await dir.removeEntry(chunkName(index)).catch(() => undefined);
  }
}

async function onPcm(data: Float32Array) {
  let off = 0;
  while (off < data.length) {
    if (!handle) await openChunk();
    const room = (buf.length - pos) / 3;
    const take = Math.min(room, data.length - off);
    pos = floatToPcm24(data.subarray(off, off + take), buf, pos);
    off += take;
    frames += take;
    if (pos === buf.length) await closeChunk();
  }
  const now = performance.now();
  if (handle && now - lastFlush > 1000) {
    writePending();
    handle.flush();
    lastFlush = now;
  }
  if (now - lastProgress > 500) {
    post({ type: "progress", frames });
    lastProgress = now;
  }
}

function fail(e: unknown) {
  if (failed) return;
  failed = true;
  const name = (e as { name?: string })?.name;
  post({
    type: "error",
    message:
      name === "QuotaExceededError"
        ? "Plus de place sur l'appareil : l'enregistrement local est interrompu."
        : `Écriture impossible sur l'appareil (${name ?? String(e)}).`,
  });
}

self.onmessage = async (e: MessageEvent<WriterIn>) => {
  const m = e.data;
  if (m.type !== "init") return;
  try {
    const root = await navigator.storage.getDirectory();
    const base = await root.getDirectoryHandle("podstud", { create: true });
    dir = await base.getDirectoryHandle(m.takeId, { create: true });
    frameSize = chunkFrames(m.sampleRate);
    buf = new Uint8Array(frameSize * 3);
    await openChunk();
  } catch (err) {
    fail(err);
    return;
  }
  m.port.onmessage = (ev: MessageEvent<{ type: string; data?: Float32Array }>) => {
    const msg = ev.data;
    queue = queue.then(async () => {
      if (failed) return;
      try {
        if (msg.type === "pcm" && msg.data) await onPcm(msg.data);
        else if (msg.type === "end") {
          await closeChunk();
          post({ type: "done", chunkCount: index, frames });
        }
      } catch (err) {
        fail(err);
      }
    });
  };
  post({ type: "ready" });
};
