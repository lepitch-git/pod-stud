import { linkState } from "@pod-stud/shared";
import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/server/auth";
import {
  addUserToCollectif,
  audit,
  getCollectif,
  getOrCreateUser,
  updateCollectif,
} from "@/lib/server/db";

export const dynamic = "force-dynamic";

/**
 * Invitation d'un membre (CPT-02) : le lien, reçu à son adresse, vaut connexion ; la personne
 * devient membre avec le rôle prévu.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [cid = "", id = ""] = token.split(".");
  const c = await getCollectif(cid);
  const inv = c?.memberInvites.find((i) => i.id === id);
  const state = inv ? linkState(inv) : "inconnu";
  if (!c || !inv || state !== "valide")
    return NextResponse.redirect(new URL(`/lien/${state}`, req.url));
  const user = await getOrCreateUser(inv.email);
  await updateCollectif(cid, (doc) => {
    const i = doc.memberInvites.find((x) => x.id === id);
    if (i) i.usedAt = new Date().toISOString();
    if (!doc.members.some((m) => m.userId === user.id)) {
      doc.members.push({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: inv.role,
        emissions: inv.emissions,
        addedAt: new Date().toISOString(),
      });
      audit(doc, user.email, "A rejoint le collectif");
    }
  });
  await addUserToCollectif(user.id, cid);
  await setSessionCookie(user.id);
  return NextResponse.redirect(new URL(`/collectifs/${cid}?bienvenue=1`, req.url));
}
