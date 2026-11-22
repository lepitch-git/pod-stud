import { FFT } from "./fft";
import { SampleQueue, type Stage } from "./stage";

/**
 * Réduction du bruit de fond par soustraction spectrale (TFCT 1024 points, recouvrement 75 %).
 * Le bruit est estimé en continu par statistiques de minimum (le plancher de chaque fréquence sur
 * environ 2,7 s), donc sans échantillon de silence à fournir. Le gain est lissé dans le temps et
 * en fréquence pour éviter les artefacts « gazouillants ».
 * - strength (0 à 1) : force de la réduction ;
 * - floorDb : atténuation maximale (garder un peu d'ambiance sonne plus naturel).
 */
export class Denoiser implements Stage {
  readonly latency: number;
  private readonly N = 1024;
  private readonly hop = 256;
  private readonly fft = new FFT(1024);
  private readonly win: Float64Array;
  private readonly frame: Float64Array;
  private readonly ola: Float64Array;
  private readonly inQ = new SampleQueue();
  private readonly outQ: SampleQueue;
  private readonly re = new Float64Array(1024);
  private readonly im = new Float64Array(1024);
  private readonly bins = 513;
  private readonly smooth = new Float64Array(513);
  private readonly gainPrev = new Float64Array(513).fill(1);
  private readonly subMin: Float64Array[];
  private readonly cur = new Float64Array(513).fill(Infinity);
  private frames = 0;
  private sub = 0;
  private readonly V = 32;
  private readonly D = 16;
  private readonly floorG: number;
  private readonly beta: number;

  constructor(
    private readonly strength: number,
    floorDb: number,
  ) {
    this.latency = this.N;
    this.outQ = new SampleQueue(this.hop);
    this.win = new Float64Array(this.N);
    for (let i = 0; i < this.N; i++)
      this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N));
    this.frame = new Float64Array(this.N);
    this.ola = new Float64Array(this.N);
    this.subMin = Array.from({ length: this.D }, () => new Float64Array(513).fill(Infinity));
    this.floorG = Math.pow(10, -Math.abs(floorDb) / 20);
    this.beta = 1 + 2 * strength;
  }

  process(x: Float32Array): Float32Array {
    this.inQ.push(x);
    while (this.inQ.length >= this.hop) {
      const h = this.inQ.shift(this.hop);
      // Fenêtre glissante des N derniers échantillons, décalée d'un pas.
      this.frame.copyWithin(0, this.hop);
      this.frame.set(h, this.N - this.hop);
      this.runFrame();
    }
    return this.outQ.shift(x.length);
  }

  private runFrame() {
    const { N, hop, re, im, win } = this;
    for (let i = 0; i < N; i++) {
      re[i] = (this.frame[i] as number) * (win[i] as number);
      im[i] = 0;
    }
    this.fft.transform(re, im);
    if (this.strength > 0) this.applyGain();
    this.fft.transform(re, im, true);
    for (let i = 0; i < N; i++)
      this.ola[i] = (this.ola[i] as number) + (re[i] as number) * (win[i] as number) * 0.5;
    const out = new Float32Array(hop);
    for (let i = 0; i < hop; i++) out[i] = this.ola[i] as number;
    this.ola.copyWithin(0, hop);
    this.ola.fill(0, N - hop);
    this.outQ.push(out);
  }

  private applyGain() {
    const { re, im, bins, N } = this;
    const power = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      power[k] = p;
      const s = this.frames === 0 ? p : 0.8 * (this.smooth[k] as number) + 0.2 * p;
      this.smooth[k] = s;
      if (s < (this.cur[k] as number)) this.cur[k] = s;
    }
    // Statistiques de minimum : D sous-fenêtres de V trames.
    this.frames++;
    if (++this.sub === this.V) {
      this.sub = 0;
      this.subMin.shift();
      this.subMin.push(this.cur.slice());
      this.cur.fill(Infinity);
    }
    for (let k = 0; k < bins; k++) {
      let noise = this.cur[k] as number;
      for (const m of this.subMin) if ((m[k] as number) < noise) noise = m[k] as number;
      noise = Number.isFinite(noise) ? noise * 2.5 : 0; // compense la sous-estimation du minimum
      // Puissance lissée sur 3 cases : moins de variance (moins d'artefacts « gazouillants ») sans
      // baisser les harmoniques de la voix, qui restent bien au-dessus du bruit.
      const a = power[Math.max(0, k - 1)] as number;
      const c = power[Math.min(bins - 1, k + 1)] as number;
      const p = Math.max((a + 2 * (power[k] as number) + c) / 4, 1e-20);
      let gk = 1 - (this.beta * noise) / p;
      gk = Math.max(this.floorG, gk);
      // Lissage temporel : descente rapide, remontée plus douce.
      const prev = this.gainPrev[k] as number;
      gk = gk < prev ? 0.5 * prev + 0.5 * gk : 0.3 * prev + 0.7 * gk;
      this.gainPrev[k] = gk;
      re[k] = (re[k] as number) * gk;
      im[k] = (im[k] as number) * gk;
      if (k > 0 && k < N / 2) {
        re[N - k] = (re[N - k] as number) * gk;
        im[N - k] = (im[N - k] as number) * gk;
      }
    }
  }
}
