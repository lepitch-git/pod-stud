import Link from "next/link";

/** Message d'erreur transmis par une action (paramètre ?erreur=). */
export function ErrorBanner({ message }: { message?: string }) {
  return message ? (
    <p className="error-box" role="alert" data-testid="form-error">
      {message}
    </p>
  ) : null;
}

/** Fil d'Ariane : Collectif › Émission › Épisode › Session. */
export function Crumbs({ items }: { items: { href?: string; label: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Fil d'Ariane" data-testid="crumbs">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && " › "}
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export const frDate = (iso: string | number) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });

export const frDay = (iso: string | number) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
