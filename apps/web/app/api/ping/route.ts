// Point de mesure du test réseau (SAL-08) : temps de réponse (GET) et débit d'envoi (POST).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ t: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const body = await req.arrayBuffer();
  return Response.json({ bytes: body.byteLength }, { headers: { "Cache-Control": "no-store" } });
}
