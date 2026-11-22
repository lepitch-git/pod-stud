import Link from "next/link";

const steps = [
  { n: 1, title: "Socle du projet et cahier de recette", state: "livré" },
  { n: 2, title: "Salle d'attente et test micro / vidéo", state: "livré" },
  {
    n: 3,
    title: "Enregistrement local résistant aux coupures, envoi progressif",
    state: "livré",
  },
  { n: 4, title: "Démarrage simultané et alignement sans clap", state: "en cours" },
  { n: 5, title: "Collectif, émissions, épisodes, sessions, invitations", state: "à venir" },
  { n: 6, title: "Studio : traitements, presets, transcription, montage", state: "à venir" },
];

export default function Home() {
  return (
    <>
      <h1>Studio d&apos;enregistrement à distance</h1>
      <p className="lead">
        Chaque participant est enregistré sur sa propre machine, en pleine qualité, et son
        enregistrement est envoyé au fil de l&apos;eau : une coupure réseau ne fait rien perdre.
      </p>
      <p>
        <Link className="button" href="/test-equipement">
          Tester mon équipement
        </Link>{" "}
        <Link className="button secondary" href="/enregistrement">
          Enregistrement d&apos;essai
        </Link>{" "}
        <Link className="button secondary" href="/seance/nouvelle">
          Créer une séance d&apos;essai
        </Link>{" "}
        <Link href="/diagnostic">Diagnostic navigateur</Link>
      </p>
      <h2>Avancement</h2>
      <ol className="steps" data-testid="steps">
        {steps.map((s) => (
          <li key={s.n}>
            <span>{s.title}</span>{" "}
            <em className={`tag tag-${s.state.replace(" ", "-")}`}>{s.state}</em>
          </li>
        ))}
      </ol>
    </>
  );
}
