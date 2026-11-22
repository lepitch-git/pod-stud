import "server-only";
import { linkState, type LinkState } from "@pod-stud/shared";
import { getCollectif, type Collectif, type GuestInvite, type Session } from "./db";

/** Lien d'invité « <collectif>.<invitation> » : état, session et collectif. */
export async function resolveGuestInvite(
  token: string,
): Promise<
  | { ok: true; c: Collectif; s: Session; inv: GuestInvite }
  | { ok: false; state: LinkState | "inconnu" | "archive" }
> {
  const [cid = "", id = ""] = token.split(".");
  const c = await getCollectif(cid);
  const inv = c?.guestInvites.find((i) => i.id === id);
  const s = c?.sessions.find((x) => x.id === inv?.sessionId);
  if (!c || !inv || !s || s.deletedAt) return { ok: false, state: "inconnu" };
  const st = linkState(inv);
  if (st !== "valide") return { ok: false, state: st };
  if (s.archivedAt) return { ok: false, state: "archive" };
  return { ok: true, c, s, inv };
}
