import { filesContext, livePrises, logDownload, sessionFilesError } from "@/lib/server/files";
import { errorResponse } from "@/lib/server/http";
import { readManifest } from "@/lib/server/takes";
import { alignedWav, attachment } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Piste alignée d'un intervenant, nommée « Emission_Episode_Prise2_Lola.wav » (ENR-18, ENR-21). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ cid: string; take: string }> },
) {
  const { cid, take } = await params;
  const ctx = await filesContext(req, cid);
  if ("error" in ctx) return ctx.error;
  const { c, m, user } = ctx;
  const manifest = await readManifest(take.replace(/\.wav$/, "")).catch(() => null);
  const s = c.sessions.find((x) => x.id === manifest?.sessionId);
  if (!manifest || !s) return errorResponse(req, 404, "Le serveur ne retrouve pas cette piste.");
  const err = sessionFilesError(req, c, m, s);
  if (err) return err;
  const track = (await livePrises(c, s))
    .flatMap((p) => p.tracks)
    .find((t) => t.takeId === manifest.id);
  if (!track) return errorResponse(req, 404, "Cette piste est dans la corbeille.");
  if (!track.complete)
    return errorResponse(
      req,
      409,
      "Le serveur ne retrouve pas cette piste en entier : l'envoi n'est pas terminé, ou le stockage temporaire du lien de test a été vidé.",
    );
  const { stream, size } = await alignedWav(manifest);
  await logDownload(cid, user.email, track.fileName);
  return new Response(stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(size),
      "content-disposition": attachment(track.fileName),
      "cache-control": "no-store",
    },
  });
}
