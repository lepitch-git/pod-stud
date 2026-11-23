/**
 * Silences communs (STU-14) : un passage n'est raccourci que si **toutes** les pistes s'y taisent,
 * et seulement au-delà d'une durée maximale (par exemple 0,7 s). On garde la moitié de cette durée
 * au début et à la fin du silence, et on enlève le milieu avec un fondu enchaîné : le rythme de la
 * conversation reste naturel. La même liste de coupes vaut pour toutes les pistes (synchronisation).
 */
export const ENVELOPE_MS = 10;

/** Enveloppe d'une piste : niveau (dB) par trame de 10 ms. */
export class Envelope {
  readonly db: number[] = [];
  private acc = 0;
  private n = 0;
  private readonly frame: number;
  constructor(fs: number) {
    this.frame = Math.round((fs * ENVELOPE_MS) / 1000);
  }
  push(x: Float32Array) {
    for (let i = 0; i < x.length; i++) {
      const v = x[i] as number;
      this.acc += v * v;
      if (++this.n === this.frame) {
        this.db.push(10 * Math.log10(this.acc / this.frame + 1e-12));
        this.acc = 0;
        this.n = 0;
      }
    }
  }
}

function percentile(v: number[], p: number) {
  if (!v.length) return -120;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] as number;
}

/** Seuil de silence d'une piste : au-dessus de son bruit de fond, bien sous sa voix. */
export function silenceThreshold(db: number[]): number {
  const noise = percentile(db, 0.1);
  const voice = percentile(db, 0.95);
  return Math.min(noise + 10, voice - 25);
}

export interface Cut {
  /** Premier échantillon retiré. */
  start: number;
  /** Premier échantillon gardé après la coupe. */
  end: number;
}

/**
 * Coupes à faire pour ramener chaque silence commun à `maxSec` au plus.
 * Rend des coupes triées, séparées d'au moins `maxSec` (jamais collées).
 */
export function commonSilenceCuts(envelopes: number[][], fs: number, maxSec: number): Cut[] {
  if (!envelopes.length || maxSec <= 0) return [];
  const frame = Math.round((fs * ENVELOPE_MS) / 1000);
  const th = envelopes.map(silenceThreshold);
  const nf = Math.min(...envelopes.map((e) => e.length));
  const keep = Math.max(30, Math.round((maxSec * 1000) / ENVELOPE_MS)); // en trames
  const cuts: Cut[] = [];
  let runStart = -1;
  for (let f = 0; f <= nf; f++) {
    const silent = f < nf && envelopes.every((e, i) => (e[f] as number) < (th[i] as number));
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      const len = f - runStart;
      // Le début et la fin de l'enregistrement ne sont pas touchés (montage de l'intro, de la fin).
      if (len > keep && runStart > 0 && f < nf) {
        const half = Math.floor(keep / 2);
        cuts.push({ start: (runStart + half) * frame, end: (f - (keep - half)) * frame });
      }
      runStart = -1;
    }
  }
  return cuts;
}

export const removedSamples = (cuts: Cut[]) => cuts.reduce((a, c) => a + c.end - c.start, 0);

/**
 * Applique une liste de coupes au fil de l'eau, avec un fondu enchaîné de `fadeMs` à chaque coupe.
 * Sortie : entrée moins les échantillons coupés, exactement.
 */
export class CutApplier {
  private q = new Float32Array(1 << 15);
  private qLen = 0;
  /** Position absolue du premier échantillon de la file. */
  private pos = 0;
  private ci = 0;
  private readonly F: number;
  constructor(
    private readonly cuts: Cut[],
    fs: number,
    fadeMs = 10,
  ) {
    this.F = Math.max(1, Math.round((fs * fadeMs) / 1000));
  }

  private append(x: Float32Array) {
    if (this.qLen + x.length > this.q.length) {
      const n = new Float32Array(Math.max(this.q.length * 2, this.qLen + x.length));
      n.set(this.q.subarray(0, this.qLen));
      this.q = n;
    }
    this.q.set(x, this.qLen);
    this.qLen += x.length;
  }
  private drop(n: number) {
    this.q.copyWithin(0, n, this.qLen);
    this.qLen -= n;
    this.pos += n;
  }

  push(x: Float32Array, last = false): Float32Array {
    this.append(x);
    const parts: Float32Array[] = [];
    for (;;) {
      const c = this.cuts[this.ci];
      const avail = this.pos + this.qLen;
      if (!c) {
        parts.push(this.q.slice(0, this.qLen));
        this.drop(this.qLen);
        break;
      }
      const F = Math.min(this.F, c.start - this.pos, Math.max(0, c.end - c.start));
      const fadeStart = c.start - F;
      // Jusqu'au début du fondu : on rend tel quel.
      const upto = Math.min(avail, fadeStart) - this.pos;
      if (upto > 0) {
        parts.push(this.q.slice(0, upto));
        this.drop(upto);
      }
      if (this.pos < fadeStart) break;
      if (avail < c.end && !last) break;
      // Fondu enchaîné (puissance constante) : les F derniers échantillons avant la coupe se
      // mélangent aux F derniers échantillons coupés, puis on reprend à la fin de la coupe.
      const fade = new Float32Array(F);
      for (let i = 0; i < F; i++) {
        const t = (i + 0.5) / F;
        const a = this.q[i] as number;
        const bi = c.end - F - this.pos + i;
        const b = bi < this.qLen ? (this.q[bi] as number) : 0;
        fade[i] = a * Math.cos((t * Math.PI) / 2) + b * Math.sin((t * Math.PI) / 2);
      }
      parts.push(fade);
      this.drop(Math.min(this.qLen, c.end - this.pos));
      this.ci++;
    }
    const n = parts.reduce((a, p) => a + p.length, 0);
    const res = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      res.set(p, o);
      o += p.length;
    }
    return res;
  }
}
