import { SESSION_MODES } from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveGuestInvite } from "@/lib/server/invitations";
import { Visual } from "@/app/collectifs/[cid]/nav";

export const metadata: Metadata = { title: "Invitation · Pod Stud" };
export const dynamic = "force-dynamic";

/** Page d'arrivée d'un invité (ENR-17) : sans compte, test du matériel, puis salle d'attente. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolveGuestInvite(token);
  if (!r.ok) redirect(`/lien/${r.state}`);
  const { c, s } = r;
  const e = c.emissions.find((x) => x.id === s.emissionId);
  const mode = SESSION_MODES.find((m) => m.key === s.mode);
  return (
    <>
      <header className="emission-head">
        {e && <Visual c={c} e={e} size={96} />}
        <div>
          <p className="hint">{c.name}</p>
          <h1 data-testid="invitation-title">{e?.name}</h1>
          <p className="lead">
            Vous êtes invité à la session <strong>{s.name}</strong>.
          </p>
        </div>
      </header>
      <section className="card">
        <h2>1. Testez votre équipement</h2>
        <p>
          Type de session : <strong data-testid="invitation-mode">{mode?.label}</strong>. Faites le
          test dès maintenant, la veille par exemple : il vérifie votre micro, votre casque
          {s.mode !== "audio" && ", votre caméra"} et votre connexion.
        </p>
        <p>
          <Link
            className="button secondary"
            href={`/test-equipement?mode=${s.mode}`}
            data-testid="invitation-test"
          >
            Tester mon équipement
          </Link>
        </p>
      </section>
      <section className="card">
        <h2>2. Rejoignez la session</h2>
        <p>
          À l&apos;heure prévue, entrez en salle d&apos;attente : l&apos;hôte vous fera entrer. Pas
          besoin de compte.
        </p>
        <p>
          <Link
            className="button"
            href={`/seance/${s.id}?invitation=${token}`}
            data-testid="invitation-join"
          >
            Rejoindre la session
          </Link>
        </p>
      </section>
    </>
  );
}
