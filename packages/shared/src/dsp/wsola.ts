/**
 * Changement de vitesse sans changer la hauteur de la voix (STU-15), par WSOLA : on recolle des
 * fenêtres de 40 ms prises dans le signal d'origine à un rythme plus rapide (ou plus lent), en
 * choisissant à ±10 ms près l'endroit qui se raccorde le mieux à ce qui précède. Au fil de l'eau.
 * La sortie dure exactement round(entrée / vitesse) échantillons (voir `end`).
 */
export class TimeStretch {
  private readonly N: number;
  private readonly Hs: number;
  private readonly Ha: number;
  private readonly tol: number;
  private readonly win: Float32Array;
  private buf = new Float32Array(1 << 16);
  private bufLen = 0;
  /** Position absolue du premier échantillon du tampon d'entrée. */
  private base = 0;
  private ola: Float32Array;
  private k = 0;
  private prev = 0;
  private started = false;
  private total = 0;
  private emitted = 0;

  constructor(
    fs: number,
    readonly speed: number,
  ) {
    this.N = Math.round(fs * 0.04);
    this.Hs = this.N >> 1;
    this.Ha = this.Hs * speed;
    this.tol = Math.round(fs * 0.01);
    this.win = Float32Array.from(
      { length: this.N },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.N),
    );
    this.ola = new Float32Array(this.N);
  }

  private at(abs: number) {
    const i = abs - this.base;
    return i >= 0 && i < this.bufLen ? (this.buf[i] as number) : 0;
  }

  /** Meilleur décalage autour de `nominal` pour prolonger naturellement la fenêtre précédente. */
  private search(nominal: number): number {
    if (!this.started) return nominal;
    const ref = this.prev + this.Hs;
    let best = nominal;
    let bestScore = -Infinity;
    const lo = nominal - this.tol;
    const hi = nominal + this.tol;
    // Corrélation sur un échantillon sur 4, positions de 2 en 2 : assez précis, beaucoup plus rapide.
    for (let p = lo; p <= hi; p += 2) {
      let s = 0;
      let e = 0;
      for (let i = 0; i < this.N; i += 4) {
        const a = this.at(p + i);
        s += a * this.at(ref + i);
        e += a * a;
      }
      const score = s / Math.sqrt(e + 1e-9);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** Position nominale de la fenêtre k : une demi-fenêtre avant 0 pour la première (pas de fondu d'entrée). */
  private nominal(k: number) {
    return Math.round(k * this.Ha) - this.Hs;
  }

  private step(): Float32Array {
    const nominal = this.nominal(this.k);
    const p = this.search(nominal);
    for (let i = 0; i < this.N; i++)
      this.ola[i] = (this.ola[i] as number) + this.at(p + i) * (this.win[i] as number);
    const out = this.ola.slice(0, this.Hs);
    this.ola.copyWithin(0, this.Hs);
    this.ola.fill(0, this.N - this.Hs);
    this.prev = p;
    this.started = true;
    this.k++;
    // On peut oublier ce qui précède la prochaine zone de recherche et la référence.
    const keepFrom = Math.min(this.nominal(this.k) - this.tol, this.prev + this.Hs) - 4;
    if (keepFrom > this.base) {
      const n = Math.min(this.bufLen, keepFrom - this.base);
      this.buf.copyWithin(0, n, this.bufLen);
      this.bufLen -= n;
      this.base += n;
    }
    return out;
  }

  private collect(parts: Float32Array[]) {
    const want = Math.round(this.total / this.speed);
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Float32Array(Math.max(0, Math.min(n, want - this.emitted)));
    let o = 0;
    for (const p of parts) {
      const m = Math.min(p.length, out.length - o);
      out.set(p.subarray(0, m), o);
      o += m;
    }
    this.emitted += out.length;
    return out;
  }

  push(x: Float32Array): Float32Array {
    if (this.bufLen + x.length > this.buf.length) {
      const n = new Float32Array(Math.max(this.buf.length * 2, this.bufLen + x.length));
      n.set(this.buf.subarray(0, this.bufLen));
      this.buf = n;
    }
    this.buf.set(x, this.bufLen);
    this.bufLen += x.length;
    this.total += x.length;
    if (this.speed === 1) {
      const out = this.buf.slice(0, this.bufLen);
      this.base += this.bufLen;
      this.bufLen = 0;
      this.emitted += out.length;
      return out;
    }
    const parts: Float32Array[] = [];
    const end = this.base + this.bufLen;
    while (this.nominal(this.k) + this.tol + this.N <= end && this.prev + this.Hs + this.N <= end) {
      const s = this.step();
      // Le premier bloc correspond à la demi-fenêtre avant le début : on le jette.
      if (this.k > 1) parts.push(s);
    }
    return this.collect(parts);
  }

  /** Fin du signal : rend la suite, pour un total de round(entrée / vitesse) échantillons. */
  end(): Float32Array {
    const want = Math.round(this.total / this.speed);
    const parts: Float32Array[] = [];
    let got = this.emitted;
    while (this.speed !== 1 && got < want) {
      const s = this.step();
      if (this.k === 1) continue;
      parts.push(s);
      got += s.length;
    }
    const tail = this.collect(parts);
    if (this.emitted < want) {
      const pad = new Float32Array(want - this.emitted);
      this.emitted = want;
      const r = new Float32Array(tail.length + pad.length);
      r.set(tail);
      return r;
    }
    return tail;
  }
}
