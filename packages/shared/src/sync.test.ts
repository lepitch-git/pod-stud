import { describe, expect, it } from "vitest";
import { estimateClock, fitClock, planTrack, StreamResampler, type SyncPoint } from "./sync";

describe("horloge commune", () => {
  it("garde la mesure au plus court aller-retour", () => {
    const e = estimateClock([
      { t0: 1000, server: 6000, t1: 1200 },
      { t0: 2000, server: 7015, t1: 2030 },
      { t0: 3000, server: 8100, t1: 3100 },
    ]);
    expect(e.rttMs).toBe(30);
    expect(e.offsetMs).toBe(5000);
  });
});

/** Repères simulés : carte son à 48 kHz + `ppm`, premier échantillon à `start`, bruit de mesure. */
function points(start: number, ppm: number, seconds: number, jitterMs: number): SyncPoint[] {
  const rate = 48000 * (1 + ppm / 1e6);
  const out: SyncPoint[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let s = 0; s <= seconds; s += 2) {
    const frame = Math.round(s * rate);
    out.push({ frame, serverMs: start + (frame / rate) * 1000 + rnd() * jitterMs });
  }
  return out;
}

describe("dérive de la carte son", () => {
  it("retrouve la fréquence réelle et l'heure de départ sur 10 minutes", () => {
    const start = 1_795_000_000_000;
    const fit = fitClock(points(start, 120, 600, 3), 48000);
    expect(Math.abs(fit.rate - 48000 * 1.00012)).toBeLessThan(0.05); // < 1 ppm
    expect(Math.abs(fit.startMs - start)).toBeLessThan(1);
    // Erreur de position en fin d'enregistrement : bien sous les 10 ms visées.
    const endErr = (600 * 48000 * 1.00012) / fit.rate - 600;
    expect(Math.abs(endErr * 1000)).toBeLessThan(2);
  });
  it("garde la fréquence nominale sur un enregistrement trop court", () => {
    const fit = fitClock(points(5000, 300, 10, 0), 48000);
    expect(fit.rate).toBe(48000);
    expect(Math.abs(fit.startMs - 5000)).toBeLessThan(20);
  });
});

describe("plan d'alignement", () => {
  it("ajoute du silence à une piste partie en retard", () => {
    const p = planTrack({ startMs: 1020, rate: 48000, residualMs: 0 }, 1000);
    expect(p).toEqual({ padFrames: 960, skipSourceFrames: 0, step: 1 });
  });
  it("saute le début d'une piste partie en avance", () => {
    const p = planTrack({ startMs: 990, rate: 48000, residualMs: 0 }, 1000);
    expect(p.padFrames).toBe(0);
    expect(p.skipSourceFrames).toBeCloseTo(480, 6);
  });
});

describe("rééchantillonnage", () => {
  const ppm = 150;
  const srcRate = 48000 * (1 + ppm / 1e6);
  const freq = 1000;
  const seconds = 2;
  const src = new Float32Array(Math.round(srcRate * seconds));
  for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * freq * i) / srcRate);

  it("corrige la dérive : le signal produit est celui attendu à 48 kHz", () => {
    const r = new StreamResampler(srcRate / 48000);
    const out = r.push(src, true);
    expect(Math.abs(out.length - 48000 * seconds)).toBeLessThanOrEqual(2);
    let maxErr = 0;
    for (let k = 10; k < out.length - 10; k++) {
      const ideal = Math.sin((2 * Math.PI * freq * k) / 48000);
      maxErr = Math.max(maxErr, Math.abs((out[k] as number) - ideal));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });

  it("donne le même résultat morceau par morceau qu'en une fois", () => {
    const whole = new StreamResampler(srcRate / 48000).push(src, true);
    const r = new StreamResampler(srcRate / 48000);
    const parts: Float32Array[] = [];
    for (let o = 0; o < src.length; o += 4801) parts.push(r.push(src.subarray(o, o + 4801)));
    parts.push(r.push(new Float32Array(0), true));
    const joined = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      joined.set(p, o);
      o += p.length;
    }
    expect(joined.length).toBe(whole.length);
    let maxDiff = 0;
    for (let i = 0; i < whole.length; i++)
      maxDiff = Math.max(maxDiff, Math.abs((whole[i] as number) - (joined[i] as number)));
    expect(maxDiff).toBeLessThan(1e-6);
  });
});
