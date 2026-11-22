import { can } from "@pod-stud/shared";
import Link from "next/link";
import type { Collectif, Member } from "@/lib/server/db";

/** Onglets du collectif. */
export function CollectifNav({
  c,
  m,
  current,
}: {
  c: Collectif;
  m: Member;
  current: "emissions" | "membres" | "corbeille" | "journal";
}) {
  const tabs = [
    { key: "emissions", href: `/collectifs/${c.id}`, label: "Émissions", show: true },
    { key: "membres", href: `/collectifs/${c.id}/membres`, label: "Membres", show: true },
    {
      key: "corbeille",
      href: `/collectifs/${c.id}/corbeille`,
      label: "Corbeille",
      show: c.emissions.some((e) => can(m, "fichiers", e.id)),
    },
    {
      key: "journal",
      href: `/collectifs/${c.id}/journal`,
      label: "Journal",
      show: can(m, "gerer"),
    },
  ];
  return (
    <nav className="tabs" aria-label="Sections du collectif">
      {tabs
        .filter((t) => t.show)
        .map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={t.key === current ? "tab current" : "tab"}
            aria-current={t.key === current ? "page" : undefined}
            data-testid={`tab-${t.key}`}
          >
            {t.label}
          </Link>
        ))}
    </nav>
  );
}

export function Visual({
  c,
  e,
  size = 72,
}: {
  c: Collectif;
  e: Collectif["emissions"][number];
  size?: number;
}) {
  return e.imageType ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/collectifs/${c.id}/emissions/${e.id}/visuel?v=${e.imageVersion ?? 1}`}
      alt={`Visuel de ${e.name}`}
      width={size}
      height={size}
      className="visual"
      data-testid="emission-visual"
    />
  ) : (
    <span className="visual placeholder" style={{ width: size, height: size }} aria-hidden>
      {e.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
