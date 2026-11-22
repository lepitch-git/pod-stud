import { can, LANGUAGES, SESSION_MODES } from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/server/access";
import { createEpisode, createSession, updateEmission } from "../../../actions";
import { Crumbs, ErrorBanner, frDay } from "../../../common";
import { CollectifNav, Visual } from "../../nav";

export const metadata: Metadata = { title: "Émission · Pod Stud" };
export const dynamic = "force-dynamic";

const modeLabel = (k: string) => SESSION_MODES.find((m) => m.key === k)?.label ?? k;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ cid: string; eid: string }>;
  searchParams: Promise<{ erreur?: string; vue?: string; enregistre?: string }>;
}) {
  const { cid, eid } = await params;
  const { erreur, vue, enregistre } = await searchParams;
  const { collectif: c, member: m } = await requireMember(
    cid,
    `/collectifs/${cid}/emissions/${eid}`,
  );
  const e = c.emissions.find((x) => x.id === eid);
  if (!e || !can(m, "voir", eid)) redirect(`/collectifs/${cid}`);
  const archived = vue === "archive";
  const episodes = c.episodes
    .filter((x) => x.emissionId === eid && !x.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sessionsOf = (epId: string) =>
    c.sessions
      .filter((s) => s.episodeId === epId && !s.deletedAt && !!s.archivedAt === archived)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const record = can(m, "enregistrer", eid);
  const files = can(m, "fichiers", eid);
  return (
    <>
      <Crumbs items={[{ href: `/collectifs/${cid}`, label: c.name }, { label: e.name }]} />
      <header className="emission-head">
        <Visual c={c} e={e} size={96} />
        <div>
          <h1 data-testid="emission-title">{e.name}</h1>
          {e.description && <p className="lead">{e.description}</p>}
          {files && (
            <a
              className="button secondary small"
              href={`/api/collectifs/${cid}/zip?emission=${eid}`}
              data-testid="zip-emission"
            >
              Tout télécharger (ZIP)
            </a>
          )}
        </div>
      </header>
      <CollectifNav c={c} m={m} current="emissions" />
      <ErrorBanner message={erreur} />
      {enregistre && <p className="info-box">Réglages enregistrés.</p>}

      <nav className="tabs small" aria-label="Filtre des sessions">
        <Link
          href={`?vue=actif`}
          className={archived ? "tab" : "tab current"}
          data-testid="filter-active"
        >
          Actif
        </Link>
        <Link
          href={`?vue=archive`}
          className={archived ? "tab current" : "tab"}
          data-testid="filter-archived"
        >
          Archivé
        </Link>
      </nav>

      {episodes.length === 0 && <p>Aucun épisode pour l&apos;instant.</p>}
      {episodes.map((ep) => {
        const sessions = sessionsOf(ep.id);
        if (archived && !sessions.length) return null;
        return (
          <section className="card episode" key={ep.id} data-testid="episode">
            <h2>
              {ep.title}{" "}
              {files && !archived && (
                <a
                  className="small-link"
                  href={`/api/collectifs/${cid}/zip?episode=${ep.id}`}
                  data-testid="zip-episode"
                >
                  ZIP de l&apos;épisode
                </a>
              )}
            </h2>
            {sessions.length ? (
              <ul className="plain sessions">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link href={`/collectifs/${cid}/sessions/${s.id}`} data-testid="session-link">
                      {s.name}
                    </Link>{" "}
                    <small className="hint">
                      · {frDay(s.createdAt)} · {modeLabel(s.mode)}
                      {s.archivedAt && ` · archivée le ${frDay(s.archivedAt)}`}
                    </small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Pas encore de session {archived ? "archivée" : "active"}.</p>
            )}
            {record && !archived && (
              <details>
                <summary data-testid="session-new">Nouvelle session</summary>
                <form action={createSession.bind(null, cid, ep.id)}>
                  <label className="field">
                    Nom de la session
                    <input
                      name="name"
                      required
                      maxLength={100}
                      placeholder="Par exemple : Enregistrement du 3 décembre"
                      data-testid="session-name"
                    />
                  </label>
                  <label className="field">
                    Langue de transcription
                    <select name="langue" defaultValue={e.defaultLanguage}>
                      {LANGUAGES.map((x) => (
                        <option key={x.key} value={x.key}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="choices">
                    <legend>Type de session</legend>
                    {SESSION_MODES.map((x) => (
                      <label className="radio-line" key={x.key}>
                        <input
                          type="radio"
                          name="mode"
                          value={x.key}
                          defaultChecked={x.key === e.defaultMode}
                          data-testid={`session-mode-${x.key}`}
                        />
                        {x.label}
                      </label>
                    ))}
                  </fieldset>
                  <button type="submit" className="button" data-testid="session-create">
                    Créer la session
                  </button>
                </form>
              </details>
            )}
          </section>
        );
      })}

      {record && !archived && (
        <form action={createEpisode.bind(null, cid, eid)} className="card">
          <h2>Nouvel épisode</h2>
          <label className="field">
            Titre
            <input name="title" required maxLength={100} data-testid="episode-title" />
          </label>
          <button type="submit" className="button" data-testid="episode-create">
            Créer l&apos;épisode
          </button>
        </form>
      )}

      {can(m, "gerer") && (
        <details className="card">
          <summary>
            <strong>Réglages de l&apos;émission</strong>
          </summary>
          <form action={updateEmission.bind(null, cid, eid)}>
            <label className="field">
              Nom
              <input name="name" defaultValue={e.name} required maxLength={80} />
            </label>
            <label className="field">
              Présentation
              <textarea name="description" defaultValue={e.description} maxLength={500} rows={2} />
            </label>
            <label className="field">
              Nouveau visuel (PNG, JPEG ou WebP, 2 Mo au plus)
              <input type="file" name="visuel" accept="image/png,image/jpeg,image/webp" />
            </label>
            <label className="field">
              Type de session par défaut
              <select name="mode" defaultValue={e.defaultMode}>
                {SESSION_MODES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Langue de transcription par défaut
              <select name="langue" defaultValue={e.defaultLanguage}>
                {LANGUAGES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button secondary">
              Enregistrer les réglages
            </button>
          </form>
        </details>
      )}
    </>
  );
}
