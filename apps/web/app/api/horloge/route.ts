// Heure du serveur, à la fraction de milliseconde, pour l'horloge commune des participants (ENR-07).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { t: performance.timeOrigin + performance.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
