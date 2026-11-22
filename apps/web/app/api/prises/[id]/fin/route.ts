import { isValidTakeId, missingChunks, type TakeManifest } from "@pod-stud/shared";
import { getStore } from "@/lib/server/store";
import { badId, manifestKey, receivedChunks, type StoredManifest } from "@/lib/server/takes";

export const runtime = "nodejs";

/**
 * Clôture d'une prise : vérifie que tous les morceaux annoncés sont arrivés (409 et liste des manquants sinon),
 * puis enregistre le manifeste. Avec ?force=1, les manquants sont notés comme perdus.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bad = badId(id);
  if (bad) return bad;
  const m = (await req.json().catch(() => null)) as TakeManifest | null;
  if (!m || m.id !== id || !Number.isInteger(m.chunkCount) || m.chunkCount < 0)
    return Response.json({ error: "manifeste invalide" }, { status: 400 });
  const received = (await receivedChunks(id)).map((c) => c.index);
  const missing = missingChunks(received, m.chunkCount);
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (missing.length && !force) return Response.json({ missing }, { status: 409 });
  const stored: StoredManifest = {
    id,
    name: String(m.name ?? "").slice(0, 200),
    participant: String(m.participant ?? "").slice(0, 100),
    sampleRate: Number(m.sampleRate) || 48000,
    startedAt: String(m.startedAt),
    endedAt: m.endedAt ? String(m.endedAt) : null,
    chunkCount: m.chunkCount,
    markers: Array.isArray(m.markers) ? m.markers.slice(0, 1000) : [],
    gaps: Array.isArray(m.gaps) ? m.gaps.slice(0, 1000) : [],
    browser: String(m.browser ?? "").slice(0, 100),
    sessionId: isValidTakeId(String(m.sessionId ?? "")) ? m.sessionId : undefined,
    startServerMs: Number.isFinite(m.startServerMs) ? m.startServerMs : undefined,
    syncPoints: Array.isArray(m.syncPoints)
      ? m.syncPoints
          .filter((p) => Number.isFinite(p?.frame) && Number.isFinite(p?.serverMs))
          .slice(0, 20_000)
          .map((p) => ({ frame: p.frame, serverMs: p.serverMs }))
      : undefined,
    clockRttMs: Number.isFinite(m.clockRttMs) ? m.clockRttMs : undefined,
    receivedAt: new Date().toISOString(),
    lost: missing,
  };
  // Index de la séance : permet de retrouver toutes ses pistes pour l'export aligné.
  if (stored.sessionId)
    await getStore().put(
      `seances/${stored.sessionId}/prises/${id}.json`,
      new TextEncoder().encode(JSON.stringify({ id, participant: stored.participant })),
      "application/json",
    );
  await getStore().put(
    manifestKey(id),
    new TextEncoder().encode(JSON.stringify(stored)),
    "application/json",
  );
  return Response.json({ ok: true, lost: missing });
}
