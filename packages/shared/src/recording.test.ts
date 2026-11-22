import { describe, expect, it } from "vitest";
import {
  chunkFrames,
  chunkName,
  floatToPcm24,
  formatDuration,
  isValidTakeId,
  markersToLabels,
  missingChunks,
  newTakeId,
  parseChunkName,
  readPcm24,
  retryDelay,
  wavHeader,
} from "./recording";

describe("PCM 24 bits", () => {
  it("convertit et relit les échantillons, avec écrêtage à ±1", () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2, Number.NaN]);
    const out = new Uint8Array(input.length * 3);
    expect(floatToPcm24(input, out)).toBe(24);
    expect(readPcm24(out, 0)).toBe(0);
    expect(readPcm24(out, 1)).toBeCloseTo(0.5, 6);
    expect(readPcm24(out, 2)).toBeCloseTo(-0.5, 6);
    expect(readPcm24(out, 3)).toBe(1);
    expect(readPcm24(out, 4)).toBe(-1);
    expect(readPcm24(out, 5)).toBe(1);
    expect(readPcm24(out, 6)).toBe(-1);
    expect(readPcm24(out, 7)).toBe(0);
  });
  it("écrit à partir d'un décalage", () => {
    const out = new Uint8Array(9);
    expect(floatToPcm24(new Float32Array([1]), out, 6)).toBe(9);
    expect(readPcm24(out, 2)).toBe(1);
  });
});

describe("en-tête WAV", () => {
  it("décrit du mono 48 kHz 24 bits", () => {
    const h = wavHeader(300, 48000);
    const v = new DataView(h.buffer);
    expect(new TextDecoder().decode(h.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(4, true)).toBe(336);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(144000);
    expect(v.getUint16(32, true)).toBe(3);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(300);
  });
});

describe("morceaux et prises", () => {
  it("nomme les morceaux dans l'ordre", () => {
    expect(chunkName(42)).toBe("000042.pcm");
    expect(parseChunkName("000042.pcm")).toBe(42);
    expect(parseChunkName("../x.pcm")).toBeNull();
  });
  it("calcule la taille d'un morceau", () => {
    expect(chunkFrames(48000)).toBe(240000);
  });
  it("liste les morceaux manquants", () => {
    expect(missingChunks([0, 2, 3], 5)).toEqual([1, 4]);
  });
  it("crée des identifiants de prise sûrs", () => {
    const id = newTakeId(new Date("2026-11-22T21:30:05Z"), () => 0);
    expect(id).toBe("20261122-213005-aaaaaaaa");
    expect(isValidTakeId(id)).toBe(true);
    expect(isValidTakeId("../etc/passwd")).toBe(false);
    expect(isValidTakeId("ABC")).toBe(false);
  });
  it("formate les durées", () => {
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(725)).toBe("12:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
  it("espace les nouvelles tentatives", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });
  it("exporte les marqueurs pour Audacity", () => {
    expect(markersToLabels([{ at: 12.5, label: "Marqueur 1" }])).toBe(
      "12.500\t12.500\tMarqueur 1\n",
    );
  });
});
