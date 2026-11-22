import type { Metadata } from "next";
import { RecordingStudio } from "./RecordingStudio";

export const metadata: Metadata = { title: "Enregistrement d'essai · Pod Stud" };

export default function Page() {
  return (
    <>
      <h1>Enregistrement d&apos;essai</h1>
      <p className="lead">
        Votre voix est enregistrée sur cet appareil en pleine qualité (WAV 24 bits), puis envoyée au
        serveur toutes les {5} secondes. Si la connexion coupe ou si l&apos;onglet se ferme, rien
        n&apos;est perdu : l&apos;envoi reprend tout seul.
      </p>
      <RecordingStudio />
    </>
  );
}
