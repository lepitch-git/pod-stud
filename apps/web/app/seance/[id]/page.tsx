import { can } from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { collectifOfSession, getCollectif, memberOf } from "@/lib/server/db";
import { resolveGuestInvite } from "@/lib/server/invitations";
import { SessionRoom } from "./SessionRoom";

export const metadata: Metadata = { title: "Séance · Pod Stud" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hote?: string; invitation?: string }>;
}) {
  const { id } = await params;
  const { hote, invitation } = await searchParams;
  const cid = await collectifOfSession(id);
  // Séance d'essai libre (étape 4), hors collectif.
  if (!cid) return <SessionRoom sessionId={id} host={hote === "1"} />;

  const c = await getCollectif(cid);
  const s = c?.sessions.find((x) => x.id === id);
  if (!c || !s || s.deletedAt) redirect("/lien/inconnu");
  if (s.archivedAt) redirect("/lien/archive");
  const title = `${c.emissions.find((e) => e.id === s.emissionId)?.name ?? ""} · ${s.name}`;

  // Invité : lien d'invitation valide, sans compte (ENR-17).
  if (invitation) {
    const r = await resolveGuestInvite(invitation);
    if (!r.ok) redirect(`/lien/${r.state}`);
    if (r.s.id !== id) redirect("/lien/inconnu");
    return (
      <SessionRoom
        sessionId={id}
        host={false}
        invitation={invitation}
        mode={s.mode}
        title={title}
      />
    );
  }

  const user = await currentUser();
  if (!user) redirect(`/connexion?suite=${encodeURIComponent(`/seance/${id}`)}`);
  const m = memberOf(c, user.id);
  if (!can(m, "voir", s.emissionId)) redirect("/collectifs?refus=1");
  const sessionPage = `/collectifs/${cid}/sessions/${id}`;
  if (!can(m, "enregistrer", s.emissionId))
    return (
      <>
        <h1>{title}</h1>
        <p className="advice-box" data-testid="room-cannot-record">
          Votre rôle (Monteur) ne permet pas de lancer un enregistrement. Vous retrouvez les pistes
          de cette session et le montage depuis sa page.
        </p>
        <p>
          <Link className="button" href={sessionPage}>
            Aller à la page de la session
          </Link>
        </p>
      </>
    );
  return (
    <SessionRoom
      sessionId={id}
      host
      defaultName={user.name}
      mode={s.mode}
      title={title}
      manageHref={sessionPage}
    />
  );
}
