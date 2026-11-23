import { describe, expect, it } from "vitest";
import {
  cleanSegments,
  mapTime,
  remapSegments,
  replaceAll,
  toSrt,
  toText,
  toVtt,
  type Segment,
} from "./transcript";

const segs: Segment[] = [
  { start: 0.5, end: 2.25, speaker: "Xad", text: "Bonjour et bienvenue au comptoir." },
  { start: 2.5, end: 4, speaker: "Xad", text: "Ce soir, Mister I." },
  { start: 4.2, end: 6, speaker: "Mister E", text: "Salut !" },
];

describe("transcription", () => {
  it("enlève les phrases inventées sur le silence et trie par temps", () => {
    const out = cleanSegments([
      {
        start: 9,
        end: 10,
        speaker: "A",
        text: "Sous-titres réalisés par la communauté d'Amara.org",
      },
      { start: 3, end: 2, speaker: "B", text: "  deux   espaces " },
      { start: 1, end: 2, speaker: "A", text: "un" },
    ]);
    expect(out.map((s) => s.text)).toEqual(["un", "deux espaces"]);
    expect(out[1]!.end).toBe(3);
  });
  it("SRT et WebVTT bien formés", () => {
    const srt = toSrt(segs);
    expect(srt.startsWith("1\n00:00:00,500 --> 00:00:02,250\nXad: Bonjour")).toBe(true);
    expect(srt).toContain("3\n00:00:04,200 --> 00:00:06,000\nMister E: Salut !");
    const vtt = toVtt(segs);
    expect(vtt.startsWith("WEBVTT\n\n00:00:00.500 --> 00:00:02.250\n<v Xad>Bonjour")).toBe(true);
  });
  it("texte : un paragraphe par prise de parole", () => {
    expect(toText(segs)).toBe(
      "[00:00:00] Xad : Bonjour et bienvenue au comptoir. Ce soir, Mister I.\n\n[00:00:04] Mister E : Salut !\n",
    );
  });
  it("remplacer partout corrige les noms propres", () => {
    const r = replaceAll(segs, "mister i", "Mister E");
    expect(r.count).toBe(1);
    expect(r.segments[1]!.text).toBe("Ce soir, Mister E.");
  });
  it("recale les temps sur le mix (silences coupés, vitesse)", () => {
    const cuts: [number, number][] = [
      [1, 2],
      [5, 7],
    ];
    expect(mapTime(0.5, cuts, 1)).toBe(0.5);
    expect(mapTime(1.5, cuts, 1)).toBe(1);
    expect(mapTime(4, cuts, 1)).toBe(3);
    expect(mapTime(8, cuts, 1)).toBe(5);
    expect(mapTime(8, cuts, 1.25)).toBe(4);
    expect(remapSegments(segs, cuts, 1)[2]!.start).toBeCloseTo(3.2);
  });
});
