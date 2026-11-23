import { describe, expect, it } from "vitest";
import { commonSilenceCuts, CutApplier, Envelope, removedSamples, TimeStretch } from "./index";

const FS = 48000;
const tone = (f: number, sec: number, amp = 0.3) =>
  Float32Array.from(
    { length: Math.round(sec * FS) },
    (_, i) => amp * Math.sin((2 * Math.PI * f * i) / FS),
  );

function concat(...xs: Float32Array[]) {
  const out = new Float32Array(xs.reduce((a, x) => a + x.length, 0));
  let o = 0;
  for (const x of xs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
const quiet = (sec: number, seed = 1) => {
  let s = seed;
  return Float32Array.from({ length: Math.round(sec * FS) }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s / 4294967296) * 2 - 1) * 0.0005;
  });
};
const env = (x: Float32Array) => {
  const e = new Envelope(FS);
  e.push(x);
  return e.db;
};
function streamed(f: (x: Float32Array) => Float32Array, x: Float32Array, block = 5000) {
  const parts: Float32Array[] = [];
  for (let i = 0; i < x.length; i += block) parts.push(f(x.subarray(i, i + block)));
  return parts;
}

describe("silences communs", () => {
  // A parle, silence commun de 3 s, B parle, A se tait 2 s pendant que B parle (pas commun).
  const a = concat(tone(200, 2), quiet(3), quiet(2, 3), tone(220, 2));
  const b = concat(quiet(2, 5), quiet(3, 6), tone(300, 2), tone(330, 2));

  it("ne coupe que le silence commun à toutes les pistes, au-delà de la durée maximale", () => {
    const cuts = commonSilenceCuts([env(a), env(b)], FS, 0.7);
    expect(cuts).toHaveLength(1);
    const removed = removedSamples(cuts) / FS;
    expect(removed).toBeGreaterThan(2.1);
    expect(removed).toBeLessThan(2.4);
    expect(cuts[0]!.start).toBeGreaterThan(2 * FS);
    expect(cuts[0]!.end).toBeLessThan(5 * FS);
  });

  it("désactivé ou silences courts : aucune coupe", () => {
    expect(commonSilenceCuts([env(a), env(b)], FS, 0)).toHaveLength(0);
    expect(commonSilenceCuts([env(a), env(b)], FS, 4)).toHaveLength(0);
  });

  it("au fil de l'eau, la sortie dure exactement l'entrée moins les coupes", () => {
    const cuts = commonSilenceCuts([env(a), env(b)], FS, 0.7);
    const ap = new CutApplier(cuts, FS);
    const parts = streamed((x) => ap.push(x), a);
    parts.push(ap.push(new Float32Array(0), true));
    const n = parts.reduce((s, p) => s + p.length, 0);
    expect(n).toBe(a.length - removedSamples(cuts));
    // Les mêmes coupes appliquées à l'autre piste donnent la même durée : tout reste synchrone.
    const bp = new CutApplier(cuts, FS);
    const m =
      streamed((x) => bp.push(x), b).reduce((s, p) => s + p.length, 0) +
      bp.push(new Float32Array(0), true).length;
    expect(m).toBe(n);
  });
});

describe("vitesse sans changer la hauteur", () => {
  for (const speed of [0.8, 1, 1.1, 1.25]) {
    it(`×${speed} : durée divisée par la vitesse, même fréquence`, () => {
      const x = tone(220, 4);
      const ts = new TimeStretch(FS, speed);
      const parts = streamed((v) => ts.push(v), x);
      parts.push(ts.end());
      const y = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
      let o = 0;
      for (const p of parts) {
        y.set(p, o);
        o += p.length;
      }
      expect(y.length).toBe(Math.round(x.length / speed));
      // Fréquence : passages par zéro montants au milieu du signal.
      let z = 0;
      const a0 = Math.round(y.length * 0.25);
      const a1 = Math.round(y.length * 0.75);
      for (let i = a0 + 1; i < a1; i++) if (y[i - 1]! < 0 && y[i]! >= 0) z++;
      const f = z / ((a1 - a0) / FS);
      expect(f).toBeGreaterThan(215);
      expect(f).toBeLessThan(225);
      // Niveau conservé (pas de trou ni de doublement).
      let e = 0;
      for (let i = a0; i < a1; i++) e += y[i]! ** 2;
      const rms = Math.sqrt(e / (a1 - a0));
      expect(rms).toBeGreaterThan(0.3 / Math.SQRT2 - 0.03);
      expect(rms).toBeLessThan(0.3 / Math.SQRT2 + 0.03);
    });
  }
});

describe("réglages du mixage", () => {
  it("ramène les valeurs dans les bornes", async () => {
    const { normalizeMix } = await import("./track");
    expect(normalizeMix({ silenceMax: 0.7, speed: 1.1, target: -23 })).toEqual({
      silenceMax: 0.7,
      speed: 1.1,
      target: -23,
    });
    expect(normalizeMix({ silenceMax: 3, speed: 2, target: -10 as never })).toEqual({
      silenceMax: 0,
      speed: 1,
      target: -16,
    });
  });
});
