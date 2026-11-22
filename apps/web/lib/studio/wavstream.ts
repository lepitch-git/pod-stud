import { pcm24ToFloat } from "@pod-stud/shared";

/**
 * Lit au fil de l'eau un WAV mono PCM 24 bits (pistes alignées du serveur) et rend des blocs
 * d'échantillons. `onBytes` suit la progression ; `signal` permet d'arrêter la lecture.
 */
export async function* readWav(
  url: string,
  opts: { signal?: AbortSignal; onBytes?: (read: number, total: number) => void } = {},
): AsyncGenerator<Float32Array> {
  const res = await fetch(url, { signal: opts.signal, cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(await errorText(res));
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  let header = new Uint8Array(0);
  let rest = new Uint8Array(0);
  let read = 0;
  let headerDone = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.length;
      opts.onBytes?.(read, total);
      let bytes = value;
      if (!headerDone) {
        const h = new Uint8Array(header.length + bytes.length);
        h.set(header);
        h.set(bytes, header.length);
        if (h.length < 44) {
          header = h;
          continue;
        }
        const tag = String.fromCharCode(h[0]!, h[1]!, h[2]!, h[3]!);
        if (tag !== "RIFF" || h[34] !== 24) throw new Error("Format de piste inattendu.");
        headerDone = true;
        bytes = h.subarray(44);
      }
      const all = new Uint8Array(rest.length + bytes.length);
      all.set(rest);
      all.set(bytes, rest.length);
      const usable = all.length - (all.length % 3);
      rest = all.slice(usable);
      if (usable) yield pcm24ToFloat(all.subarray(0, usable));
    }
  } finally {
    reader.releaseLock();
  }
}

async function errorText(res: Response) {
  const t = await res.text().catch(() => "");
  const m = /data-testid="download-error"[^>]*>([^<]+)</.exec(t);
  return m?.[1] ?? `La piste n'a pas pu être lue (erreur ${res.status}).`;
}
