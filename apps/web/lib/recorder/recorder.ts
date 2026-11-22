import type { SyncPoint } from "@pod-stud/shared";
import type { ServerClock } from "../sync/clock";
import type { WriterIn, WriterOut } from "./writer.worker";

type AudioCtor = typeof AudioContext;

/**
 * Captation locale (ENR-03) : micro → processeur audio (son brut) → worker d'écriture (OPFS).
 * Le son ne transite pas par la page : un ralentissement de l'interface ne fait pas perdre d'échantillons.
 */
export interface RecorderEvents {
  onChunk(index: number, bytes: number): void;
  onProgress(frames: number): void;
  onError(message: string): void;
}

export class LocalRecorder {
  ctx!: AudioContext;
  private node!: AudioWorkletNode;
  private source!: MediaStreamAudioSourceNode;
  private sink!: GainNode;
  private worker!: Worker;
  private done: ((v: { chunkCount: number; frames: number }) => void) | null = null;
  sampleRate = 48000;
  /** Échantillon de l'horloge audio où la captation a réellement commencé. */
  startFrame: number | null = null;
  /** Retard du micro annoncé par le navigateur (ms), retiré des repères de synchro. */
  latencyMs = 0;
  private started: (() => void) | null = null;

  constructor(private readonly ev: RecorderEvents) {}

  /** Prépare la chaîne audio et le fichier local ; rend la fréquence d'échantillonnage retenue. */
  async prepare(stream: MediaStream, takeId: string): Promise<number> {
    const Ctor: AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
    // 48 kHz si possible ; Firefox refuse de mélanger deux fréquences : on prend alors celle du micro.
    try {
      this.ctx = new Ctor({ sampleRate: 48000 });
      this.source = this.ctx.createMediaStreamSource(stream);
    } catch {
      await this.ctx?.close().catch(() => undefined);
      this.ctx = new Ctor();
      this.source = this.ctx.createMediaStreamSource(stream);
    }
    this.sampleRate = this.ctx.sampleRate;
    const lat = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)
      ?.latency;
    this.latencyMs = typeof lat === "number" && lat > 0 && lat < 1 ? lat * 1000 : 0;
    await this.ctx.audioWorklet.addModule("/worklets/capture.js");
    this.node = new AudioWorkletNode(this.ctx, "podstud-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    // Sortie à volume nul : certains navigateurs ne font tourner que les nœuds reliés aux haut-parleurs.
    this.node.port.onmessage = (e: MessageEvent<{ type: string; frame?: number }>) => {
      if (e.data.type === "started" && typeof e.data.frame === "number") {
        this.startFrame = e.data.frame;
        this.started?.();
      }
    };
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink).connect(this.ctx.destination);

    this.worker = new Worker(new URL("./writer.worker.ts", import.meta.url), { type: "module" });
    const ch = new MessageChannel();
    this.node.port.postMessage({ type: "port", port: ch.port1 }, [ch.port1]);
    await new Promise<void>((resolve, reject) => {
      this.worker.onmessage = (e: MessageEvent<WriterOut>) => {
        const m = e.data;
        if (m.type === "ready") resolve();
        else if (m.type === "chunk") this.ev.onChunk(m.index, m.bytes);
        else if (m.type === "progress") this.ev.onProgress(m.frames);
        else if (m.type === "done") this.done?.({ chunkCount: m.chunkCount, frames: m.frames });
        else if (m.type === "error") {
          reject(new Error(m.message));
          this.ev.onError(m.message);
        }
      };
      this.worker.onerror = (e) => reject(new Error(e.message || "worker d'écriture indisponible"));
      const init: WriterIn = { type: "init", takeId, sampleRate: this.sampleRate, port: ch.port2 };
      this.worker.postMessage(init, [ch.port2]);
    });
    return this.sampleRate;
  }

  /** Correspondance entre l'horloge audio (s) et l'horloge locale de la page (ms). */
  private timestamp(): { ctxTime: number; perf: number } {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime && ts.contextTime)
      return { ctxTime: ts.contextTime, perf: ts.performanceTime };
    return { ctxTime: this.ctx.currentTime, perf: performance.now() };
  }

  /** Échantillon de l'horloge audio correspondant à une heure serveur. */
  private frameAt(serverMs: number, clock: ServerClock): number {
    const { ctxTime, perf } = this.timestamp();
    const perfTarget = clock.toLocal(serverMs) - performance.timeOrigin;
    return Math.round((ctxTime + (perfTarget - perf) / 1000) * this.sampleRate);
  }

  /**
   * Démarre la captation, tout de suite ou à une heure serveur précise (départ simultané) :
   * le processeur audio commence alors exactement à l'échantillon correspondant.
   */
  async start(atServerMs?: number, clock?: ServerClock) {
    if (this.ctx.state === "suspended")
      await Promise.race([this.ctx.resume().catch(() => undefined), sleep(1000)]);
    const started = new Promise<void>((r) => (this.started = r));
    const atFrame = atServerMs !== undefined && clock ? this.frameAt(atServerMs, clock) : undefined;
    this.node.port.postMessage({ type: "start", atFrame });
    const wait = atServerMs !== undefined && clock ? Math.max(0, atServerMs - clock.now()) : 0;
    await Promise.race([started, sleep(wait + 3000)]);
  }

  /** Repère de synchro : tel échantillon de la piste correspond à telle heure serveur. */
  syncPoint(clock: ServerClock): SyncPoint | null {
    if (this.startFrame === null || !clock.estimate) return null;
    const { ctxTime, perf } = this.timestamp();
    return {
      frame: Math.round(ctxTime * this.sampleRate) - this.startFrame,
      serverMs: clock.toServer(perf + performance.timeOrigin) - this.latencyMs,
    };
  }

  /** Arrête la captation (tout de suite ou à une heure serveur) et attend le dernier morceau. */
  async stop(
    atServerMs?: number,
    clock?: ServerClock,
  ): Promise<{ chunkCount: number; frames: number }> {
    const result = new Promise<{ chunkCount: number; frames: number }>((r) => (this.done = r));
    const atFrame = atServerMs !== undefined && clock ? this.frameAt(atServerMs, clock) : undefined;
    this.node.port.postMessage({ type: "stop", atFrame });
    const wait = atServerMs !== undefined && clock ? Math.max(0, atServerMs - clock.now()) : 0;
    const r = await Promise.race([result, sleep(wait + 10_000).then(() => null)]);
    this.dispose();
    if (!r) throw new Error("Le dernier morceau n'a pas pu être écrit.");
    return r;
  }

  dispose() {
    try {
      this.source?.disconnect();
      this.node?.disconnect();
    } catch {
      /* déjà débranché */
    }
    void this.ctx?.close().catch(() => undefined);
    this.worker?.terminate();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
