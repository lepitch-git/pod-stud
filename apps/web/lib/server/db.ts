import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  normalizeEmail,
  newTakeId,
  type MemberScope,
  type Role,
  type SessionKind,
  type PostprodStats,
  type Treatment,
} from "@pod-stud/shared";
import { getStore } from "./store";

/**
 * Données du collectif (étape 5), rangées en documents JSON dans le même stockage que les
 * enregistrements : un document par collectif (membres, émissions, épisodes, sessions, invitations),
 * un par membre, et deux index (adresse e-mail → membre, session → collectif).
 * Avec le stockage définitif (S3), tout est conservé ; sur le lien de test sans S3, c'est temporaire.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  collectifs: string[];
}

export interface Member extends MemberScope {
  userId: string;
  email: string;
  name: string;
  addedAt: string;
}

export interface MemberInvite extends MemberScope {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface Emission {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** Visuel (image carrée) : type MIME, l'image est rangée à part. */
  imageType?: string;
  imageVersion?: number;
  defaultMode: SessionKind;
  defaultLanguage: string;
  /** Traitement de la voix par défaut des pistes de l'émission (étape 6a). */
  treatment?: Treatment;
}

export interface Episode {
  id: string;
  emissionId: string;
  title: string;
  createdAt: string;
  deletedAt?: string;
}

export interface Session {
  /** Même identifiant que la séance d'enregistrement (/seance/<id>). */
  id: string;
  episodeId: string;
  emissionId: string;
  name: string;
  language: string;
  mode: SessionKind;
  createdAt: string;
  createdBy: string;
  archivedAt?: string;
  deletedAt?: string;
}

export interface GuestInvite {
  id: string;
  sessionId: string;
  label: string;
  email?: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface AuditEntry {
  at: string;
  by: string;
  what: string;
}

export interface Collectif {
  id: string;
  name: string;
  createdAt: string;
  quotaGb: number;
  members: Member[];
  memberInvites: MemberInvite[];
  emissions: Emission[];
  episodes: Episode[];
  sessions: Session[];
  guestInvites: GuestInvite[];
  /** Prises à la corbeille : clé « <session>/<prise> » → date de suppression. */
  deletedPrises: Record<string, string>;
  /** Nom d'intervenant corrigé par l'hôte, par piste (ENR-18). */
  renames: Record<string, string>;
  /** Traitement choisi pour une piste (sinon celui de l'émission), par identifiant de piste. */
  treatments?: Record<string, Treatment>;
  /** Pistes traitées (étape 6a), par identifiant de piste. */
  postprods?: Record<string, Postprod>;
  audit: AuditEntry[];
}

export interface Postprod extends PostprodStats {
  cle: string;
  treatment: Treatment;
  frames: number;
  chunks: number;
  doneAt: string;
  by: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await getStore().get(key);
  return raw ? (JSON.parse(dec.decode(raw)) as T) : null;
}
const writeJson = (key: string, v: unknown) =>
  getStore().put(key, enc.encode(JSON.stringify(v)), "application/json");

export const newId = () => randomBytes(6).toString("hex");
/** Identifiant de session, au format des séances (date + 8 caractères tirés au hasard). */
export const newSessionId = () => newTakeId(new Date(), () => randomInt(32) / 32);

const userKey = (id: string) => `db/utilisateurs/${id}.json`;
const emailKey = (email: string) =>
  `db/emails/${createHash("sha256").update(normalizeEmail(email)).digest("hex")}.json`;
const collectifKey = (id: string) => `db/collectifs/${id}.json`;
const sessionIndexKey = (id: string) => `db/seances/${id}.json`;
export const visualKey = (cid: string, eid: string) => `collectifs/${cid}/visuels/${eid}`;

const safeId = (id: string) => /^[a-z0-9-]{6,64}$/.test(id);

export async function getUser(id: string): Promise<User | null> {
  return safeId(id) ? readJson<User>(userKey(id)) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const idx = await readJson<{ userId: string }>(emailKey(email));
  return idx ? getUser(idx.userId) : null;
}

export async function getOrCreateUser(email: string, name = ""): Promise<User> {
  const found = await findUserByEmail(email);
  if (found) return found;
  const u: User = {
    id: newId(),
    email: normalizeEmail(email),
    name: name || normalizeEmail(email).split("@")[0] || "",
    createdAt: new Date().toISOString(),
    collectifs: [],
  };
  await writeJson(userKey(u.id), u);
  await writeJson(emailKey(u.email), { userId: u.id });
  return u;
}

export async function saveUser(u: User) {
  await writeJson(userKey(u.id), u);
}

export async function getCollectif(id: string): Promise<Collectif | null> {
  return safeId(id) ? readJson<Collectif>(collectifKey(id)) : null;
}

// Écritures en série par collectif dans ce processus (deux clics rapprochés ne s'écrasent pas).
const queues = new Map<string, Promise<unknown>>();

/** Lit, modifie et réécrit le document du collectif ; rend la valeur renvoyée par `fn`. */
export async function updateCollectif<T>(
  id: string,
  fn: (c: Collectif) => T | Promise<T>,
): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const run = prev.then(async () => {
    const c = await getCollectif(id);
    if (!c) throw new Error("collectif introuvable");
    const out = await fn(c);
    c.audit = c.audit.slice(-500);
    await writeJson(collectifKey(id), c);
    return out;
  });
  queues.set(
    id,
    run.catch(() => undefined),
  );
  return run;
}

export async function createCollectif(name: string, owner: User): Promise<Collectif> {
  const c: Collectif = {
    id: newId(),
    name,
    createdAt: new Date().toISOString(),
    quotaGb: 500,
    members: [
      {
        userId: owner.id,
        email: owner.email,
        name: owner.name,
        role: "proprietaire",
        emissions: "*",
        addedAt: new Date().toISOString(),
      },
    ],
    memberInvites: [],
    emissions: [],
    episodes: [],
    sessions: [],
    guestInvites: [],
    deletedPrises: {},
    renames: {},
    audit: [
      { at: new Date().toISOString(), by: owner.email, what: `Création du collectif « ${name} »` },
    ],
  };
  await writeJson(collectifKey(c.id), c);
  await addUserToCollectif(owner.id, c.id);
  return c;
}

export async function addUserToCollectif(userId: string, cid: string) {
  const u = await getUser(userId);
  if (u && !u.collectifs.includes(cid)) {
    u.collectifs.push(cid);
    await saveUser(u);
  }
}

export async function removeUserFromCollectif(userId: string, cid: string) {
  const u = await getUser(userId);
  if (u) {
    u.collectifs = u.collectifs.filter((x) => x !== cid);
    await saveUser(u);
  }
}

export async function indexSession(sessionId: string, collectifId: string) {
  await writeJson(sessionIndexKey(sessionId), { collectifId });
}

/** Collectif auquel appartient une séance (null pour une séance d'essai libre). */
export async function collectifOfSession(sessionId: string): Promise<string | null> {
  if (!safeId(sessionId)) return null;
  return (await readJson<{ collectifId: string }>(sessionIndexKey(sessionId)))?.collectifId ?? null;
}

export const memberOf = (c: Collectif, userId: string | undefined) =>
  userId ? (c.members.find((m) => m.userId === userId) ?? null) : null;

export function audit(c: Collectif, by: string, what: string) {
  c.audit.push({ at: new Date().toISOString(), by, what });
}

export type { Role };
