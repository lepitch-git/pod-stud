import { frameStats, type FrameStats } from "@pod-stud/shared";

/** Contraintes du micro : son brut, comme pour l'enregistrement local (pas de traitement du navigateur). */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: { ideal: 48000 },
    },
  };
}

export async function listDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === kind && d.deviceId !== "");
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

type AudioCtor = typeof AudioContext;

/** Vu-mètre : lit le micro en continu et rend des statistiques par bloc. */
export class LevelMeter {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly buf: Float32Array<ArrayBuffer>;

  constructor(stream: MediaStream) {
    const Ctor: AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
    this.ctx = new Ctor();
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  read(): FrameStats {
    this.analyser.getFloatTimeDomainData(this.buf);
    return frameStats(this.buf);
  }

  /** Énergie (dB) autour d'une fréquence donnée, pour le test d'écho. */
  energyAt(freq: number): number {
    const bins = new Float32Array(this.analyser.frequencyBinCount);
    this.analyser.getFloatFrequencyData(bins);
    const i = Math.round((freq / (this.ctx.sampleRate / 2)) * bins.length);
    let max = -200;
    for (let k = Math.max(0, i - 2); k <= Math.min(bins.length - 1, i + 2); k++)
      max = Math.max(max, bins[k] as number);
    return max;
  }

  async close() {
    this.source.disconnect();
    await this.ctx.close().catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Relève des blocs pendant `ms` millisecondes, toutes les 50 ms. */
export async function collectFrames(meter: LevelMeter, ms: number): Promise<FrameStats[]> {
  const frames: FrameStats[] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    frames.push(meter.read());
    await sleep(50);
  }
  return frames;
}

/**
 * Test d'écho : joue un son de 1 kHz dans les haut-parleurs et regarde s'il revient dans le micro.
 * Avec un casque, il ne doit pas être entendu.
 */
export async function detectEcho(meter: LevelMeter): Promise<boolean> {
  const FREQ = 1000;
  const baseline: number[] = [];
  for (let i = 0; i < 10; i++) {
    baseline.push(meter.energyAt(FREQ));
    await sleep(50);
  }
  const osc = meter.ctx.createOscillator();
  const gain = meter.ctx.createGain();
  osc.frequency.value = FREQ;
  gain.gain.value = 0.25;
  osc.connect(gain).connect(meter.ctx.destination);
  osc.start();
  const during: number[] = [];
  await sleep(300);
  for (let i = 0; i < 20; i++) {
    during.push(meter.energyAt(FREQ));
    await sleep(50);
  }
  osc.stop();
  osc.disconnect();
  gain.disconnect();
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return avg(during) - avg(baseline) > 15;
}

/** Luminosité moyenne (0-255) de l'image de la caméra. */
export function measureBrightness(video: HTMLVideoElement): number {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g) return 128;
  g.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum +=
      0.299 * (data[i] as number) +
      0.587 * (data[i + 1] as number) +
      0.114 * (data[i + 2] as number);
  }
  return sum / (data.length / 4);
}

/** Temps de réponse médian et débit d'envoi vers notre serveur. */
export async function measureNetwork(): Promise<{ rttMs: number; uploadMbps: number }> {
  const rtts: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await fetch(`/api/ping?i=${i}&t=${Date.now()}`, { cache: "no-store" });
    rtts.push(performance.now() - t0);
  }
  rtts.sort((a, b) => a - b);
  const rttMs = rtts[Math.floor(rtts.length / 2)] as number;

  const payload = new Uint8Array(1024 * 1024);
  crypto.getRandomValues(payload.subarray(0, 65536)); // contenu peu compressible
  let bytes = 0;
  const t0 = performance.now();
  for (let i = 0; i < 2; i++) {
    await fetch("/api/ping", { method: "POST", body: payload, cache: "no-store" });
    bytes += payload.byteLength;
  }
  const seconds = Math.max(0.001, (performance.now() - t0 - rttMs * 2) / 1000);
  return { rttMs, uploadMbps: (bytes * 8) / seconds / 1e6 };
}
