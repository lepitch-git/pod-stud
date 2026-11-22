import { filePart } from "@pod-stud/shared";
import { makeZip, predictLength } from "client-zip";
import { alignTake } from "@/lib/server/align";
import type { Session } from "@/lib/server/db";
import {
  filesContext,
  folderOf,
  livePrises,
  logDownload,
  sessionFilesError,
} from "@/lib/server/files";
import { errorResponse } from "@/lib/server/http";
import { readManifest } from "@/lib/server/takes";
import { alignedWav, attachment } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * Archive ZIP (ENR-21) d'une prise, d'une session, d'un épisode ou d'une émission entière :
 * pistes alignées rangées par Émission/Épisode/Session, produites au fil de l'eau (sans compression,
 * l'audio ne se compresse presque pas en ZIP).
 */
export async function GET(req: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const ctx = await filesContext(req, cid);
  if ("error" in ctx) return ctx.error;
  const { c, m, user } = ctx;
  const q = new URL(req.url).searchParams;
  let sessions: Session[] = [];
  let label = "";
  const prise = q.get("prise");
  if (q.get("session")) {
    const s = c.sessions.find((x) => x.id === q.get("session"));
    const err = sessionFilesError(req, c, m, s);
    if (err) return err;
    sessions = [s as Session];
    label = (s as Session).name;
  } else if (q.get("episode")) {
    const ep = c.episodes.find((x) => x.id === q.get("episode"));
    if (!ep) return errorResponse(req, 404, "Épisode introuvable.");
    sessions = c.sessions.filter((s) => s.episodeId === ep.id && !s.deletedAt && !s.archivedAt);
    label = ep.title;
  } else if (q.get("emission")) {
    const e = c.emissions.find((x) => x.id === q.get("emission"));
    if (!e) return errorResponse(req, 404, "Émission introuvable.");
    sessions = c.sessions.filter((s) => s.emissionId === e.id && !s.deletedAt && !s.archivedAt);
    label = e.name;
  } else return errorResponse(req, 400, "Lien de téléchargement incomplet.");
  for (const s of sessions) {
    const err = sessionFilesError(req, c, m, s);
    if (err) return err;
  }

  const files: { name: string; takeId: string; size: number }[] = [];
  let priseNumber = 0;
  for (const s of sessions) {
    for (const p of await livePrises(c, s)) {
      if (prise && p.key !== prise) continue;
      priseNumber = p.number;
      for (const t of p.tracks) {
        if (!t.complete) continue;
        const manifest = await readManifest(t.takeId);
        if (!manifest) continue;
        const a = await alignTake(manifest);
        files.push({
          name: `${folderOf(c, s)}/${t.fileName}`,
          takeId: t.takeId,
          size: a.outFrames * 3 + 44,
        });
      }
    }
  }
  if (!files.length)
    return errorResponse(req, 404, "Aucune piste complète à télécharger ici pour l'instant.");
  const lastModified = new Date();
  async function* entries() {
    for (const f of files) {
      const manifest = await readManifest(f.takeId);
      if (!manifest) throw new Error("piste disparue");
      const { stream } = await alignedWav(manifest);
      yield { name: f.name, input: stream, size: f.size, lastModified };
    }
  }
  const length = predictLength(files.map((f) => ({ name: f.name, size: f.size, lastModified })));
  const zipName = `${filePart(label)}${prise ? `_Prise${priseNumber}` : ""}.zip`;
  await logDownload(cid, user.email, `${zipName} (${files.length} piste(s))`);
  return new Response(makeZip(entries(), { length }), {
    headers: {
      "content-type": "application/zip",
      "content-length": String(length),
      "content-disposition": attachment(zipName),
      "cache-control": "no-store",
    },
  });
}
