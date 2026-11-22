import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lien envoyé · Pod Stud" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; lien?: string }>;
}) {
  const { email, lien } = await searchParams;
  return (
    <>
      <h1>Vérifiez votre boîte e-mail</h1>
      {lien ? (
        <section className="advice-box" data-testid="login-test-mode">
          <p>
            <strong>Mode test</strong> : l&apos;envoi d&apos;e-mails n&apos;est pas encore branché
            sur ce lien de test, donc le lien de connexion s&apos;affiche ici au lieu d&apos;arriver
            par e-mail.
          </p>
          <p>
            <a className="button" href={lien} data-testid="login-test-link">
              Me connecter en tant que {email}
            </a>
          </p>
        </section>
      ) : (
        <p className="lead" data-testid="login-sent">
          Un lien de connexion vient de partir vers <strong>{email}</strong>. Il est valable 20
          minutes. Pensez à regarder dans les indésirables.
        </p>
      )}
    </>
  );
}
