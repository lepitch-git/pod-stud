import { Biquad } from "./biquad";
import { BlockStage } from "./stage";

/**
 * Atténuation des respirations (expérimental) : repère les passages bruités et faibles, entre le
 * bruit de fond et la voix, durant 120 à 900 ms, dont l'énergie est surtout dans les aigus (souffle),
 * et les baisse de 6 ou 12 dB avec des fondus de 10 ms. Jamais supprimées : le phrasé reste naturel
 * et la durée ne change pas.
 */
export class BreathReducer extends BlockStage {
  private readonly F: number;
  private readonly fs: number;
  private readonly gain: number;
  detected = 0;
  constructor(fs: number, reductionDb: number) {
    super(Math.round(fs * 0.5), Math.round(fs * 1));
    this.fs = fs;
    this.F = Math.round(fs / 100);
    this.gain = Math.pow(10, -reductionDb / 20);
  }

  protected block(win: Float32Array): Float32Array {
    const { F, fs } = this;
    const nf = Math.floor(win.length / F);
    const full = win.slice();
    Biquad.of("highpass", fs, 100, 0.7).process(full);
    const hi = full.slice();
    Biquad.of("highpass", fs, 1500, 0.7).process(hi);
    Biquad.of("highpass", fs, 1500, 0.7).process(hi);
    const db = new Float64Array(nf);
    const ratio = new Float64Array(nf);
    for (let f = 0; f < nf; f++) {
      let e = 0;
      let h = 0;
      for (let i = f * F; i < (f + 1) * F; i++) {
        e += (full[i] as number) ** 2;
        h += (hi[i] as number) ** 2;
      }
      db[f] = 10 * Math.log10(e / F + 1e-12);
      ratio[f] = h / (e + 1e-12);
    }
    const sorted = Array.from(db).sort((a, b) => a - b);
    const noise = sorted[Math.floor(nf * 0.1)] ?? -120;
    const speech = sorted[Math.floor(nf * 0.9)] ?? -120;
    const out = win.slice(this.context, this.context + this.segment);
    if (speech - noise < 20) return out; // trop peu de contraste pour décider
    const cand = new Uint8Array(nf);
    for (let f = 0; f < nf; f++)
      cand[f] = db[f]! > noise + 6 && db[f]! < speech - 14 && ratio[f]! > 0.45 ? 1 : 0;
    const g = new Float32Array(nf).fill(1);
    for (let f = 0; f < nf; ) {
      if (!cand[f]) {
        f++;
        continue;
      }
      let e = f;
      while (e < nf && cand[e]) e++;
      const dur = (e - f) * 10;
      if (dur >= 120 && dur <= 900) {
        for (let k = f; k < e; k++) g[k] = this.gain;
        this.detected++;
      }
      f = e;
    }
    // Gain par échantillon, fondus de 10 ms (une trame) entre les niveaux.
    for (let i = 0; i < out.length; i++) {
      const pos = (this.context + i) / F - 0.5;
      const f = Math.max(0, Math.min(nf - 1, Math.floor(pos)));
      const n = Math.min(nf - 1, f + 1);
      const t = Math.max(0, Math.min(1, pos - f));
      out[i] = (out[i] as number) * ((g[f] as number) * (1 - t) + (g[n] as number) * t);
    }
    return out;
  }
}
