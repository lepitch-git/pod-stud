import { isValidTakeId } from "@pod-stud/shared";
import { sessionFilesDenied } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/http";
import { readManifest } from "@/lib/server/takes";
import { alignedWav, attachment, isComplete } from "@/lib/server/wav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Piste alignée (ENR-07) : 48 kHz, calée sur le départ commun de la séance, dérive de la carte son
 * corrigée. Toutes les pistes d'une même prise ont la même origine et se superposent sans clap.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; take: string }> },
) {
  const { id, take } = await params;
  const takeId = take.replace(/\.wav$/, "");
  if (!isValidTakeId(id) || !isValidTakeId(takeId))
    return errorResponse(req, 400, "Lien de piste invalide.");
  const denied = await sessionFilesDenied(req, id);
  if (denied) return denied;
  const m = await readManifest(takeId);
  if (!m || m.sessionId !== id)
    return errorResponse(req, 404, "Le serveur ne retrouve pas cette piste dans la séance.");
  if (!(await isComplete(m)))
    return errorResponse(
      req,
      409,
      "Le serveur ne retrouve pas cette piste en entier (stockage temporaire du lien de test).",
    );
  const { stream, size } = await alignedWav(m);
  const file = `${m.name || "prise"}-${m.participant || takeId}-alignee`
    .normalize("NFD")
    .replace(/[^\w-]+/g, "_")
    .slice(0, 80);
  return new Response(stream, {
    headers: {
      "content-type": "audio/wav",
      "content-length": String(size),
      "content-disposition": attachment(`${file}.wav`),
      "cache-control": "no-store",
    },
  });
}
