import { logDownload, trackContext } from "@/lib/server/files";
import { errorResponse } from "@/lib/server/http";
import { postprodState, processedFileName, processedWav } from "@/lib/server/postprod";
import { alignedWav, attachment } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Piste alignée d'un intervenant, nommée « Emission_Episode_Prise2_Lola.wav » (ENR-18, ENR-21).
 * Avec ?traitee=1 : la même piste après traitement de la voix (étape 6a), « …_Lola_traitee.wav ».
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ cid: string; take: string }> },
) {
  const { cid, take } = await params;
  const ctx = await trackContext(req, cid, take);
  if (ctx.error) return ctx.error;
  const { c, user, s, manifest, track } = ctx;
  if (!track.complete)
    return errorResponse(
      req,
      409,
      "Le serveur ne retrouve pas cette piste en entier : l'envoi n'est pas terminé, ou le stockage temporaire du lien de test a été vidé.",
    );
  let body: { stream: ReadableStream<Uint8Array>; size: number };
  let name = track.fileName;
  if (new URL(req.url).searchParams.get("traitee")) {
    const st = postprodState(c, s, manifest.id);
    if (st.state === "brut") body = await alignedWav(manifest);
    else if (st.state === "a-jour" && st.pp) body = processedWav(cid, manifest.id, st.pp);
    else
      return errorResponse(
        req,
        409,
        st.state === "perime"
          ? "Les réglages de cette piste ont changé depuis le dernier traitement : relancez le traitement avant de la télécharger."
          : "Cette piste n'a pas encore été traitée : lancez le traitement depuis la page de la session.",
      );
    name = processedFileName(name);
  } else body = await alignedWav(manifest);
  await logDownload(cid, user.email, name);
  return new Response(body.stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(body.size),
      "content-disposition": attachment(name),
      "cache-control": "no-store",
    },
  });
}
