import { describe, expect, it } from "vitest";
import {
  evaluateCamera,
  evaluateEcho,
  evaluateMic,
  evaluateNetwork,
  frameStats,
  summarizeMic,
  toDb,
  worstStatus,
} from "./equipment";

const status = (checks: { id: string; status: string }[], id: string) =>
  checks.find((c) => c.id === id)?.status;

describe("mesures audio", () => {
  it("convertit une amplitude en dBFS", () => {
    expect(toDb(1)).toBe(0);
    expect(Math.round(toDb(0.5))).toBe(-6);
    expect(toDb(0)).toBe(-120);
  });

  it("mesure le niveau, la crête et la saturation d'un bloc", () => {
    const sine = Array.from(
      { length: 4800 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000),
    );
    const s = frameStats(sine);
    expect(Math.round(s.rmsDb)).toBe(-9); // 0,5 / √2
    expect(Math.round(s.peakDb)).toBe(-6);
    expect(s.clipped).toBe(0);
    expect(frameStats([1, -1, 0.2]).clipped).toBe(2);
  });

  it("résume les phases silence et lecture", () => {
    const m = summarizeMic(
      [
        { rmsDb: -60, peakDb: -50, clipped: 0 },
        { rmsDb: -58, peakDb: -48, clipped: 0 },
        { rmsDb: -62, peakDb: -50, clipped: 0 },
      ],
      [
        { rmsDb: -25, peakDb: -8, clipped: 0 },
        { rmsDb: -22, peakDb: -6, clipped: 1 },
      ],
    );
    expect(m.noiseFloorDb).toBe(-60);
    expect(m.peakDb).toBe(-6);
    expect(m.clipped).toBe(1);
  });
});

describe("evaluateMic (SAL-05)", () => {
  const good = { noiseFloorDb: -65, speechDb: -22, peakDb: -8, clipped: 0 };
  it("vert pour une voix bien réglée dans une pièce calme", () => {
    expect(worstStatus(evaluateMic(good).map((c) => c.status))).toBe("ok");
  });
  it("rouge quand aucune voix n'est entendue", () => {
    expect(status(evaluateMic({ ...good, speechDb: -62 }), "voice")).toBe("ko");
  });
  it("rouge si la voix est trop faible, orange si un peu faible", () => {
    expect(status(evaluateMic({ ...good, speechDb: -45 }), "voice")).toBe("ko");
    expect(status(evaluateMic({ ...good, speechDb: -36 }), "voice")).toBe("warn");
  });
  it("rouge en cas de saturation, avec un conseil", () => {
    const c = evaluateMic({ ...good, clipped: 12, peakDb: 0 }).find((x) => x.id === "clipping");
    expect(c?.status).toBe("ko");
    expect(c?.advice).toBeTruthy();
  });
  it("signale le bruit de fond", () => {
    expect(status(evaluateMic({ ...good, noiseFloorDb: -45 }), "noise")).toBe("warn");
    expect(status(evaluateMic({ ...good, noiseFloorDb: -30, speechDb: -15 }), "noise")).toBe("ko");
  });
});

describe("evaluateEcho (SAL-06)", () => {
  it("rouge si écho sans casque", () =>
    expect(evaluateEcho({ headphones: false, echoDetected: true }).status).toBe("ko"));
  it("orange sans casque même sans écho", () =>
    expect(evaluateEcho({ headphones: false, echoDetected: false }).status).toBe("warn"));
  it("vert avec casque et sans écho", () =>
    expect(evaluateEcho({ headphones: true, echoDetected: false }).status).toBe("ok"));
});

describe("evaluateCamera (SAL-07)", () => {
  it("vert en 1080p bien éclairé", () => {
    expect(
      worstStatus(
        evaluateCamera({ width: 1920, height: 1080, brightness: 120 }).map((c) => c.status),
      ),
    ).toBe("ok");
  });
  it("signale une image trop sombre", () => {
    expect(status(evaluateCamera({ width: 1280, height: 720, brightness: 30 }), "light")).toBe(
      "warn",
    );
  });
  it("signale une définition sous 720p", () => {
    expect(status(evaluateCamera({ width: 640, height: 480, brightness: 120 }), "resolution")).toBe(
      "warn",
    );
  });
});

describe("evaluateNetwork (SAL-08)", () => {
  it("vert avec un bon débit et une bonne latence", () => {
    expect(worstStatus(evaluateNetwork({ rttMs: 40, uploadMbps: 20 }).map((c) => c.status))).toBe(
      "ok",
    );
  });
  it("rouge sous 1,5 Mbit/s en envoi", () => {
    expect(status(evaluateNetwork({ rttMs: 40, uploadMbps: 1 }), "upload")).toBe("ko");
  });
  it("orange au-delà de 300 ms de latence", () => {
    expect(status(evaluateNetwork({ rttMs: 450, uploadMbps: 20 }), "latency")).toBe("warn");
  });
});
