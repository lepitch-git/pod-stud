"use client";

import { formatSize, formatDuration } from "@pod-stud/shared";
import { ConfirmSubmit, useRemembered } from "../../../ui";
import { Postproductions, type PostPrise } from "./Postproductions";

export interface PriseItem {
  key: string;
  number: number;
  recordedAt: string;
  recordedLabel: string;
  seconds: number;
  bytes: number;
  tracks: {
    takeId: string;
    participant: string;
    displayName: string;
    fileName: string;
    seconds: number;
    complete: boolean;
  }[];
}

type Act = (...args: never[]) => Promise<void>;

/**
 * Prises d'une session (CPT-12) : onglets Enregistrements / Postproductions, tri par date,
 * vue grille ou liste ; les choix sont mémorisés dans le navigateur.
 */
export function PrisesBrowser({
  cid,
  sid,
  prises,
  files,
  renameTrack,
  trashPrise,
  post,
  emissionName,
  saveTreatment,
}: {
  cid: string;
  sid: string;
  prises: PriseItem[];
  files: boolean;
  renameTrack: Act;
  trashPrise: Act;
  /** Pistes et traitements (étape 6a), pour les rôles qui ont accès aux fichiers. */
  post: PostPrise[];
  emissionName: string;
  saveTreatment: Act;
}) {
  const [tab, setTab] = useRemembered<"enregistrements" | "postproductions">(
    "podstud:session-onglet",
    "enregistrements",
    ["enregistrements", "postproductions"],
  );
  const [sort, setSort] = useRemembered<"recent" | "ancien">("podstud:session-tri", "recent", [
    "recent",
    "ancien",
  ]);
  const [view, setView] = useRemembered<"liste" | "grille">("podstud:session-vue", "liste", [
    "liste",
    "grille",
  ]);
  const sorted = [...prises].sort((a, b) =>
    sort === "recent"
      ? b.recordedAt.localeCompare(a.recordedAt)
      : a.recordedAt.localeCompare(b.recordedAt),
  );
  const rename = renameTrack as unknown as (
    cid: string,
    sid: string,
    take: string,
    fd: FormData,
  ) => Promise<void>;
  const trash = trashPrise as unknown as (
    cid: string,
    sid: string,
    key: string,
    n: number,
  ) => Promise<void>;
  return (
    <section className="card" data-testid="prises-browser">
      <div className="toolbar">
        <nav className="tabs small" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "enregistrements"}
            className={tab === "enregistrements" ? "tab current" : "tab"}
            onClick={() => setTab("enregistrements")}
            data-testid="tab-recordings"
          >
            Enregistrements ({prises.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "postproductions"}
            className={tab === "postproductions" ? "tab current" : "tab"}
            onClick={() => setTab("postproductions")}
            data-testid="tab-postproductions"
          >
            Postproductions (
            {post.flatMap((p) => p.tracks).filter((t) => t.state === "a-jour").length})
          </button>
        </nav>
        {tab === "enregistrements" && (
          <span className="toolbar-right">
            <label>
              Trier{" "}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as "recent")}
                data-testid="sort"
              >
                <option value="recent">Plus récentes d&apos;abord</option>
                <option value="ancien">Plus anciennes d&apos;abord</option>
              </select>
            </label>{" "}
            <button
              type="button"
              className="button secondary small"
              aria-pressed={view === "grille"}
              onClick={() => setView(view === "grille" ? "liste" : "grille")}
              data-testid="view-toggle"
            >
              {view === "grille" ? "Vue liste" : "Vue grille"}
            </button>
          </span>
        )}
      </div>
      {tab === "postproductions" ? (
        files ? (
          <Postproductions
            cid={cid}
            sid={sid}
            prises={post}
            emissionName={emissionName}
            save={
              saveTreatment as unknown as (
                cid: string,
                sid: string,
                take: string,
                prise: string[],
                fd: FormData,
              ) => Promise<void>
            }
          />
        ) : (
          <p className="hint" data-testid="postproductions-empty">
            Votre rôle ne donne pas accès aux fichiers de cette émission.
          </p>
        )
      ) : sorted.length === 0 ? (
        <p className="hint" data-testid="prises-empty">
          Aucune prise pour l&apos;instant : ouvrez le studio d&apos;enregistrement pour lancer la
          première.
        </p>
      ) : (
        <ul className={`prises ${view}`} data-testid="prises" data-view={view} data-sort={sort}>
          {sorted.map((p) => (
            <li key={p.key} className="prise" data-testid="prise" data-number={p.number}>
              <h3>
                Prise {p.number}{" "}
                <small className="hint">
                  · {p.recordedLabel} · {formatDuration(p.seconds)} · {formatSize(p.bytes)}
                </small>
              </h3>
              <ul className="plain">
                {p.tracks.map((t) => (
                  <li key={t.takeId} data-testid="track" data-take={t.takeId}>
                    <strong data-testid="track-name">{t.displayName}</strong>
                    {t.displayName !== t.participant && (
                      <small className="hint"> (saisi : {t.participant})</small>
                    )}{" "}
                    · {formatDuration(t.seconds)}
                    {!t.complete && <em className="tag"> envoi incomplet</em>}
                    {files && (
                      <>
                        <br />
                        <a
                          href={`/api/collectifs/${cid}/pistes/${t.takeId}`}
                          data-testid="track-download"
                        >
                          {t.fileName}
                        </a>
                        <details className="inline-details">
                          <summary data-testid="track-rename">Corriger le nom</summary>
                          <form action={rename.bind(null, cid, sid, t.takeId)} className="inline">
                            <input
                              name="name"
                              defaultValue={t.displayName}
                              maxLength={60}
                              aria-label="Nom de l'intervenant"
                              data-testid="track-rename-input"
                            />{" "}
                            <button
                              type="submit"
                              className="button secondary small"
                              data-testid="track-rename-save"
                            >
                              Enregistrer
                            </button>
                          </form>
                        </details>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {files && (
                <p className="prise-actions">
                  <a
                    className="button secondary small"
                    href={`/api/collectifs/${cid}/zip?session=${sid}&prise=${encodeURIComponent(p.key)}`}
                    data-testid="zip-prise"
                  >
                    ZIP de la prise
                  </a>{" "}
                  <form action={trash.bind(null, cid, sid, p.key, p.number)} className="inline">
                    <ConfirmSubmit
                      label="Mettre à la corbeille"
                      confirm="Oui, à la corbeille"
                      testId="prise-trash"
                    />
                  </form>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
