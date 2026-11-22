import { markersToLabels } from "@pod-stud/shared";
import { badId, readManifest } from "@/lib/server/takes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marqueurs de la prise, au format « étiquettes » d'Audacity (ENR-09). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const m = await readManifest(id);
  if (!m) return Response.json({ error: "prise inconnue" }, { status: 404 });
  return new Response(markersToLabels(m.markers), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="marqueurs-${id}.txt"`,
    },
  });
}
