import { chunkName, missingChunks, retryDelay } from "@pod-stud/shared";
import {
  getTake,
  localChunks,
  readChunk,
  removeChunk,
  removeTakeDir,
  sha256,
  toManifest,
  updateTake,
} from "./takes";

/**
 * File d'envoi (ENR-05) : envoie les morceaux au serveur au fil de l'eau, deux à la fois.
 * Chaque morceau part avec son empreinte SHA-256 ; le serveur la recalcule et refuse un morceau abîmé.
 * Un morceau n'est effacé de l'appareil qu'après confirmation du serveur. En cas d'échec (réseau coupé,
 * serveur indisponible), nouvelle tentative après 1 s, 2 s, 4 s… jusqu'à 15 s, et tout de suite au retour du réseau.
 */
export interface UploadStatus {
  /** Morceaux en attente d'envoi (toutes prises confondues). */
  pending: number;
  online: boolean;
  /** Dernière erreur d'envoi, effacée au premier succès. */
  error: string | null;
  /** Prochaine tentative prévue (horodatage), si l'envoi est en pause après un échec. */
  retryAt: number | null;
}

const CONCURRENCY = 2;

export class Uploader {
  private queue = new Map<string, Set<number>>();
  private inflight = new Set<string>();
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private finishing = new Set<string>();
  private listeners = new Set<() => void>();
  status: UploadStatus = { pending: 0, online: true, error: null, retryAt: null };

  constructor() {
    if (typeof window === "undefined") return;
    this.status.online = navigator.onLine;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
  }

  dispose() {
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    if (this.timer) clearTimeout(this.timer);
  }

  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit() {
    let n = 0;
    this.queue.forEach((s) => (n += s.size));
    this.status = { ...this.status, pending: n };
    this.listeners.forEach((f) => f());
  }

  private onOnline = () => {
    this.status = { ...this.status, online: true };
    this.retryNow();
  };
  private onOffline = () => {
    this.status = { ...this.status, online: false };
    this.emit();
  };

  retryNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.failures = 0;
    this.status = { ...this.status, retryAt: null };
    this.pump();
  }

  /** Ajoute un morceau terminé à la file. */
  add(takeId: string, index: number) {
    let s = this.queue.get(takeId);
    if (!s) this.queue.set(takeId, (s = new Set()));
    s.add(index);
    this.pump();
  }

  /** Reprend une prise : tous les morceaux encore sur l'appareil repartent, puis la prise est clôturée. */
  async resume(takeId: string) {
    const local = await localChunks(takeId);
    for (const c of local) this.add(takeId, c.index);
    this.emit();
    await this.maybeFinish(takeId);
  }

  private pump() {
    this.emit();
    if (this.timer) return;
    for (const [id, set] of this.queue) {
      for (const i of [...set].sort((a, b) => a - b)) {
        if (this.inflight.size >= CONCURRENCY) return;
        const k = `${id}:${i}`;
        if (this.inflight.has(k)) continue;
        this.inflight.add(k);
        void this.send(id, i).finally(() => {
          this.inflight.delete(k);
          this.pump();
        });
      }
    }
  }

  private async send(id: string, index: number) {
    const name = chunkName(index);
    const file = await readChunk(id, name);
    const done = () => {
      this.queue.get(id)?.delete(index);
      updateTake(id, (t) => {
        if (!t.sent.includes(index)) t.sent.push(index);
      });
    };
    if (!file) {
      // Déjà confirmé et effacé (par exemple juste avant un plantage).
      done();
      return;
    }
    try {
      const body = await file.arrayBuffer();
      const res = await fetch(`/api/prises/${id}/morceaux/${index}`, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", "x-sha256": await sha256(body) },
        body,
      });
      if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`);
      done();
      await removeChunk(id, name);
      this.failures = 0;
      this.status = { ...this.status, error: null, retryAt: null, online: true };
      await this.maybeFinish(id);
    } catch (e) {
      this.failures++;
      const delay = retryDelay(this.failures - 1);
      this.status = {
        ...this.status,
        error: navigator.onLine ? (e as Error).message : "pas de connexion",
        retryAt: Date.now() + delay,
      };
      if (!this.timer)
        this.timer = setTimeout(() => {
          this.timer = null;
          this.status = { ...this.status, retryAt: null };
          this.pump();
        }, delay);
    }
  }

  /** Clôture la prise sur le serveur quand l'enregistrement est arrêté et que tout est envoyé. */
  async maybeFinish(id: string, force = false) {
    const t = getTake(id);
    if (!t || t.state !== "uploading" || t.chunkCount === null) return;
    if (missingChunks(t.sent, t.chunkCount).length || this.queue.get(id)?.size) return;
    if (this.finishing.has(id)) return;
    this.finishing.add(id);
    try {
      const res = await fetch(`/api/prises/${id}/fin${force ? "?force=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toManifest(t)),
      });
      if (res.status === 409) {
        // Le serveur signale des morceaux absents : on renvoie ceux qui sont encore sur l'appareil.
        const { missing } = (await res.json()) as { missing: number[] };
        const local = new Set((await localChunks(id)).map((c) => c.index));
        updateTake(id, (x) => (x.sent = x.sent.filter((i) => !missing.includes(i))));
        if (missing.some((i) => local.has(i))) {
          this.finishing.delete(id);
          await this.resume(id);
        } else {
          // Morceaux perdus pour de bon (effacés de l'appareil) : la prise est clôturée avec ses trous.
          updateTake(id, (x) => (x.sent = [...new Set([...x.sent, ...missing])]));
          this.finishing.delete(id);
          await this.maybeFinish(id, true);
        }
        return;
      }
      if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`);
      updateTake(id, (x) => (x.state = "done"));
      await removeTakeDir(id);
      this.emit();
    } catch (e) {
      this.status = { ...this.status, error: (e as Error).message };
      this.emit();
      setTimeout(() => void this.maybeFinish(id), retryDelay(2));
    } finally {
      this.finishing.delete(id);
    }
  }
}
