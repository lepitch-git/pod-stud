import { Biquad } from "./biquad";
import { BlockStage } from "./stage";

export type Intensity = "off" | "leger" | "moyen" | "fort";

/**
 * Anti-bruits de bouche : repère les clics très courts (claquements de langue, salive) — des
 * pointes d'aigus de moins de 3 ms nettement au-dessus de leur voisinage — et les répare en ne
 * gardant que les graves à cet endroit, avec de courts fondus. Aucun échantillon n'est retiré :
 * la durée ne change pas. Placé en tout début de chaîne, avant l'égalisation et la compression
 * qui rendraient ces bruits plus présents.
 */
export class Declicker extends BlockStage {
  private readonly frame: number;
  private readonly ratio: number;
  /** Nombre de clics réparés (pour l'affichage et les tests). */
  repaired = 0;
  private readonly fs: number;

  constructor(fs: number, intensity: Exclude<Intensity, "off">) {
    super(Math.round(fs * 0.1), Math.round(fs * 0.025));
    this.fs = fs;
    this.frame = Math.max(8, Math.round(fs / 1000));
    this.ratio = { leger: 8, moyen: 4, fort: 2.5 }[intensity];
  }

  protected block(win: Float32Array): Float32Array {
    this.lp = null;
    const fs = this.fs;
    const F = this.frame;
    const hp = win.slice();
    const h1 = Biquad.of("highpass", fs, 3000, 0.7);
    const h2 = Biquad.of("highpass", fs, 3000, 0.7);
    h1.process(hp);
    h2.process(hp);
    const nf = Math.floor(win.length / F);
    const e = new Float64Array(nf);
    for (let f = 0; f < nf; f++) {
      let s = 0;
      for (let i = f * F; i < (f + 1) * F; i++) s += (hp[i] as number) ** 2;
      e[f] = s / F;
    }
    const out = win.slice(this.context, this.context + this.segment);
    const f0 = Math.floor(this.context / F);
    const f1 = Math.floor((this.context + this.segment) / F);
    const R = 20; // voisinage de ±20 ms
    for (let f = f0; f < f1; f++) {
      const ef = e[f] as number;
      if (ef < 1e-9) continue;
      // Référence : la plus forte trame du voisinage (hors trame examinée et ses voisines). Le
      // maximum plutôt que la médiane : les impulsions régulières de la voix (une par période de
      // la fondamentale) ne doivent pas passer pour des clics.
      let med = 0;
      for (let g = Math.max(0, f - R); g <= Math.min(nf - 1, f + R); g++)
        if (Math.abs(g - f) > 3 && (e[g] as number) > med) med = e[g] as number;
      if (ef <= this.ratio * med + 1e-9) continue;
      // Un clic est court : les trames voisines ne dépassent pas, ou au plus 2 de suite.
      let len = 1;
      while (f + len < nf && (e[f + len] as number) > this.ratio * med && len <= 3) len++;
      if (len > 3) {
        f += len;
        continue;
      }
      this.repair(win, out, f * F - this.context, (f + len) * F - this.context);
      this.repaired++;
      f += len;
    }
    return out;
  }

  /** Remplace [a, b[ (indices du segment) par sa version sans aigus, avec fondus de 0,5 ms. */
  private repair(win: Float32Array, out: Float32Array, a: number, b: number) {
    if (!this.lp) {
      // Passe-bas aller-retour (sans déphasage) à 2 kHz, calculé une fois par bloc.
      const lp = win.slice();
      Biquad.of("lowpass", this.fs, 2000, 0.7).process(lp);
      lp.reverse();
      Biquad.of("lowpass", this.fs, 2000, 0.7).process(lp);
      lp.reverse();
      this.lp = lp;
    }
    const pad = Math.max(1, Math.round(this.fs * 0.0005));
    const s = a - 2 * pad;
    const e = b + 2 * pad;
    for (let i = Math.max(0, s); i < Math.min(out.length, e); i++) {
      const w = Math.max(0, Math.min(1, (i - s) / pad, (e - 1 - i) / pad));
      out[i] = (1 - w) * (out[i] as number) + w * (this.lp[this.context + i] as number);
    }
  }
  private lp: Float32Array | null = null;
}
