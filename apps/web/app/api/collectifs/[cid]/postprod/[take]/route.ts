import {
  isTreatmentKey,
  POSTPROD_CHUNK_FRAMES,
  treatmentKey,
  type PostprodStats,
} from "@pod-stud/shared";
import { NextResponse } from "next/server";
import { alignTake } from "@/lib/server/align";
import { audit, updateCollectif } from "@/lib/server/db";
import { trackContext } from "@/lib/server/files";
import { cleanupPostprod, effectiveTreatment, postprodChunkKey } from "@/lib/server/postprod";
import { getStore } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cid: string; take: string }> };
const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

/** Envoi d'un morceau de piste traitée (PCM 24 bits, 10 s au plus) : ?cle=<réglages>&morceau=<n>. */
export async function PUT(req: Request, { params }: Params) {
  const { cid, take } = await params;
  const ctx = await trackContext(req, cid, take);
  if (ctx.error) return ctx.error;
  const q = new URL(req.url).searchParams;
  const cle = q.get("cle") ?? "";
  const i = Number(q.get("morceau"));
  if (!isTreatmentKey(cle) || !Number.isInteger(i) || i < 0 || i > 100_000)
    return bad(400, "Morceau mal nommé.");
  if (cle !== treatmentKey(effectiveTreatment(ctx.c, ctx.s, ctx.manifest.id)))
    return bad(409, "Les réglages de cette piste ont changé pendant le traitement.");
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length || body.length % 3 || body.length > POSTPROD_CHUNK_FRAMES * 3)
    return bad(400, "Morceau de taille inattendue.");
  await getStore().put(postprodChunkKey(cid, ctx.manifest.id, cle, i), body);
  return NextResponse.json({ ok: true });
}

/** Fin du traitement : vérifie que tout est arrivé et enregistre les mesures. */
export async function POST(req: Request, { params }: Params) {
  const { cid, take } = await params;
  const ctx = await trackContext(req, cid, take);
  if (ctx.error) return ctx.error;
  const { c, s, manifest, user } = ctx;
  const b = (await req.json().catch(() => null)) as
    | (PostprodStats & { cle: string; frames: number; chunks: number })
    | null;
  const t = effectiveTreatment(c, s, manifest.id);
  const cle = treatmentKey(t);
  if (!b || b.cle !== cle)
    return bad(409, "Les réglages de cette piste ont changé pendant le traitement.");
  const { outFrames } = await alignTake(manifest);
  const chunks = Math.ceil(outFrames / POSTPROD_CHUNK_FRAMES);
  if (b.frames !== outFrames || b.chunks !== chunks)
    return bad(400, "La piste traitée n'a pas la durée de la piste d'origine.");
  const stored = await getStore().list(`collectifs/${cid}/postprod/${manifest.id}/${cle}/`);
  if (stored.length < chunks)
    return bad(409, "Des morceaux de la piste traitée manquent : relancez le traitement.");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : -Infinity);
  await updateCollectif(cid, (doc) => {
    doc.postprods ??= {};
    doc.postprods[manifest.id] = {
      cle,
      treatment: t,
      frames: outFrames,
      chunks,
      inputLufs: num(b.inputLufs),
      outputLufs: num(b.outputLufs),
      repaired: Math.max(0, Math.round(num(b.repaired))) || 0,
      breaths: Math.max(0, Math.round(num(b.breaths))) || 0,
      doneAt: new Date().toISOString(),
      by: user.email,
    };
    audit(doc, user.email, `Traitement de la voix : ${ctx.track.fileName} (${t.preset})`);
  });
  await cleanupPostprod(cid, manifest.id, cle);
  return NextResponse.json({ ok: true });
}
