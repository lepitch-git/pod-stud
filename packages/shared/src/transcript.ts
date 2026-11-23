/**
 * Transcription (étape 6c) : segments horodatés par intervenant, corrigés à la main, exportés en
 * texte, sous-titres SRT ou WebVTT. Les temps sont ceux de la prise d'origine ; pour le mix, on les
 * recale à travers les silences coupés et le changement de vitesse.
 */
export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  language: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  segments: Segment[];
}

/** Phrases que Whisper invente parfois sur du silence ou du bruit. */
const HALLUCINATIONS = [
  /sous-titr/i,
  /amara\.org/i,
  /merci d'avoir regardé/i,
  /abonnez-vous/i,
  /^\s*[.…♪-]*\s*$/,
];
export const isHallucination = (t: string) => HALLUCINATIONS.some((r) => r.test(t));

export function cleanSegments(segs: Segment[]): Segment[] {
  return segs
    .map((s) => ({
      start: Math.max(0, Number(s.start) || 0),
      end: Math.max(0, Number(s.end) || 0),
      speaker: String(s.speaker ?? "").slice(0, 60),
      text: String(s.text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000),
    }))
    .map((s) => ({ ...s, end: Math.max(s.end, s.start) }))
    .filter((s) => s.text && !isHallucination(s.text))
    .sort((a, b) => a.start - b.start || a.speaker.localeCompare(b.speaker));
}

/** Recale un temps de la prise sur le mix : silences coupés ([début, fin[ en s), puis vitesse. */
export function mapTime(t: number, cuts: [number, number][], speed: number): number {
  let removed = 0;
  for (const [a, b] of cuts) {
    if (t >= b) removed += b - a;
    else if (t > a) removed += t - a;
  }
  return (t - removed) / speed;
}

export function remapSegments(segs: Segment[], cuts: [number, number][], speed: number): Segment[] {
  return segs.map((s) => ({
    ...s,
    start: mapTime(s.start, cuts, speed),
    end: mapTime(s.end, cuts, speed),
  }));
}

function stamp(t: number, sep: "," | ".") {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (v: number, n = 2) => String(v).padStart(n, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toSrt(segs: Segment[]): string {
  return segs
    .map(
      (s, i) =>
        `${i + 1}\n${stamp(s.start, ",")} --> ${stamp(s.end, ",")}\n${s.speaker}: ${s.text}\n`,
    )
    .join("\n");
}

export function toVtt(segs: Segment[]): string {
  return (
    "WEBVTT\n\n" +
    segs
      .map(
        (s) =>
          `${stamp(s.start, ".")} --> ${stamp(s.end, ".")}\n<v ${s.speaker.replace(/>/g, "")}>${s.text}\n`,
      )
      .join("\n")
  );
}

/** Texte lisible : un paragraphe par prise de parole, regroupé quand le même intervenant continue. */
export function toText(segs: Segment[]): string {
  const out: string[] = [];
  let cur: { speaker: string; start: number; text: string[] } | null = null;
  for (const s of segs) {
    if (cur && cur.speaker === s.speaker) cur.text.push(s.text);
    else {
      if (cur)
        out.push(`[${stamp(cur.start, ".").slice(0, 8)}] ${cur.speaker} : ${cur.text.join(" ")}`);
      cur = { speaker: s.speaker, start: s.start, text: [s.text] };
    }
  }
  if (cur)
    out.push(`[${stamp(cur.start, ".").slice(0, 8)}] ${cur.speaker} : ${cur.text.join(" ")}`);
  return out.join("\n\n") + "\n";
}

/** Remplacer partout (noms propres mal compris, par exemple), sans tenir compte des majuscules. */
export function replaceAll(
  segs: Segment[],
  find: string,
  by: string,
): { segments: Segment[]; count: number } {
  if (!find) return { segments: segs, count: 0 };
  const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let count = 0;
  const segments = segs.map((s) => ({
    ...s,
    text: s.text.replace(re, () => {
      count++;
      return by;
    }),
  }));
  return { segments, count };
}

/** Code de langue des sessions → nom de langue attendu par Whisper. */
export const WHISPER_LANGUAGES: Record<string, string> = {
  fr: "french",
  en: "english",
  es: "spanish",
  de: "german",
  it: "italian",
  pt: "portuguese",
  nl: "dutch",
};
