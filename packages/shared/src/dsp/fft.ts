/** FFT complexe en base 2, sur place (tableaux de parties réelles et imaginaires). */
export class FFT {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  constructor(readonly n: number) {
    if (n & (n - 1)) throw new Error("taille de FFT non puissance de 2");
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  /** Transformée directe (inverse = true : transformée inverse, normalisée). */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i] as number;
      if (j > i) {
        let t = re[i] as number;
        re[i] = re[j] as number;
        re[j] = t;
        t = im[i] as number;
        im[i] = im[j] as number;
        im[j] = t;
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step] as number;
          const wi = sgn * (this.sin[k * step] as number);
          const a = i + k;
          const b = a + half;
          const xr = (re[b] as number) * wr - (im[b] as number) * wi;
          const xi = (re[b] as number) * wi + (im[b] as number) * wr;
          re[b] = (re[a] as number) - xr;
          im[b] = (im[a] as number) - xi;
          re[a] = (re[a] as number) + xr;
          im[a] = (im[a] as number) + xi;
        }
      }
    }
    if (inverse)
      for (let i = 0; i < n; i++) {
        re[i] = (re[i] as number) / n;
        im[i] = (im[i] as number) / n;
      }
  }
}
