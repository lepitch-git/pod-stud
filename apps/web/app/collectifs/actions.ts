"use server";

import {
  DAY_MS,
  INVITE_DAYS,
  isValidEmail,
  LANGUAGES,
  normalizeEmail,
  normalizeTreatment,
  PRESETS,
  roleLabel,
  ROLES,
  SESSION_MODES,
  type Role,
  type SessionKind,
  type Treatment,
} from "@pod-stud/shared";
import { redirect } from "next/navigation";
import { requireAction } from "@/lib/server/access";
import { sessionTakes } from "@/lib/server/align";
import {
  clearSessionCookie,
  currentUser,
  LOGIN_TTL_MS,
  randomToken,
  safeNext,
  sign,
  siteOrigin,
} from "@/lib/server/auth";
import {
  audit,
  createCollectif as createCollectifDoc,
  getCollectif,
  type Collectif,
  indexSession,
  newId,
  newSessionId,
  removeUserFromCollectif,
  saveUser,
  updateCollectif,
  visualKey,
} from "@/lib/server/db";
import { sendMail } from "@/lib/server/mail";
import { priseRef } from "@/lib/server/prises";
import { getStore } from "@/lib/server/store";

const str = (fd: FormData, k: string, max = 120) =>
  String(fd.get(k) ?? "")
    .trim()
    .slice(0, max);

/** Renvoie sur la page avec un message d'erreur lisible. */
function fail(path: string, message: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}erreur=${encodeURIComponent(message)}`);
}

async function guard<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirection de Next
    fail(path, e instanceof Error ? e.message : "Action impossible.");
  }
}

const mode = (v: string): SessionKind =>
  SESSION_MODES.some((m) => m.key === v) ? (v as SessionKind) : "audio";
const language = (v: string) => (LANGUAGES.some((l) => l.key === v) ? v : "fr");
const days = (v: string) => (INVITE_DAYS.includes(Number(v)) ? Number(v) : 7);

// ——— Connexion ———

export async function requestLogin(fd: FormData) {
  const email = normalizeEmail(str(fd, "email", 200));
  const next = safeNext(str(fd, "suite", 300));
  if (!isValidEmail(email))
    fail(`/connexion?suite=${encodeURIComponent(next)}`, "Adresse e-mail invalide.");
  const token = sign({ purpose: "connexion", email, exp: Date.now() + LOGIN_TTL_MS, next });
  const link = `${await siteOrigin()}/connexion/verifier?jeton=${token}`;
  const r = await sendMail({
    to: email,
    subject: "Votre lien de connexion à Pod Stud",
    text: "Bonjour,\n\nCliquez sur le bouton ci-dessous pour vous connecter à Pod Stud. Ce lien est valable 20 minutes.",
    link,
    button: "Me connecter",
  });
  if (r === "erreur") fail("/connexion", "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
  const q = new URLSearchParams({ email });
  if (r === "test") q.set("lien", link);
  redirect(`/connexion/envoye?${q}`);
}

export async function logout() {
  await clearSessionCookie();
  redirect("/");
}

export async function updateProfile(fd: FormData) {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  user.name = str(fd, "name", 60) || user.name;
  await saveUser(user);
  redirect("/collectifs");
}

// ——— Collectif ———

export async function createCollectif(fd: FormData) {
  const user = await currentUser();
  if (!user) redirect("/connexion");
  const name = str(fd, "name", 80);
  if (!name) fail("/collectifs", "Donnez un nom au collectif.");
  const c = await createCollectifDoc(name, user);
  redirect(`/collectifs/${c.id}`);
}

export async function setQuota(cid: string, fd: FormData) {
  const path = `/collectifs/${cid}`;
  await guard(path, async () => {
    const { user } = await requireAction(cid, "gerer");
    const q = Math.round(Number(str(fd, "quota", 10)));
    if (!(q >= 1 && q <= 100000)) throw new Error("Quota entre 1 et 100 000 Go.");
    await updateCollectif(cid, (c) => {
      c.quotaGb = q;
      audit(c, user.email, `Quota fixé à ${q} Go`);
    });
  });
  redirect(path);
}

// ——— Membres ———

export async function inviteMember(cid: string, fd: FormData) {
  const path = `/collectifs/${cid}/membres`;
  const email = normalizeEmail(str(fd, "email", 200));
  const role = str(fd, "role", 20) as Role;
  const emissions = fd.getAll("emissions").map(String);
  const all = fd.get("toutes") === "1" || role === "admin";
  await guard(path, async () => {
    const { user, collectif } = await requireAction(cid, "gerer");
    if (!isValidEmail(email)) throw new Error("Adresse e-mail invalide.");
    if (!ROLES.some((r) => r.key === role) || role === "proprietaire")
      throw new Error("Rôle invalide.");
    if (collectif.members.some((m) => m.email === email))
      throw new Error("Cette personne est déjà membre du collectif.");
    if (!all && !emissions.length) throw new Error("Choisissez au moins une émission.");
    const id = randomToken();
    const expiresAt = new Date(Date.now() + days(str(fd, "jours", 3)) * DAY_MS).toISOString();
    await updateCollectif(cid, (c) => {
      c.memberInvites.push({
        id,
        email,
        role,
        emissions: all ? "*" : emissions.filter((e) => c.emissions.some((x) => x.id === e)),
        createdAt: new Date().toISOString(),
        expiresAt,
      });
      audit(c, user.email, `Invitation de ${email} comme ${roleLabel(role)}`);
    });
    const link = `${await siteOrigin()}/rejoindre/${cid}.${id}`;
    await sendMail({
      to: email,
      subject: `Invitation à rejoindre ${collectif.name} sur Pod Stud`,
      text: `Bonjour,\n\n${user.name || user.email} vous invite à rejoindre le collectif « ${collectif.name} » sur Pod Stud, comme ${roleLabel(role)}.`,
      link,
      button: "Rejoindre le collectif",
    });
  });
  redirect(`${path}?invite=1`);
}

export async function revokeMemberInvite(cid: string, id: string) {
  const path = `/collectifs/${cid}/membres`;
  await guard(path, async () => {
    const { user } = await requireAction(cid, "gerer");
    await updateCollectif(cid, (c) => {
      const inv = c.memberInvites.find((i) => i.id === id);
      if (inv && !inv.revokedAt) {
        inv.revokedAt = new Date().toISOString();
        audit(c, user.email, `Invitation de ${inv.email} révoquée`);
      }
    });
  });
  redirect(path);
}

export async function changeMember(cid: string, userId: string, fd: FormData) {
  const path = `/collectifs/${cid}/membres`;
  await guard(path, async () => {
    const { user, member: me } = await requireAction(cid, "gerer");
    const role = str(fd, "role", 20) as Role;
    if (!ROLES.some((r) => r.key === role)) throw new Error("Rôle invalide.");
    if (role === "proprietaire" && me.role !== "proprietaire")
      throw new Error("Seul un propriétaire peut nommer un autre propriétaire.");
    const all = fd.get("toutes") === "1" || role === "admin" || role === "proprietaire";
    const emissions = fd.getAll("emissions").map(String);
    await updateCollectif(cid, (c) => {
      const m = c.members.find((x) => x.userId === userId);
      if (!m) throw new Error("Membre introuvable.");
      if (m.role === "proprietaire" && me.role !== "proprietaire")
        throw new Error("Seul un propriétaire peut modifier un propriétaire.");
      if (
        m.role === "proprietaire" &&
        role !== "proprietaire" &&
        c.members.filter((x) => x.role === "proprietaire").length === 1
      )
        throw new Error("Le collectif doit garder au moins un propriétaire.");
      const before = roleLabel(m.role);
      m.role = role;
      m.emissions = all ? "*" : emissions.filter((e) => c.emissions.some((x) => x.id === e));
      audit(c, user.email, `Rôle de ${m.email} : ${before} → ${roleLabel(role)}`);
    });
  });
  redirect(path);
}

export async function removeMember(cid: string, userId: string) {
  const path = `/collectifs/${cid}/membres`;
  await guard(path, async () => {
    const { user, member: me } = await requireAction(cid, "gerer");
    await updateCollectif(cid, (c) => {
      const m = c.members.find((x) => x.userId === userId);
      if (!m) return;
      if (m.role === "proprietaire" && me.role !== "proprietaire")
        throw new Error("Seul un propriétaire peut retirer un propriétaire.");
      if (
        m.role === "proprietaire" &&
        c.members.filter((x) => x.role === "proprietaire").length === 1
      )
        throw new Error("Le collectif doit garder au moins un propriétaire.");
      c.members = c.members.filter((x) => x.userId !== userId);
      audit(c, user.email, `${m.email} retiré du collectif`);
    });
    await removeUserFromCollectif(userId, cid);
  });
  redirect(path);
}

// ——— Émissions ———

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

async function saveVisual(cid: string, eid: string, fd: FormData): Promise<string | null> {
  const f = fd.get("visuel");
  if (!(f instanceof File) || f.size === 0) return null;
  if (!IMAGE_TYPES.includes(f.type)) throw new Error("Visuel : image PNG, JPEG ou WebP.");
  if (f.size > 2_000_000) throw new Error("Visuel : 2 Mo au maximum.");
  await getStore().put(visualKey(cid, eid), new Uint8Array(await f.arrayBuffer()), f.type);
  return f.type;
}

export async function createEmission(cid: string, fd: FormData) {
  const path = `/collectifs/${cid}`;
  const eid = newId();
  await guard(path, async () => {
    const { user } = await requireAction(cid, "gerer");
    const name = str(fd, "name", 80);
    if (!name) throw new Error("Donnez un nom à l'émission.");
    const imageType = await saveVisual(cid, eid, fd);
    await updateCollectif(cid, (c) => {
      c.emissions.push({
        id: eid,
        name,
        description: str(fd, "description", 500),
        createdAt: new Date().toISOString(),
        defaultMode: mode(str(fd, "mode", 10)),
        defaultLanguage: language(str(fd, "langue", 5)),
        ...(imageType ? { imageType, imageVersion: 1 } : {}),
      });
      audit(c, user.email, `Création de l'émission « ${name} »`);
    });
  });
  redirect(`/collectifs/${cid}/emissions/${eid}`);
}

export async function updateEmission(cid: string, eid: string, fd: FormData) {
  const path = `/collectifs/${cid}/emissions/${eid}`;
  await guard(path, async () => {
    const { user } = await requireAction(cid, "gerer");
    const name = str(fd, "name", 80);
    if (!name) throw new Error("Donnez un nom à l'émission.");
    const imageType = await saveVisual(cid, eid, fd);
    await updateCollectif(cid, (c) => {
      const e = c.emissions.find((x) => x.id === eid);
      if (!e) throw new Error("Émission introuvable.");
      e.name = name;
      e.description = str(fd, "description", 500);
      e.defaultMode = mode(str(fd, "mode", 10));
      e.defaultLanguage = language(str(fd, "langue", 5));
      if (imageType) {
        e.imageType = imageType;
        e.imageVersion = (e.imageVersion ?? 0) + 1;
      }
      audit(c, user.email, `Réglages de l'émission « ${name} » modifiés`);
    });
  });
  redirect(`${path}?enregistre=1`);
}

// ——— Épisodes et sessions ———

export async function createEpisode(cid: string, eid: string, fd: FormData) {
  const path = `/collectifs/${cid}/emissions/${eid}`;
  await guard(path, async () => {
    const { user } = await requireAction(cid, "enregistrer", eid);
    const title = str(fd, "title", 100);
    if (!title) throw new Error("Donnez un titre à l'épisode.");
    await updateCollectif(cid, (c) => {
      c.episodes.push({ id: newId(), emissionId: eid, title, createdAt: new Date().toISOString() });
      audit(c, user.email, `Création de l'épisode « ${title} »`);
    });
  });
  redirect(path);
}

export async function createSession(cid: string, episodeId: string, fd: FormData) {
  const sid = newSessionId();
  let path = `/collectifs/${cid}`;
  await guard(path, async () => {
    const episode = (await getCollectif(cid))?.episodes.find((e) => e.id === episodeId);
    if (!episode) throw new Error("Épisode introuvable.");
    path = `/collectifs/${cid}/emissions/${episode.emissionId}`;
    const { user: u } = await requireAction(cid, "enregistrer", episode.emissionId);
    const name = str(fd, "name", 100) || "Session";
    await updateCollectif(cid, (c) => {
      c.sessions.push({
        id: sid,
        episodeId,
        emissionId: episode.emissionId,
        name,
        language: language(str(fd, "langue", 5)),
        mode: mode(str(fd, "mode", 10)),
        createdAt: new Date().toISOString(),
        createdBy: u.email,
      });
      audit(c, u.email, `Création de la session « ${name} » (${episode.title})`);
    });
    await indexSession(sid, cid);
  });
  redirect(`/collectifs/${cid}/sessions/${sid}`);
}

async function sessionAction(
  cid: string,
  sid: string,
  action: "enregistrer" | "fichiers",
  fn: (c: Collectif, email: string) => void,
  to?: string,
) {
  const path = to ?? `/collectifs/${cid}/sessions/${sid}`;
  await guard(path, async () => {
    const { collectif, user } = await requireAction(cid, "voir");
    const s = collectif.sessions.find((x) => x.id === sid);
    if (!s) throw new Error("Session introuvable.");
    await requireAction(cid, action, s.emissionId);
    await updateCollectif(cid, (c) => fn(c, user.email));
  });
  redirect(path);
}

export async function updateSession(cid: string, sid: string, fd: FormData) {
  await sessionAction(cid, sid, "enregistrer", (c, by) => {
    const s = c.sessions.find((x) => x.id === sid);
    if (!s) return;
    s.name = str(fd, "name", 100) || s.name;
    s.language = language(str(fd, "langue", 5));
    s.mode = mode(str(fd, "mode", 10));
    audit(c, by, `Réglages de la session « ${s.name} » modifiés`);
  });
}

export async function archiveSession(cid: string, sid: string, fd: FormData) {
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    const s = c.sessions.find((x) => x.id === sid);
    if (!s) return;
    if (str(fd, "confirmation", 100) !== s.name)
      throw new Error("Pour archiver, recopiez exactement le nom de la session.");
    s.archivedAt = new Date().toISOString();
    audit(c, by, `Session « ${s.name} » archivée`);
  });
}

export async function unarchiveSession(cid: string, sid: string) {
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    const s = c.sessions.find((x) => x.id === sid);
    if (!s?.archivedAt) return;
    delete s.archivedAt;
    audit(c, by, `Session « ${s.name} » restaurée depuis l'archive`);
  });
}

export async function trashSession(cid: string, sid: string) {
  await sessionAction(
    cid,
    sid,
    "fichiers",
    (c, by) => {
      const s = c.sessions.find((x) => x.id === sid);
      if (!s) return;
      s.deletedAt = new Date().toISOString();
      audit(c, by, `Session « ${s.name} » mise à la corbeille`);
    },
    `/collectifs/${cid}/corbeille`,
  );
}

export async function restoreSession(cid: string, sid: string) {
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    const s = c.sessions.find((x) => x.id === sid);
    if (!s?.deletedAt) return;
    delete s.deletedAt;
    audit(c, by, `Session « ${s.name} » restaurée depuis la corbeille`);
  });
}

export async function trashPrise(cid: string, sid: string, key: string, n: number) {
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    c.deletedPrises[priseRef(sid, key)] = new Date().toISOString();
    const s = c.sessions.find((x) => x.id === sid);
    audit(c, by, `Prise ${n} de « ${s?.name} » mise à la corbeille`);
  });
}

export async function restorePrise(cid: string, sid: string, key: string, n: number) {
  await sessionAction(
    cid,
    sid,
    "fichiers",
    (c, by) => {
      delete c.deletedPrises[priseRef(sid, key)];
      const s = c.sessions.find((x) => x.id === sid);
      audit(c, by, `Prise ${n} de « ${s?.name} » restaurée depuis la corbeille`);
    },
    `/collectifs/${cid}/corbeille`,
  );
}

export async function renameTrack(cid: string, sid: string, takeId: string, fd: FormData) {
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    const name = str(fd, "name", 60);
    if (name) c.renames[takeId] = name;
    else delete c.renames[takeId];
    audit(c, by, `Intervenant renommé en « ${name || "(nom d'origine)"} »`);
  });
}

// ——— Invitations d'invités (ENR-17) ———

export async function createGuestInvite(cid: string, sid: string, fd: FormData) {
  const path = `/collectifs/${cid}/sessions/${sid}`;
  const id = randomToken();
  let mail: string = "aucun";
  await guard(path, async () => {
    const { collectif, user } = await requireAction(cid, "voir");
    const s = collectif.sessions.find((x) => x.id === sid);
    if (!s) throw new Error("Session introuvable.");
    await requireAction(cid, "enregistrer", s.emissionId);
    const email = normalizeEmail(str(fd, "email", 200));
    if (email && !isValidEmail(email)) throw new Error("Adresse e-mail invalide.");
    const label = str(fd, "label", 60) || email || "Invité";
    const expiresAt = new Date(Date.now() + days(str(fd, "jours", 3)) * DAY_MS).toISOString();
    await updateCollectif(cid, (c) => {
      c.guestInvites.push({
        id,
        sessionId: sid,
        label,
        ...(email ? { email } : {}),
        createdAt: new Date().toISOString(),
        expiresAt,
      });
      audit(c, user.email, `Invitation d'invité « ${label} » pour « ${s.name} »`);
    });
    if (email) {
      const emission = collectif.emissions.find((e) => e.id === s.emissionId)?.name ?? "";
      mail = await sendMail({
        to: email,
        subject: `Invitation à enregistrer : ${emission}`,
        text: `Bonjour,\n\n${user.name || user.email} vous invite à la session « ${s.name} » de l'émission « ${emission} ». Pas besoin de compte : ouvrez le lien, testez votre micro (vous pouvez le faire dès maintenant), puis rejoignez la session à l'heure prévue.\n\nCe lien expire le ${new Date(expiresAt).toLocaleDateString("fr-FR")}.`,
        link: `${await siteOrigin()}/invitation/${cid}.${id}`,
        button: "Ouvrir l'invitation",
      });
    }
  });
  redirect(`${path}?invitation=${id}&mail=${mail}#invitations`);
}

export async function revokeGuestInvite(cid: string, sid: string, id: string) {
  await sessionAction(cid, sid, "enregistrer", (c, by) => {
    const inv = c.guestInvites.find((i) => i.id === id);
    if (inv && !inv.revokedAt) {
      inv.revokedAt = new Date().toISOString();
      audit(c, by, `Invitation d'invité « ${inv.label} » révoquée`);
    }
  });
}

// ——— Studio : traitement de la voix (étape 6a) ———

function treatmentFromForm(fd: FormData): Treatment {
  const n = (k: string) => Number(str(fd, k, 5));
  return normalizeTreatment({
    preset: str(fd, "preset", 20) as Treatment["preset"],
    voix: n("voix"),
    bruit: n("bruit"),
    ambiance: n("ambiance"),
    antiBouche: str(fd, "antiBouche", 10) as Treatment["antiBouche"],
    respirations: n("respirations") as Treatment["respirations"],
  });
}

/**
 * Réglages de traitement : pour une piste, pour toutes les pistes de la prise, ou par défaut pour
 * l'émission (les pistes sans réglage propre le suivent).
 */
export async function saveTreatment(
  cid: string,
  sid: string,
  takeId: string,
  priseTakeIds: string[],
  fd: FormData,
) {
  const t = treatmentFromForm(fd);
  const portee = str(fd, "portee", 10);
  const label = PRESETS.find((p) => p.key === t.preset)?.label;
  const known = new Set((await sessionTakes(sid)).map((x) => x.id));
  const takes = (portee === "piste" ? [takeId] : priseTakeIds).filter((x) => known.has(x));
  await sessionAction(cid, sid, "fichiers", (c, by) => {
    const s = c.sessions.find((x) => x.id === sid);
    c.treatments ??= {};
    if (portee === "emission") {
      const e = c.emissions.find((x) => x.id === s?.emissionId);
      if (!e) throw new Error("Émission introuvable.");
      e.treatment = t;
      for (const id of takes) delete c.treatments[id];
      audit(c, by, `Traitement par défaut de l'émission « ${e.name} » : ${label}`);
    } else {
      for (const id of takes) c.treatments[id] = t;
      audit(c, by, `Traitement de ${takes.length} piste(s) de « ${s?.name} » : ${label}`);
    }
  });
}
