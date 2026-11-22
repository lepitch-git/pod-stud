/**
 * Enregistrement local (exigences ENR-03 à ENR-05, ENR-09, ENR-10).
 * Le son est capté sans perte (PCM 24 bits), écrit sur l'appareil par morceaux de quelques secondes,
 * puis envoyé au serveur au fil de l'eau. Ce module regroupe la logique pure, testable sans navigateur.
 */

/** Durée d'un morceau : assez court pour ne perdre que quelques secondes en cas de plantage. */
export const CHUNK_SECONDS = 5;
export const BYTES_PER_SAMPLE = 3;
export const CHANNELS = 1;

export function chunkFrames(sampleRate: number): number {
  return Math.round(sampleRate * CHUNK_SECONDS);
}

/** Convertit des échantillons flottants (-1..1) en PCM 24 bits petit-boutiste, à partir de `offset`. */
export function floatToPcm24(input: Float32Array, out: Uint8Array, offset = 0): number {
  let o = offset;
  for (let i = 0; i < input.length; i++) {
    let s = input[i] as number;
    if (!(s === s)) s = 0; // NaN
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    const v = s < 0 ? Math.round(s * 0x800000) : Math.round(s * 0x7fffff);
    out[o++] = v & 0xff;
    out[o++] = (v >> 8) & 0xff;
    out[o++] = (v >> 16) & 0xff;
  }
  return o;
}

/** Lit un échantillon PCM 24 bits (utile aux tests et aux vérifications). */
export function readPcm24(buf: Uint8Array, index: number): number {
  const o = index * 3;
  let v = (buf[o] as number) | ((buf[o + 1] as number) << 8) | ((buf[o + 2] as number) << 16);
  if (v & 0x800000) v -= 0x1000000;
  return v / (v < 0 ? 0x800000 : 0x7fffff);
}

/** En-tête WAV (44 octets) pour `dataBytes` octets de PCM. Au-delà de 4 Go, la taille est plafonnée. */
export function wavHeader(
  dataBytes: number,
  sampleRate: number,
  channels = CHANNELS,
  bitsPerSample = BYTES_PER_SAMPLE * 8,
): Uint8Array {
  const h = new Uint8Array(44);
  const v = new DataView(h.buffer);
  const blockAlign = channels * (bitsPerSample / 8);
  const data = Math.min(dataBytes, 0xffffffff - 36);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) h[o + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  v.setUint32(40, data, true);
  return h;
}

/** Identifiant de prise : lettres minuscules, chiffres et tirets (sert aussi de chemin de stockage). */
export function isValidTakeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{7,63}$/.test(id);
}

export function newTakeId(now = new Date(), rand: () => number = Math.random): string {
  const d = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-").toLowerCase();
  const r = Array.from(
    { length: 8 },
    () => "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rand() * 32)],
  ).join("");
  return `${d}-${r}`;
}

/** Nom d'objet d'un morceau, trié dans l'ordre : « 000042.pcm ». */
export function chunkName(index: number): string {
  return `${String(index).padStart(6, "0")}.pcm`;
}

export function parseChunkName(name: string): number | null {
  const m = /^(\d{6})\.pcm$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** Indices manquants entre 0 et `count - 1`. */
export function missingChunks(received: number[], count: number): number[] {
  const set = new Set(received);
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (!set.has(i)) out.push(i);
  return out;
}

/** « 0:07 », « 12:05 », « 1:02:03 ». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Délai avant la prochaine tentative d'envoi : 1 s, 2 s, 4 s… plafonné à 15 s. */
export function retryDelay(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt));
}

export interface Marker {
  /** Secondes depuis le début de la prise. */
  at: number;
  label: string;
}

/** Trou dans l'enregistrement (appli mise en arrière-plan, micro coupé par le système…). */
export interface Gap {
  at: number;
  seconds: number;
}

/** Marqueurs au format « étiquettes » d'Audacity (début, fin, texte), séparés par des tabulations. */
export function markersToLabels(markers: Marker[]): string {
  return markers.map((m) => `${m.at.toFixed(3)}\t${m.at.toFixed(3)}\t${m.label}`).join("\n") + "\n";
}

/** Manifeste d'une prise, conservé sur le serveur avec les morceaux. */
export interface TakeManifest {
  id: string;
  name: string;
  participant: string;
  sampleRate: number;
  startedAt: string;
  endedAt: string | null;
  chunkCount: number;
  markers: Marker[];
  gaps: Gap[];
  browser: string;
}
