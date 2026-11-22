import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requestLogin } from "@/app/collectifs/actions";
import { ErrorBanner } from "@/app/collectifs/common";
import { currentUser, safeNext } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Connexion · Pod Stud" };
export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ suite?: string; erreur?: string }>;
}) {
  const { suite, erreur } = await searchParams;
  if (await currentUser()) redirect(safeNext(suite));
  return (
    <>
      <h1>Connexion des membres</h1>
      <p className="lead">
        Pas de mot de passe : saisissez votre adresse e-mail, vous recevez un lien de connexion
        valable 20 minutes. Les invités d&apos;une émission n&apos;ont pas besoin de compte.
      </p>
      <ErrorBanner message={erreur} />
      <form action={requestLogin} className="card">
        <input type="hidden" name="suite" value={safeNext(suite)} />
        <label className="field">
          Adresse e-mail
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            data-testid="login-email"
          />
        </label>
        <button type="submit" className="button" data-testid="login-submit">
          Recevoir mon lien de connexion
        </button>
      </form>
    </>
  );
}
