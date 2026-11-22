import {
  can,
  formatSize,
  LANGUAGES,
  roleLabel,
  SESSION_MODES,
  visibleEmissions,
} from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/server/access";
import { collectifUsage, purgeTrash } from "@/lib/server/prises";
import { getStore } from "@/lib/server/store";
import { createEmission, setQuota } from "../actions";
import { ErrorBanner } from "../common";
import { CollectifNav, Visual } from "./nav";

export const metadata: Metadata = { title: "Collectif · Pod Stud" };
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ cid: string }>;
  searchParams: Promise<{ erreur?: string; bienvenue?: string }>;
}) {
  const { cid } = await params;
  const { erreur, bienvenue } = await searchParams;
  const { collectif: c, member: m } = await requireMember(cid, `/collectifs/${cid}`);
  await purgeTrash(c);
  const emissions = visibleEmissions(m, c.emissions);
  const usage = can(m, "gerer") ? await collectifUsage(c) : null;
  const quota = c.quotaGb * 1e9;
  return (
    <>
      <h1 data-testid="collectif-title">{c.name}</h1>
      <p className="hint">
        Votre rôle : <strong data-testid="my-role">{roleLabel(m.role)}</strong>
      </p>
      <CollectifNav c={c} m={m} current="emissions" />
      {bienvenue && (
        <p className="info-box" data-testid="welcome">
          Bienvenue dans {c.name} !
        </p>
      )}
      <ErrorBanner message={erreur} />
      {usage !== null && (
        <section className="card" data-testid="quota">
          <h2>Espace de stockage</h2>
          <p>
            <strong data-testid="quota-used">{formatSize(usage)}</strong> utilisés sur {c.quotaGb}{" "}
            Go
            {getStore().kind !== "s3" && " (stockage temporaire du lien de test)"}.
          </p>
          <progress max={quota} value={Math.min(usage, quota)} className="quota-bar" />
          <form action={setQuota.bind(null, cid)} className="inline">
            <label>
              Quota{" "}
              <input type="number" name="quota" min={1} max={100000} defaultValue={c.quotaGb} /> Go
            </label>{" "}
            <button type="submit" className="button secondary small">
              Modifier
            </button>
          </form>
        </section>
      )}
      <h2>Émissions</h2>
      {emissions.length ? (
        <ul className="tiles" data-testid="emissions">
          {emissions.map((e) => (
            <li key={e.id}>
              <Link
                href={`/collectifs/${cid}/emissions/${e.id}`}
                className="tile row"
                data-testid="emission-link"
              >
                <Visual c={c} e={e} size={56} />
                <span>
                  <strong>{e.name}</strong>
                  <span className="hint">
                    {c.episodes.filter((x) => x.emissionId === e.id && !x.deletedAt).length}{" "}
                    épisode(s)
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>Aucune émission pour l&apos;instant.</p>
      )}
      {can(m, "gerer") && (
        <form action={createEmission.bind(null, cid)} className="card">
          <h2>Nouvelle émission</h2>
          <label className="field">
            Nom
            <input name="name" required maxLength={80} data-testid="emission-name" />
          </label>
          <label className="field">
            Présentation (facultatif)
            <textarea name="description" maxLength={500} rows={2} />
          </label>
          <label className="field">
            Visuel (image carrée PNG, JPEG ou WebP, 2 Mo au plus)
            <input
              type="file"
              name="visuel"
              accept="image/png,image/jpeg,image/webp"
              data-testid="emission-visual-input"
            />
          </label>
          <label className="field">
            Type de session par défaut
            <select name="mode" defaultValue="audio">
              {SESSION_MODES.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Langue de transcription par défaut
            <select name="langue" defaultValue="fr">
              {LANGUAGES.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button" data-testid="emission-create">
            Créer l&apos;émission
          </button>
        </form>
      )}
    </>
  );
}
