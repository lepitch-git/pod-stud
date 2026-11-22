import { can, formatSize, formatDuration, trashDaysLeft, TRASH_DAYS } from "@pod-stud/shared";
import type { Metadata } from "next";
import { requireMember } from "@/lib/server/access";
import { collectifUsage, priseRef, purgeTrash, sessionPrises } from "@/lib/server/prises";
import { restorePrise, restoreSession } from "../../actions";
import { ErrorBanner, frDate } from "../../common";
import { CollectifNav } from "../nav";

export const metadata: Metadata = { title: "Corbeille · Pod Stud" };
export const dynamic = "force-dynamic";

/** Corbeille (ENR-20, CPT-10) : restauration possible pendant 30 jours. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ cid: string }>;
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { cid } = await params;
  const { erreur } = await searchParams;
  const { collectif: c, member: m } = await requireMember(cid, `/collectifs/${cid}/corbeille`);
  await purgeTrash(c);
  const sessions = c.sessions.filter((s) => can(m, "fichiers", s.emissionId));
  const deletedSessions = sessions.filter((s) => s.deletedAt);
  const prises = (
    await Promise.all(
      sessions
        .filter(
          (s) => !s.deletedAt && Object.keys(c.deletedPrises).some((k) => k.startsWith(`${s.id}/`)),
        )
        .map(async (s) =>
          (await sessionPrises(c, s))
            .filter((p) => c.deletedPrises[priseRef(s.id, p.key)])
            .map((p) => ({ s, p })),
        ),
    )
  ).flat();
  const usage = await collectifUsage(c);
  return (
    <>
      <h1>{c.name}</h1>
      <CollectifNav c={c} m={m} current="corbeille" />
      <ErrorBanner message={erreur} />
      <p className="hint" data-testid="trash-quota">
        Espace utilisé : {formatSize(usage)} sur {c.quotaGb} Go (la corbeille compte dans le quota
        jusqu&apos;à sa suppression définitive, {TRASH_DAYS} jours après la mise à la corbeille).
      </p>
      {deletedSessions.length === 0 && prises.length === 0 ? (
        <p data-testid="trash-empty">La corbeille est vide.</p>
      ) : (
        <ul className="plain card" data-testid="trash">
          {deletedSessions.map((s) => (
            <li key={s.id} data-testid="trash-item">
              Session <strong>{s.name}</strong> · supprimée le {frDate(s.deletedAt as string)} ·
              encore {trashDaysLeft(s.deletedAt as string)} jours{" "}
              <form action={restoreSession.bind(null, cid, s.id)} className="inline">
                <button
                  type="submit"
                  className="button secondary small"
                  data-testid="trash-restore"
                >
                  Restaurer
                </button>
              </form>
            </li>
          ))}
          {prises.map(({ s, p }) => {
            const at = c.deletedPrises[priseRef(s.id, p.key)] as string;
            return (
              <li key={`${s.id}/${p.key}`} data-testid="trash-item">
                Prise {p.number} de <strong>{s.name}</strong> ({formatDuration(p.seconds)},{" "}
                {formatSize(p.bytes)}) · supprimée le {frDate(at)} · encore {trashDaysLeft(at)}{" "}
                jours{" "}
                <form
                  action={restorePrise.bind(null, cid, s.id, p.key, p.number)}
                  className="inline"
                >
                  <button
                    type="submit"
                    className="button secondary small"
                    data-testid="trash-restore"
                  >
                    Restaurer
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
