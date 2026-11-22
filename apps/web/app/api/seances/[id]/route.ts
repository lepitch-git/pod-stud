import { isValidTakeId } from "@pod-stud/shared";
import { alignTake, sessionTakes } from "@/lib/server/align";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prises d'une séance, regroupées par départ commun, avec la qualité de l'alignement de chaque piste. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidTakeId(id)) return Response.json({ error: "séance invalide" }, { status: 400 });
  const takes = await sessionTakes(id);
  const tracks = await Promise.all(takes.map(alignTake));
  const groups = new Map<string, unknown[]>();
  for (const t of tracks) {
    const key = String(t.manifest.startServerMs ?? t.manifest.id);
    const g = groups.get(key) ?? [];
    g.push({
      takeId: t.manifest.id,
      participant: t.manifest.participant,
      name: t.manifest.name,
      browser: t.manifest.browser,
      seconds: t.outFrames / 48000,
      /** Écart entre le premier échantillon réel et le départ commun (ms). */
      startOffsetMs: t.fit.startMs - t.referenceMs,
      /** Dérive de la carte son mesurée (ppm). */
      driftPpm: (t.fit.rate / t.manifest.sampleRate - 1) * 1e6,
      residualMs: t.fit.residualMs,
      syncPoints: t.manifest.syncPoints?.length ?? 0,
      clockRttMs: t.manifest.clockRttMs ?? null,
    });
    groups.set(key, g);
  }
  return Response.json(
    {
      id,
      takes: [...groups.entries()].map(([k, tracks]) => ({
        startServerMs: Number(k) || null,
        tracks,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
