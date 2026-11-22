import { isValidTakeId } from "@pod-stud/shared";
import { AccessToken } from "livekit-server-sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Jeton d'accès à la conversation en direct (LiveKit) pour une séance.
 * Les clés sont lues dans les variables d'environnement (LIVEKIT_URL, LIVEKIT_API_KEY,
 * LIVEKIT_API_SECRET), saisies dans Vercel ; sans elles, la page passe au relais de test.
 */
export async function POST(req: Request) {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)
    return Response.json({ error: "conversation en direct non configurée" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    sessionId?: string;
    identity?: string;
    name?: string;
  } | null;
  if (
    !body?.sessionId ||
    !isValidTakeId(body.sessionId) ||
    !body.identity ||
    !/^[a-z0-9]{4,32}$/.test(body.identity)
  )
    return Response.json({ error: "demande invalide" }, { status: 400 });
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: body.identity,
    name: String(body.name ?? "").slice(0, 60),
    ttl: "6h",
  });
  at.addGrant({
    room: body.sessionId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return Response.json({ url: LIVEKIT_URL, token: await at.toJwt() });
}
