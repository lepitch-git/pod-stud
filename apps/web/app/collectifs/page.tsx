import { roleLabel } from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";
import { getCollectif, memberOf } from "@/lib/server/db";
import { testMode } from "@/lib/server/mail";
import { createCollectif, logout, updateProfile } from "./actions";
import { ErrorBanner } from "./common";

export const metadata: Metadata = { title: "Mes collectifs · Pod Stud" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; refus?: string }>;
}) {
  const { erreur, refus } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/connexion?suite=/collectifs");
  const list = (await Promise.all(user.collectifs.map(getCollectif))).filter(
    (c): c is NonNullable<typeof c> => !!c && !!memberOf(c, user.id),
  );
  return (
    <>
      <h1>Mes collectifs</h1>
      <p className="lead">
        Connecté en tant que <strong data-testid="me-email">{user.email}</strong>.
      </p>
      {testMode() && (
        <p className="advice-box" data-testid="temp-warning">
          Lien de test : les e-mails ne partent pas encore (les liens s&apos;affichent à
          l&apos;écran) et, sans stockage définitif, les collectifs et les enregistrements peuvent
          disparaître à tout moment.
        </p>
      )}
      <ErrorBanner message={erreur} />
      {refus && (
        <p className="error-box" data-testid="access-denied">
          Vous n&apos;avez pas accès à ce collectif avec cette adresse.
        </p>
      )}
      {list.length > 0 ? (
        <ul className="tiles" data-testid="collectifs">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/collectifs/${c.id}`} className="tile" data-testid="collectif-link">
                <strong>{c.name}</strong>
                <span className="hint">
                  {roleLabel(memberOf(c, user.id)?.role ?? "monteur")} · {c.emissions.length}{" "}
                  émission{c.emissions.length > 1 ? "s" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="no-collectif">
          Vous ne faites encore partie d&apos;aucun collectif. Créez le vôtre, ou demandez à un
          administrateur de vous inviter.
        </p>
      )}
      <form action={createCollectif} className="card">
        <h2>Créer un collectif</h2>
        <label className="field">
          Nom du collectif
          <input name="name" required maxLength={80} data-testid="collectif-name" />
        </label>
        <button type="submit" className="button" data-testid="collectif-create">
          Créer
        </button>
      </form>
      <form action={updateProfile} className="card">
        <h2>Mon profil</h2>
        <label className="field">
          Mon nom (affiché aux autres membres et utilisé dans les séances)
          <input name="name" defaultValue={user.name} maxLength={60} data-testid="profile-name" />
        </label>
        <button type="submit" className="button secondary">
          Enregistrer
        </button>
      </form>
      <form action={logout}>
        <button type="submit" className="linklike" data-testid="logout">
          Se déconnecter
        </button>
      </form>
    </>
  );
}
