import { Biquad } from "./biquad";
import { TruePeakMeter } from "./loudness";
import type { Stage } from "./stage";

const coef = (ms: number, fs: number) => Math.exp(-1 / ((ms / 1000) * fs));

/**
 * Compresseur doux (détection RMS sur 5 ms, coude progressif). Le signal arrive déjà ramené vers
 * -20 LUFS, donc le seuil est un niveau absolu cohérent d'une voix à l'autre.
 */
export class Compressor implements Stage {
  readonly latency = 0;
  private env = 0;
  private gr = 0;
  private readonly aEnv: number;
  private readonly aAtk: number;
  private readonly aRel: number;
  constructor(
    fs: number,
    private readonly thresholdDb: number,
    private readonly ratio: number,
    private readonly kneeDb = 6,
    attackMs = 10,
    releaseMs = 150,
  ) {
    this.aEnv = coef(5, fs);
    this.aAtk = coef(attackMs, fs);
    this.aRel = coef(releaseMs, fs);
  }

  private reduction(levelDb: number): number {
    const over = levelDb - this.thresholdDb;
    const k = this.kneeDb / 2;
    const slope = 1 - 1 / this.ratio;
    if (over <= -k) return 0;
    if (over >= k) return slope * over;
    return (slope * (over + k) ** 2) / (2 * this.kneeDb);
  }

  process(x: Float32Array): Float32Array {
    const out = new Float32Array(x.length);
    if (this.ratio <= 1) {
      out.set(x);
      return out;
    }
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      this.env = this.aEnv * this.env + (1 - this.aEnv) * v * v;
      const lvl = 10 * Math.log10(this.env + 1e-12);
      const target = this.reduction(lvl);
      const a = target > this.gr ? this.aAtk : this.aRel;
      this.gr = a * this.gr + (1 - a) * target;
      out[i] = v * Math.pow(10, -this.gr / 20);
    }
    return out;
  }
}

/**
 * Dé-esseur : la bande des sifflantes (au-dessus de 5 kHz) est atténuée seulement quand elle
 * dépasse le seuil ; sans dépassement, le signal ressort identique.
 */
export class DeEsser implements Stage {
  readonly latency = 0;
  private readonly hp1: Biquad;
  private readonly hp2: Biquad;
  private env = 0;
  private g = 1;
  private readonly aAtk: number;
  private readonly aRel: number;
  private readonly aGain: number;
  private readonly thr: number;
  constructor(
    fs: number,
    thresholdDb: number,
    private readonly maxReductionDb = 10,
  ) {
    this.hp1 = Biquad.of("highpass", fs, 5000, 0.7);
    this.hp2 = Biquad.of("highpass", fs, 5000, 0.7);
    this.aAtk = coef(1, fs);
    this.aRel = coef(40, fs);
    this.aGain = coef(2, fs);
    this.thr = Math.pow(10, thresholdDb / 20);
  }
  process(x: Float32Array): Float32Array {
    const out = new Float32Array(x.length);
    const minG = Math.pow(10, -this.maxReductionDb / 20);
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      const band = this.hp2.sample(this.hp1.sample(v));
      const a = Math.abs(band);
      this.env =
        a > this.env
          ? this.aAtk * this.env + (1 - this.aAtk) * a
          : this.aRel * this.env + (1 - this.aRel) * a;
      // Au-dessus du seuil, rapport 4:1 sur la bande.
      const target = this.env > this.thr ? Math.max(minG, Math.pow(this.thr / this.env, 0.75)) : 1;
      this.g = this.aGain * this.g + (1 - this.aGain) * target;
      out[i] = v - (1 - this.g) * band;
    }
    return out;
  }
}

/**
 * Limiteur à anticipation (5 ms) sur le pic vrai : le gain descend avant le pic, la sortie ne
 * dépasse pas le plafond (par exemple -1 dBTP). Durée inchangée (retard compensé par le Pipeline).
 */
export class Limiter implements Stage {
  readonly latency: number;
  private readonly L: number;
  private readonly delay: Float32Array;
  private dpos = 0;
  private readonly dq: number[] = [];
  private head = 0;
  private t = 0;
  private readonly avgBuf: Float64Array;
  private apos = 0;
  private sum = 0;
  private g = 1;
  private readonly rel: number;
  private readonly tp = new TruePeakMeter();
  private readonly ceil: number;
  constructor(fs: number, ceilingDb = -1, lookaheadMs = 5, releaseMs = 80) {
    this.L = Math.max(8, Math.round((lookaheadMs / 1000) * fs));
    this.latency = this.L + 4;
    this.delay = new Float32Array(this.latency);
    this.avgBuf = new Float64Array(this.L + 1).fill(1);
    this.sum = this.L + 1;
    this.rel = 1 - coef(releaseMs, fs);
    // Petite marge sous le plafond pour l'estimation du pic entre échantillons.
    this.ceil = Math.pow(10, (ceilingDb - 0.2) / 20);
  }

  process(x: Float32Array): Float32Array {
    const out = new Float32Array(x.length);
    const W = this.L + 8;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      const peak = this.tp.sample(v);
      const need = peak > this.ceil ? this.ceil / peak : 1;
      // Minimum glissant des gains requis sur les W derniers échantillons (file monotone).
      while (
        this.dq.length > this.head &&
        this.reqOf(this.dq[this.dq.length - 1] as number) >= need
      )
        this.dq.pop();
      this.dq.push(this.t);
      this.setReq(this.t, need);
      while ((this.dq[this.head] as number) <= this.t - W) this.head++;
      if (this.head > 1024) {
        this.dq.splice(0, this.head);
        this.head = 0;
      }
      const m = this.reqOf(this.dq[this.head] as number);
      // Moyenne glissante du minimum sur L+1 échantillons : rampe d'attaque sans dépassement.
      this.sum += m - (this.avgBuf[this.apos] as number);
      this.avgBuf[this.apos] = m;
      this.apos = (this.apos + 1) % this.avgBuf.length;
      const avg = this.sum / this.avgBuf.length;
      this.g = avg < this.g ? avg : this.g + (avg - this.g) * this.rel;
      const d = this.delay[this.dpos] as number;
      this.delay[this.dpos] = v;
      this.dpos = (this.dpos + 1) % this.delay.length;
      out[i] = d * this.g;
      this.t++;
    }
    return out;
  }

  // Gains requis gardés dans un tampon circulaire indexé par le temps.
  private ring = new Float64Array(4096);
  private setReq(t: number, v: number) {
    this.ring[t & 4095] = v;
  }
  private reqOf(t: number) {
    return this.ring[t & 4095] as number;
  }
}
