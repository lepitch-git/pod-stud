import {
  isUploadId,
  normalizeMix,
  POSTPROD_CHUNK_FRAMES,
  trackFileName,
  type MixSettings,
} from "@pod-stud/shared";
import { NextResponse } from "next/server";
import { audit, updateCollectif } from "@/lib/server/db";
import { filesContext, livePrises, logDownload, sessionFilesError } from "@/lib/server/files";
import { errorResponse } from "@/lib/server/http";
import {
  cleanupMix,
  mixChunkKey,
  mixPrefix,
  mixRef,
  mixSources,
  mixWav,
  sourcesSig,
} from "@/lib/server/mix";
import { getStore } from "@/lib/server/store";
import { attachment } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ cid: string; sid: string; prise: string }> };
const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

async function priseContext(req: Request, cid: string, sid: string, prise: string) {
  const ctx = await filesContext(req, cid);
  if (ctx.error) return { error: ctx.error };
  const s = ctx.c.sessions.find((x) => x.id === sid);
  const err = sessionFilesError(req, ctx.c, ctx.m, s);
  if (err || !s) return { error: err ?? errorResponse(req, 404, "Session introuvable.") };
  const p = (await livePrises(ctx.c, s)).find((x) => x.key === prise);
  if (!p) return { error: errorResponse(req, 404, "Cette prise n'existe plus.") };
  return { ...ctx, s, p };
}

/** Mix de la prise (WAV 48 kHz, 24 bits), « Emission_Episode_Prise1_Mix.wav ». */
export async function GET(req: Request, { params }: Params) {
  const { cid, sid, prise } = await params;
  const ctx = await priseContext(req, cid, sid, prise);
  if (ctx.error) return ctx.error;
  const { c, s, p, user } = ctx;
  const m = c.mixes?.[mixRef(sid, prise)];
  if (!m)
    return errorResponse(
      req,
      404,
      "Cette prise n'a pas encore de mix : créez-le depuis l'onglet Postproductions.",
    );
  const emission = c.emissions.find((e) => e.id === s.emissionId)?.name ?? "Emission";
  const episode = c.episodes.find((e) => e.id === s.episodeId)?.title ?? "Episode";
  const name = trackFileName({ emission, episode, prise: p.number, participant: "Mix" });
  const { stream, size } = mixWav(cid, sid, prise, m);
  await logDownload(cid, user.email, name);
  return new Response(stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(size),
      "content-disposition": attachment(name),
      "cache-control": "no-store",
    },
  });
}

/** Envoi d'un morceau du mix : ?u=<dossier>&morceau=<n>. */
export async function PUT(req: Request, { params }: Params) {
  const { cid, sid, prise } = await params;
  const ctx = await priseContext(req, cid, sid, prise);
  if (ctx.error) return ctx.error;
  const q = new URL(req.url).searchParams;
  const u = q.get("u") ?? "";
  const i = Number(q.get("morceau"));
  if (!isUploadId(u) || !Number.isInteger(i) || i < 0 || i > 100_000)
    return bad(400, "Morceau mal nommé.");
  const body = new Uint8Array(await req.arrayBuffer());
  if (!body.length || body.length % 3 || body.length > POSTPROD_CHUNK_FRAMES * 3)
    return bad(400, "Morceau de taille inattendue.");
  await getStore().put(mixChunkKey(cid, sid, prise, u, i), body);
  return NextResponse.json({ ok: true });
}

/** Fin du mixage : vérifie que tout est arrivé et que les pistes n'ont pas changé entre-temps. */
export async function POST(req: Request, { params }: Params) {
  const { cid, sid, prise } = await params;
  const ctx = await priseContext(req, cid, sid, prise);
  if (ctx.error) return ctx.error;
  const { c, s, p, user } = ctx;
  const b = (await req.json().catch(() => null)) as {
    u: string;
    settings: MixSettings;
    sources: string;
    frames: number;
    removedSec: number;
    cuts: number;
  } | null;
  if (!b || !isUploadId(b.u) || !Number.isInteger(b.frames) || b.frames <= 0)
    return bad(400, "Mix incomplet.");
  if (b.sources !== sourcesSig(mixSources(c, s, p, cid)))
    return bad(409, "Les pistes de la prise ont changé pendant le mixage : relancez-le.");
  const chunks = Math.ceil(b.frames / POSTPROD_CHUNK_FRAMES);
  const stored = await getStore().list(`${mixPrefix(cid, sid, prise)}${b.u}/`);
  if (stored.length !== chunks || stored.reduce((a, o) => a + o.size, 0) !== b.frames * 3)
    return bad(409, "Des morceaux du mix manquent : relancez le mixage.");
  const settings = normalizeMix(b.settings);
  await updateCollectif(cid, (doc) => {
    doc.mixes ??= {};
    doc.mixes[mixRef(sid, prise)] = {
      u: b.u,
      settings,
      sources: b.sources,
      frames: b.frames,
      chunks,
      removedSec: Math.max(0, Number(b.removedSec) || 0),
      cuts: Math.max(0, Math.round(Number(b.cuts) || 0)),
      doneAt: new Date().toISOString(),
      by: user.email,
    };
    audit(doc, user.email, `Mix de la prise ${p.number} de « ${s.name} »`);
  });
  await cleanupMix(cid, sid, prise, b.u);
  return NextResponse.json({ ok: true });
}
