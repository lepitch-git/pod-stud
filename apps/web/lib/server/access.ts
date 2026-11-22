import "server-only";
import { can, type Action } from "@pod-stud/shared";
import { redirect } from "next/navigation";
import { currentUser } from "./auth";
import {
  collectifOfSession,
  getCollectif,
  memberOf,
  type Collectif,
  type Member,
  type User,
} from "./db";
import { errorResponse } from "./http";

export interface Ctx {
  user: User;
  collectif: Collectif;
  member: Member;
}

/** Pour les pages : membre connecté du collectif, sinon renvoi vers la connexion ou la liste. */
export async function requireMember(cid: string, next: string): Promise<Ctx> {
  const user = await currentUser();
  if (!user) redirect(`/connexion?suite=${encodeURIComponent(next)}`);
  const collectif = await getCollectif(cid);
  const member = collectif ? memberOf(collectif, user.id) : null;
  if (!collectif || !member) redirect("/collectifs?refus=1");
  return { user, collectif, member };
}

/** Pour les actions : même contrôle, plus le droit demandé ; lève une erreur sinon. */
export async function requireAction(
  cid: string,
  action: Action,
  emissionId?: string,
): Promise<Ctx> {
  const user = await currentUser();
  if (!user) throw new Error("Vous n'êtes plus connecté.");
  const collectif = await getCollectif(cid);
  const member = collectif ? memberOf(collectif, user.id) : null;
  if (!collectif || !member || !can(member, action, emissionId))
    throw new Error("Votre rôle ne permet pas cette action.");
  return { user, collectif, member };
}

/**
 * Fichiers d'une séance (ENR-21) : libres pour une séance d'essai, réservés aux rôles autorisés pour
 * une session de collectif ; jamais accessibles avec un lien d'invité (CPT-09).
 */
export async function sessionFilesDenied(
  req: Request,
  sessionId: string,
): Promise<Response | null> {
  const cid = await collectifOfSession(sessionId);
  if (!cid) return null;
  const c = await getCollectif(cid);
  const s = c?.sessions.find((x) => x.id === sessionId);
  if (!c || !s || s.deletedAt) return errorResponse(req, 404, "Cette session n'existe plus.");
  const user = await currentUser();
  const m = memberOf(c, user?.id);
  if (!can(m, "fichiers", s.emissionId))
    return errorResponse(
      req,
      403,
      "Les fichiers de cette session sont réservés aux membres du collectif qui y ont accès. Connectez-vous avec votre adresse e-mail de membre.",
    );
  if (s.archivedAt)
    return errorResponse(
      req,
      409,
      "Cette session est archivée : restaurez-la depuis sa page avant de télécharger ses fichiers.",
    );
  return null;
}
