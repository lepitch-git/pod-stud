/**
 * Étage de traitement au fil de l'eau : chaque appel rend autant d'échantillons qu'il en reçoit,
 * retardés de `latency` échantillons. `Pipeline` enchaîne les étages, compense le retard total et
 * rend exactement autant d'échantillons qu'en entrée : un traitement ne change jamais la durée
 * d'une piste (règle de synchronisation du studio).
 */
export interface Stage {
  readonly latency: number;
  process(x: Float32Array): Float32Array;
}

/** File d'échantillons simple (concaténation par blocs). */
export class SampleQueue {
  private buf: Float32Array;
  private start = 0;
  private end = 0;
  constructor(initial = 0, capacity = 1 << 14) {
    this.buf = new Float32Array(Math.max(capacity, initial * 2));
    this.end = initial; // zéros initiaux
  }
  get length() {
    return this.end - this.start;
  }
  push(x: Float32Array) {
    if (this.end + x.length > this.buf.length) {
      const n = this.length;
      const cap = Math.max(this.buf.length, (n + x.length) * 2);
      const next = new Float32Array(cap);
      next.set(this.buf.subarray(this.start, this.end));
      this.buf = next;
      this.start = 0;
      this.end = n;
    }
    this.buf.set(x, this.end);
    this.end += x.length;
  }
  /** Retire et rend n échantillons (copie). */
  shift(n: number): Float32Array {
    const out = this.buf.slice(this.start, this.start + n);
    this.start += n;
    if (this.start === this.end) this.start = this.end = 0;
    return out;
  }
  /** Lecture sans retrait. */
  peek(offset: number, n: number): Float32Array {
    return this.buf.subarray(this.start + offset, this.start + offset + n);
  }
}

/** Étage par blocs : `block` reçoit un segment avec son contexte avant et après. */
export abstract class BlockStage implements Stage {
  readonly latency: number;
  private readonly inQ: SampleQueue;
  private readonly outQ: SampleQueue;
  constructor(
    protected readonly segment: number,
    protected readonly context: number,
  ) {
    this.latency = segment + 2 * context;
    this.inQ = new SampleQueue(context); // contexte avant initial : silence
    this.outQ = new SampleQueue(this.latency);
  }
  /** `win` = contexte avant + segment + contexte après ; rend le segment traité. */
  protected abstract block(win: Float32Array): Float32Array;

  process(x: Float32Array): Float32Array {
    this.inQ.push(x);
    const need = this.segment + 2 * this.context;
    while (this.inQ.length >= need) {
      const win = this.inQ.peek(0, need).slice();
      this.outQ.push(this.block(win));
      this.inQ.shift(this.segment);
    }
    return this.outQ.shift(x.length);
  }
}

export class GainStage implements Stage {
  readonly latency = 0;
  constructor(private g: number) {}
  process(x: Float32Array) {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = (x[i] as number) * this.g;
    return out;
  }
}

export class Pipeline {
  readonly latency: number;
  private skip: number;
  private total = 0;
  private emitted = 0;
  constructor(private readonly stages: Stage[]) {
    this.latency = stages.reduce((a, s) => a + s.latency, 0);
    this.skip = this.latency;
  }

  private run(x: Float32Array) {
    let y = x;
    for (const s of this.stages) y = s.process(y);
    return y;
  }

  private take(y: Float32Array): Float32Array {
    if (this.skip > 0) {
      const d = Math.min(this.skip, y.length);
      this.skip -= d;
      y = y.subarray(d);
    }
    const n = Math.min(y.length, this.total - this.emitted);
    this.emitted += n;
    return y.subarray(0, n);
  }

  /** Rend les échantillons traités disponibles (moins qu'en entrée au début). */
  push(x: Float32Array): Float32Array {
    this.total += x.length;
    return this.take(this.run(x));
  }

  /** Fin du signal : rend le reste, pour un total égal à l'entrée. */
  end(): Float32Array {
    const parts: Float32Array[] = [];
    const block = 4096;
    while (this.emitted < this.total) {
      const before = this.emitted;
      parts.push(this.take(this.run(new Float32Array(block))));
      if (this.emitted === before && this.skip === 0) break;
    }
    const n = parts.reduce((a, p) => a + p.length, 0);
    const out = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /** Traite un signal entier d'un coup (aperçu, tests). */
  static run(stages: Stage[], x: Float32Array, block = 8192): Float32Array {
    const p = new Pipeline(stages);
    const out = new Float32Array(x.length);
    let o = 0;
    for (let i = 0; i < x.length; i += block) {
      const y = p.push(x.subarray(i, i + block));
      out.set(y, o);
      o += y.length;
    }
    out.set(p.end(), o);
    return out;
  }
}
