import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Lien inutilisable · Pod Stud" };

const MESSAGES: Record<string, string> = {
  revoque:
    "Ce lien d'invitation a été révoqué par l'équipe de l'émission. Demandez-lui un nouveau lien.",
  expire: "Ce lien d'invitation a expiré. Demandez un nouveau lien à l'équipe de l'émission.",
  utilise:
    "Ce lien d'invitation a déjà servi. Connectez-vous avec votre adresse e-mail pour retrouver le collectif.",
  connexion:
    "Ce lien de connexion n'est plus valable (il ne dure que 20 minutes). Demandez-en un nouveau.",
  archive: "Cette session est archivée : on ne peut plus la rejoindre.",
  inconnu:
    "Ce lien n'est pas valide. Vérifiez qu'il a été copié en entier, ou demandez un nouveau lien.",
};

export default async function Page({ params }: { params: Promise<{ etat: string }> }) {
  const { etat } = await params;
  return (
    <>
      <h1>Ce lien ne fonctionne pas</h1>
      <p className="error-box" data-testid="link-state" data-state={etat}>
        {MESSAGES[etat] ?? MESSAGES.inconnu}
      </p>
      <p>
        <Link href="/connexion">Connexion des membres</Link> · <Link href="/">Accueil</Link>
      </p>
    </>
  );
}
