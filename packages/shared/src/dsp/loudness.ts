import { Biquad, type BiquadCoefs } from "./biquad";

/**
 * Mesure du volume perçu selon l'UIT-R BS.1770-4 / EBU R128 (LUFS), au fil de l'eau, et du pic
 * vrai (dBTP) par suréchantillonnage ×4. Coefficients du filtre K calculés pour toute fréquence
 * d'échantillonnage (méthode de libebur128).
 */
function kWeighting(fs: number): [BiquadCoefs, BiquadCoefs] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

export class LoudnessMeter {
  private readonly k1: Biquad;
  private readonly k2: Biquad;
  private readonly sub: number;
  private acc = 0;
  private n = 0;
  private readonly recent: number[] = [];
  /** Puissance moyenne de chaque bloc de 400 ms (pas de 100 ms). */
  readonly blocks: number[] = [];
  private tmp = new Float32Array(0);

  constructor(fs: number) {
    const [a, b] = kWeighting(fs);
    this.k1 = new Biquad(a);
    this.k2 = new Biquad(b);
    this.sub = Math.round(fs / 10);
  }

  push(x: Float32Array) {
    if (this.tmp.length < x.length) this.tmp = new Float32Array(x.length);
    const y = this.tmp.subarray(0, x.length);
    this.k1.process(x, y);
    this.k2.process(y);
    for (let i = 0; i < y.length; i++) {
      const v = y[i] as number;
      this.acc += v * v;
      if (++this.n === this.sub) {
        this.recent.push(this.acc / this.sub);
        if (this.recent.length > 4) this.recent.shift();
        if (this.recent.length === 4)
          this.blocks.push(
            (this.recent[0]! + this.recent[1]! + this.recent[2]! + this.recent[3]!) / 4,
          );
        this.acc = 0;
        this.n = 0;
      }
    }
  }

  /** Volume intégré (LUFS), avec les portes absolue (-70) et relative (-10 LU). -Infinity si silence. */
  integrated(): number {
    const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
    const abs = this.blocks.filter((p) => lufs(p) > -70);
    if (!abs.length) return -Infinity;
    const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((p) => lufs(p) > rel);
    return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
}

/** Interpolateur ×4 (sinus cardinal fenêtré, 32 coefficients) pour estimer les pics entre échantillons. */
const OS = 4;
const TAPS = 8;
const PHASES: Float64Array[] = Array.from({ length: OS }, (_, p) => {
  // Valeur entre les échantillons 3 et 4 de l'historique (du plus ancien au plus récent), à p/4.
  const h = new Float64Array(TAPS);
  for (let t = 0; t < TAPS; t++) {
    const d = TAPS / 2 - 1 + p / OS - t;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
    h[t] = sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / (TAPS / 2)));
  }
  const s = h.reduce((a, b) => a + b, 0);
  return h.map((v) => v / s);
});

export class TruePeakMeter {
  private hist = new Float64Array(TAPS);
  private pos = 0;
  peak = 0;

  /** Pic vrai du dernier échantillon poussé (avec les points intermédiaires). */
  sample(v: number): number {
    this.hist[this.pos] = v;
    this.pos = (this.pos + 1) % TAPS;
    let m = Math.abs(v);
    for (let p = 1; p < OS; p++) {
      const h = PHASES[p] as Float64Array;
      let s = 0;
      for (let t = 0; t < TAPS; t++)
        s += (h[t] as number) * (this.hist[(this.pos + t) % TAPS] as number);
      const a = Math.abs(s);
      if (a > m) m = a;
    }
    if (m > this.peak) this.peak = m;
    return m;
  }

  push(x: Float32Array) {
    for (let i = 0; i < x.length; i++) this.sample(x[i] as number);
  }

  get dbtp() {
    return 20 * Math.log10(this.peak || 1e-12);
  }
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(g, 1e-12));
