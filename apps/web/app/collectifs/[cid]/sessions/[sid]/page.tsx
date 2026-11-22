import { can, INVITE_DAYS, LANGUAGES, linkState, SESSION_MODES } from "@pod-stud/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/server/access";
import { siteOrigin } from "@/lib/server/auth";
import { sessionPrises } from "@/lib/server/prises";
import {
  archiveSession,
  createGuestInvite,
  renameTrack,
  revokeGuestInvite,
  saveTreatment,
  trashPrise,
  trashSession,
  unarchiveSession,
  updateSession,
} from "../../../actions";
import { Crumbs, ErrorBanner, frDate, frDay } from "../../../common";
import { ArchiveForm, ConfirmSubmit, CopyButton } from "../../../ui";
import type { PostPrise } from "./Postproductions";
import { PrisesBrowser, type PriseItem } from "./PrisesBrowser";
import { postprodState } from "@/lib/server/postprod";

export const metadata: Metadata = { title: "Session · Pod Stud" };
export const dynamic = "force-dynamic";

const STATE_LABEL = { valide: "valide", revoque: "révoqué", expire: "expiré", utilise: "utilisé" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ cid: string; sid: string }>;
  searchParams: Promise<{ erreur?: string; invitation?: string; mail?: string }>;
}) {
  const { cid, sid } = await params;
  const sp = await searchParams;
  const { collectif: c, member: m } = await requireMember(
    cid,
    `/collectifs/${cid}/sessions/${sid}`,
  );
  const s = c.sessions.find((x) => x.id === sid);
  if (!s || !can(m, "voir", s.emissionId)) redirect(`/collectifs/${cid}`);
  if (s.deletedAt) redirect(`/collectifs/${cid}/corbeille`);
  const e = c.emissions.find((x) => x.id === s.emissionId);
  const ep = c.episodes.find((x) => x.id === s.episodeId);
  const record = can(m, "enregistrer", s.emissionId);
  const files = can(m, "fichiers", s.emissionId);
  const origin = await siteOrigin();
  const live = s.archivedAt ? [] : (await sessionPrises(c, s)).filter((p) => !p.deletedAt);
  const post: PostPrise[] = files
    ? [...live]
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .map((p) => ({
          key: p.key,
          number: p.number,
          recordedLabel: frDate(p.recordedAt),
          tracks: p.tracks.map((t) => {
            const st = postprodState(c, s, t.takeId);
            return {
              takeId: t.takeId,
              displayName: t.displayName,
              fileName: t.fileName,
              seconds: t.seconds,
              complete: t.complete,
              treatment: st.treatment,
              own: Boolean(c.treatments?.[t.takeId]),
              state: st.state,
              done: st.pp
                ? {
                    inputLufs: st.pp.inputLufs,
                    outputLufs: st.pp.outputLufs,
                    repaired: st.pp.repaired,
                    breaths: st.pp.breaths,
                  }
                : null,
            };
          }),
        }))
    : [];
  const prises: PriseItem[] = live.map((p) => ({
    key: p.key,
    number: p.number,
    recordedAt: p.recordedAt,
    recordedLabel: frDate(p.recordedAt),
    seconds: p.seconds,
    bytes: p.bytes,
    tracks: p.tracks.map((t) => ({
      takeId: t.takeId,
      participant: t.participant,
      displayName: t.displayName,
      fileName: t.fileName,
      seconds: t.seconds,
      complete: t.complete,
    })),
  }));

  const invites = c.guestInvites.filter((i) => i.sessionId === sid).reverse();
  const mode = SESSION_MODES.find((x) => x.key === s.mode)?.label;
  const lang = LANGUAGES.find((x) => x.key === s.language)?.label;
  return (
    <>
      <Crumbs
        items={[
          { href: `/collectifs/${cid}`, label: c.name },
          { href: `/collectifs/${cid}/emissions/${s.emissionId}`, label: e?.name ?? "Émission" },
          { href: `/collectifs/${cid}/emissions/${s.emissionId}`, label: ep?.title ?? "Épisode" },
          { label: s.name },
        ]}
      />
      <div className="title-row">
        <h1 data-testid="session-title">{s.name}</h1>
        {files && (
          <details className="menu" data-testid="session-menu">
            <summary aria-label="Plus d'actions">⋮</summary>
            <div className="menu-panel">
              {s.archivedAt ? (
                <form action={unarchiveSession.bind(null, cid, sid)}>
                  <button type="submit" className="menu-item" data-testid="session-unarchive">
                    Restaurer depuis l&apos;archive
                  </button>
                </form>
              ) : (
                <ArchiveForm name={s.name} action={archiveSession.bind(null, cid, sid)} />
              )}
              <form action={trashSession.bind(null, cid, sid)}>
                <ConfirmSubmit
                  label="Mettre la session à la corbeille"
                  confirm="Oui, à la corbeille"
                  className="menu-item"
                  testId="session-trash"
                />
              </form>
            </div>
          </details>
        )}
      </div>
      <p className="hint" data-testid="session-meta">
        Créée le {frDay(s.createdAt)} · {mode} · transcription en {lang?.toLowerCase()}
      </p>
      <ErrorBanner message={sp.erreur} />

      {s.archivedAt ? (
        <section className="advice-box" data-testid="session-archived">
          <p>
            Session archivée le {frDay(s.archivedAt)} : ses fichiers sont en archive froide. Pour
            les télécharger, restaurez-la (menu ⋮). Une fois le stockage définitif branché, la
            restauration prendra quelques heures ; sur le lien de test, elle est immédiate.
          </p>
        </section>
      ) : (
        <>
          <section className="card">
            {record ? (
              <p>
                <Link className="button" href={`/seance/${sid}`} data-testid="open-studio">
                  Ouvrir le studio d&apos;enregistrement
                </Link>{" "}
                <span className="hint">
                  Vous y faites entrer les invités et lancez les prises pour tout le monde.
                </span>
              </p>
            ) : (
              <p className="hint" data-testid="cannot-record">
                Votre rôle (Monteur) donne accès aux pistes et au montage, mais pas au lancement
                d&apos;un enregistrement.
              </p>
            )}
            {files && prises.length > 0 && (
              <p>
                <a
                  className="button secondary"
                  href={`/api/collectifs/${cid}/zip?session=${sid}`}
                  data-testid="zip-session"
                >
                  Télécharger toute la session (ZIP)
                </a>
              </p>
            )}
          </section>
          <PrisesBrowser
            cid={cid}
            sid={sid}
            prises={prises}
            files={files}
            renameTrack={renameTrack}
            trashPrise={trashPrise}
            post={post}
            emissionName={e?.name ?? "Émission"}
            saveTreatment={saveTreatment}
          />
        </>
      )}

      {record && !s.archivedAt && (
        <section className="card" id="invitations" data-testid="guest-invites">
          <h2>Invités</h2>
          <p className="hint">
            Pas besoin de compte pour les invités : chacun reçoit un lien, peut tester son micro dès
            réception, puis attend en salle d&apos;attente que vous le fassiez entrer. Ils
            n&apos;ont accès à aucun fichier.
          </p>
          {sp.invitation && (
            <p className="info-box" data-testid="guest-invite-done">
              Invitation créée.{" "}
              {sp.mail === "envoye"
                ? "L'e-mail est parti."
                : sp.mail === "test"
                  ? "Mode test : l'e-mail ne part pas encore, copiez le lien et envoyez-le vous-même (SMS, messagerie…)."
                  : sp.mail === "erreur"
                    ? "L'e-mail n'a pas pu partir : copiez le lien et envoyez-le vous-même."
                    : "Copiez le lien et envoyez-le par SMS ou messagerie."}
            </p>
          )}
          {invites.length > 0 && (
            <ul className="plain">
              {invites.map((i) => {
                const st = linkState(i);
                const link = `${origin}/invitation/${cid}.${i.id}`;
                return (
                  <li key={i.id} data-testid="guest-invite" data-state={st}>
                    <strong>{i.label}</strong>
                    {i.email && <small className="hint"> · {i.email}</small>} · lien{" "}
                    {STATE_LABEL[st]}
                    {st === "valide" && (
                      <>
                        {" "}
                        jusqu&apos;au {frDay(i.expiresAt)}
                        <br />
                        <code className="link" data-testid="guest-invite-link">
                          {link}
                        </code>{" "}
                        <CopyButton text={link} />{" "}
                        <form
                          action={revokeGuestInvite.bind(null, cid, sid, i.id)}
                          className="inline"
                        >
                          <button
                            type="submit"
                            className="linklike"
                            data-testid="guest-invite-revoke"
                          >
                            Révoquer
                          </button>
                        </form>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form action={createGuestInvite.bind(null, cid, sid)}>
            <h3>Nouvelle invitation</h3>
            <label className="field">
              Nom de l&apos;invité (pour vous y retrouver)
              <input name="label" maxLength={60} data-testid="guest-label" />
            </label>
            <label className="field">
              Adresse e-mail (facultatif : sans adresse, vous copiez le lien vous-même)
              <input type="email" name="email" data-testid="guest-email" />
            </label>
            <label className="field">
              Le lien expire dans
              <select name="jours" defaultValue="7">
                {INVITE_DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d} jour{d > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button" data-testid="guest-invite-create">
              Créer le lien d&apos;invitation
            </button>
          </form>
        </section>
      )}

      {record && !s.archivedAt && (
        <details className="card">
          <summary>
            <strong>Réglages de la session</strong>
          </summary>
          <form action={updateSession.bind(null, cid, sid)}>
            <label className="field">
              Nom
              <input name="name" defaultValue={s.name} required maxLength={100} />
            </label>
            <label className="field">
              Langue de transcription
              <select name="langue" defaultValue={s.language}>
                {LANGUAGES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Type de session
              <select name="mode" defaultValue={s.mode}>
                {SESSION_MODES.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="button secondary">
              Enregistrer
            </button>
          </form>
        </details>
      )}
    </>
  );
}
