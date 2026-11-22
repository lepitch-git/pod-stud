/** Filtres biquadratiques (formules RBJ), utilisables au fil de l'eau : l'état est conservé d'un bloc à l'autre. */

export interface BiquadCoefs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export type BiquadType = "highpass" | "lowpass" | "peaking" | "highshelf" | "lowshelf" | "bandpass";

export function biquadCoefs(
  type: BiquadType,
  fs: number,
  f0: number,
  q = Math.SQRT1_2,
  gainDb = 0,
): BiquadCoefs {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * Math.min(f0, fs * 0.49)) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (type) {
    case "highpass":
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "lowpass":
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "bandpass":
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cos;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos;
      a2 = 1 - alpha / A;
      break;
    case "highshelf":
    case "lowshelf": {
      const s = type === "highshelf" ? 1 : -1;
      const sq = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + s * (A - 1) * cos + sq);
      b1 = -2 * s * A * (A - 1 + s * (A + 1) * cos);
      b2 = A * (A + 1 + s * (A - 1) * cos - sq);
      a0 = A + 1 - s * (A - 1) * cos + sq;
      a1 = 2 * s * (A - 1 - s * (A + 1) * cos);
      a2 = A + 1 - s * (A - 1) * cos - sq;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private c: BiquadCoefs) {}

  static of(type: BiquadType, fs: number, f0: number, q?: number, gainDb?: number) {
    return new Biquad(biquadCoefs(type, fs, f0, q, gainDb));
  }

  /** Filtre `x` ; écrit dans `out` (par défaut sur place). */
  process(x: Float32Array, out: Float32Array = x): Float32Array {
    const { b0, b1, b2, a1, a2 } = this.c;
    let z1 = this.z1;
    let z2 = this.z2;
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      const y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      out[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
    return out;
  }

  sample(v: number): number {
    const { b0, b1, b2, a1, a2 } = this.c;
    const y = b0 * v + this.z1;
    this.z1 = b1 * v - a1 * y + this.z2;
    this.z2 = b2 * v - a2 * y;
    return y;
  }

  /** Gain (dB) du filtre à la fréquence f, pour les tests et l'affichage. */
  static responseDb(c: BiquadCoefs, fs: number, f: number): number {
    const w = (2 * Math.PI * f) / fs;
    const re = (a: number, b: number, cc: number) => a + b * Math.cos(w) + cc * Math.cos(2 * w);
    const im = (b: number, cc: number) => -(b * Math.sin(w) + cc * Math.sin(2 * w));
    const nr = re(c.b0, c.b1, c.b2);
    const ni = im(c.b1, c.b2);
    const dr = re(1, c.a1, c.a2);
    const di = im(c.a1, c.a2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
}
