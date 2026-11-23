import {
  cleanSegments,
  remapSegments,
  toSrt,
  toText,
  toVtt,
  trackFileName,
  type Transcript,
} from "@pod-stud/shared";
import { NextResponse } from "next/server";
import { audit, updateCollectif } from "@/lib/server/db";
import { filesContext, livePrises, logDownload, sessionFilesError } from "@/lib/server/files";
import { errorResponse } from "@/lib/server/http";
import { mixRef } from "@/lib/server/mix";
import { getStore } from "@/lib/server/store";
import { attachment } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ cid: string; sid: string; prise: string }> };
const key = (cid: string, sid: string, prise: string) =>
  `collectifs/${cid}/transcriptions/${sid}/${prise}.json`;

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

/** Transcription de la prise : JSON, ou ?format=txt|srt|vtt (et &base=mix pour les temps du mix). */
export async function GET(req: Request, { params }: Params) {
  const { cid, sid, prise } = await params;
  const ctx = await priseContext(req, cid, sid, prise);
  if (ctx.error) return ctx.error;
  const { c, s, p, user } = ctx;
  const raw = await getStore().get(key(cid, sid, prise));
  const q = new URL(req.url).searchParams;
  const format = q.get("format");
  if (!raw) {
    if (!format) return NextResponse.json(null);
    return errorResponse(req, 404, "Cette prise n'a pas encore de transcription.");
  }
  const t = JSON.parse(new TextDecoder().decode(raw)) as Transcript;
  if (!format) return NextResponse.json(t, { headers: { "cache-control": "no-store" } });
  let segs = t.segments;
  let suffix = "Transcription";
  if (q.get("base") === "mix") {
    const m = c.mixes?.[mixRef(sid, prise)];
    if (!m) return errorResponse(req, 404, "Cette prise n'a pas encore de mix.");
    segs = remapSegments(segs, m.cutList ?? [], m.settings.speed);
    suffix = "Mix_Transcription";
  }
  const body = format === "srt" ? toSrt(segs) : format === "vtt" ? toVtt(segs) : toText(segs);
  const ext = format === "srt" ? "srt" : format === "vtt" ? "vtt" : "txt";
  const emission = c.emissions.find((e) => e.id === s.emissionId)?.name ?? "Emission";
  const episode = c.episodes.find((e) => e.id === s.episodeId)?.title ?? "Episode";
  const name = trackFileName({ emission, episode, prise: p.number, participant: suffix }).replace(
    /\.wav$/,
    `.${ext}`,
  );
  await logDownload(cid, user.email, name);
  return new Response(body, {
    headers: {
      "content-type": ext === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
      "content-disposition": attachment(name),
      "cache-control": "no-store",
    },
  });
}

/** Enregistre la transcription (calculée dans le navigateur, ou corrigée à la main). */
export async function PUT(req: Request, { params }: Params) {
  const { cid, sid, prise } = await params;
  const ctx = await priseContext(req, cid, sid, prise);
  if (ctx.error) return ctx.error;
  const { s, p, user } = ctx;
  const text = await req.text();
  if (text.length > 5_000_000)
    return NextResponse.json({ error: "Transcription trop longue." }, { status: 413 });
  const b = JSON.parse(text || "null") as Partial<Transcript> | null;
  if (!b || !Array.isArray(b.segments))
    return NextResponse.json({ error: "Transcription illisible." }, { status: 400 });
  const prev = await getStore().get(key(cid, sid, prise));
  const old = prev ? (JSON.parse(new TextDecoder().decode(prev)) as Transcript) : null;
  const now = new Date().toISOString();
  const t: Transcript = {
    language: String(b.language ?? old?.language ?? s.language).slice(0, 5),
    model: String(b.model ?? old?.model ?? "").slice(0, 80),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    segments: cleanSegments(b.segments.slice(0, 50_000)),
  };
  await getStore().put(key(cid, sid, prise), new TextEncoder().encode(JSON.stringify(t)));
  await updateCollectif(cid, (doc) => {
    doc.transcripts ??= {};
    doc.transcripts[mixRef(sid, prise)] = {
      segments: t.segments.length,
      model: t.model,
      updatedAt: now,
      by: user.email,
    };
    audit(
      doc,
      user.email,
      `${old ? "Transcription corrigée" : "Transcription"} : prise ${p.number} de « ${s.name} »`,
    );
  });
  return NextResponse.json({ ok: true, segments: t.segments.length });
}
