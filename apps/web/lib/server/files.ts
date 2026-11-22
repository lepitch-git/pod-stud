import "server-only";
import { can, filePart } from "@pod-stud/shared";
import { currentUser } from "./auth";
import { audit, getCollectif, memberOf, updateCollectif, type Collectif, type Session } from "./db";
import { errorResponse } from "./http";
import { sessionPrises, type PriseView } from "./prises";

/** Contrôle d'accès aux fichiers d'un collectif (ENR-21) : membre connecté avec le droit « fichiers ». */
export async function filesContext(req: Request, cid: string) {
  const user = await currentUser();
  const c = await getCollectif(cid);
  const m = c ? memberOf(c, user?.id) : null;
  if (!user || !c || !m)
    return {
      error: errorResponse(
        req,
        403,
        "Ces fichiers sont réservés aux membres du collectif. Connectez-vous avec votre adresse e-mail de membre.",
      ),
    };
  return { user, c, m };
}

export function sessionFilesError(
  req: Request,
  c: Collectif,
  m: NonNullable<ReturnType<typeof memberOf>>,
  s: Session | undefined,
) {
  if (!s || s.deletedAt) return errorResponse(req, 404, "Cette session n'existe plus.");
  if (!can(m, "fichiers", s.emissionId))
    return errorResponse(req, 403, "Votre rôle ne donne pas accès aux fichiers de cette émission.");
  if (s.archivedAt)
    return errorResponse(
      req,
      409,
      `La session « ${s.name} » est archivée : restaurez-la depuis sa page avant de télécharger ses fichiers.`,
    );
  return null;
}

/** Arborescence d'export : Émission/Épisode/Session/fichier.wav. */
export function folderOf(c: Collectif, s: Session) {
  const e = c.emissions.find((x) => x.id === s.emissionId)?.name ?? "Emission";
  const ep = c.episodes.find((x) => x.id === s.episodeId)?.title ?? "Episode";
  return `${filePart(e)}/${filePart(ep)}/${filePart(s.name)}`;
}

export async function livePrises(c: Collectif, s: Session): Promise<PriseView[]> {
  return (await sessionPrises(c, s)).filter((p) => !p.deletedAt);
}

export async function logDownload(cid: string, by: string, what: string) {
  await updateCollectif(cid, (doc) => audit(doc, by, `Téléchargement : ${what}`)).catch(
    () => undefined,
  );
}
