import "server-only";
import { POSTPROD_RATE, wavHeader } from "@pod-stud/shared";
import type { Collectif, Mix, Session } from "./db";
import { postprodState } from "./postprod";
import type { PriseView } from "./prises";
import { getStore } from "./store";

export const mixRef = (sid: string, prise: string) => `${sid}/${prise}`;
export const mixPrefix = (cid: string, sid: string, prise: string) =>
  `collectifs/${cid}/mix/${sid}/${prise}/`;
export const mixChunkKey = (cid: string, sid: string, prise: string, u: string, i: number) =>
  `${mixPrefix(cid, sid, prise)}${u}/${String(i).padStart(5, "0")}.pcm`;

/** Pistes qui entrent dans le mix : la version traitée quand elle est à jour, sinon l'originale. */
export function mixSources(c: Collectif, s: Session, p: PriseView, cid: string) {
  return p.tracks
    .filter((t) => t.complete)
    .map((t) => {
      const st = postprodState(c, s, t.takeId);
      const processed = st.state === "a-jour" && st.pp;
      return {
        takeId: t.takeId,
        name: t.displayName,
        processed: Boolean(processed),
        url: `/api/collectifs/${cid}/pistes/${t.takeId}${processed ? "?traitee=1" : ""}`,
        sig: `${t.takeId}:${processed && st.pp ? st.pp.cle : "orig"}`,
      };
    });
}
export const sourcesSig = (src: { sig: string }[]) => src.map((x) => x.sig).join(",");

export async function cleanupMix(cid: string, sid: string, prise: string, keep?: string) {
  const store = getStore();
  const all = await store.list(mixPrefix(cid, sid, prise));
  await Promise.all(
    all
      .filter((o) => !keep || !o.key.startsWith(`${mixPrefix(cid, sid, prise)}${keep}/`))
      .map((o) => store.delete(o.key)),
  );
}

/** Le mix rangé est déjà au volume final : on le renvoie tel quel, précédé de l'en-tête WAV. */
export function mixWav(cid: string, sid: string, prise: string, m: Mix) {
  const store = getStore();
  let i = -1;
  const stream = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i === -1) ctrl.enqueue(wavHeader(m.frames * 3, POSTPROD_RATE));
      else if (i < m.chunks) {
        const data = await store.get(mixChunkKey(cid, sid, prise, m.u, i));
        if (!data) return ctrl.error(new Error("morceau du mix introuvable"));
        ctrl.enqueue(data);
      } else return ctrl.close();
      i++;
    },
  });
  return { stream, size: m.frames * 3 + 44 };
}
