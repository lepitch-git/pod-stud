import { can, isValidTakeId } from "@pod-stud/shared";
import { AccessToken } from "livekit-server-sdk";
import { currentUser } from "@/lib/server/auth";
import { collectifOfSession, getCollectif, memberOf } from "@/lib/server/db";
import { resolveGuestInvite } from "@/lib/server/invitations";

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
    invitation?: string;
  } | null;
  if (
    !body?.sessionId ||
    !isValidTakeId(body.sessionId) ||
    !body.identity ||
    !/^[a-z0-9]{4,32}$/.test(body.identity)
  )
    return Response.json({ error: "demande invalide" }, { status: 400 });
  // Session de collectif : membre autorisé à enregistrer, ou invité avec un lien valide.
  const cid = await collectifOfSession(body.sessionId);
  if (cid) {
    let allowed = false;
    if (body.invitation) {
      const r = await resolveGuestInvite(body.invitation);
      allowed = r.ok && r.s.id === body.sessionId;
    } else {
      const c = await getCollectif(cid);
      const s = c?.sessions.find((x) => x.id === body.sessionId);
      allowed =
        !!c && !!s && can(memberOf(c, (await currentUser())?.id), "enregistrer", s.emissionId);
    }
    if (!allowed) return Response.json({ error: "accès refusé" }, { status: 403 });
  }
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
