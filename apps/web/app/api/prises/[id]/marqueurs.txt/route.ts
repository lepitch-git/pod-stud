import { markersToLabels } from "@pod-stud/shared";
import { sessionFilesDenied } from "@/lib/server/access";
import { errorResponse } from "@/lib/server/http";
import { badId, readManifest } from "@/lib/server/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marqueurs de la prise, au format « étiquettes » d'Audacity (ENR-09). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const m = await readManifest(id);
  if (!m)
    return errorResponse(
      req,
      404,
      "Le serveur ne retrouve pas cette prise (stockage temporaire du lien de test vidé).",
    );
  if (m.sessionId) {
    const denied = await sessionFilesDenied(req, m.sessionId);
    if (denied) return denied;
  }
  return new Response(markersToLabels(m.markers), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="marqueurs-${id}.txt"`,
    },
  });
}
