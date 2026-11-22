import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getUser, type User } from "./db";

/**
 * Connexion des membres par lien magique e-mail (spécifications : pas de mot de passe).
 * Les jetons sont signés avec AUTH_SECRET, à saisir dans Vercel (une longue suite de caractères au hasard).
 * Sans AUTH_SECRET, les liens de test utilisent une clé de développement : acceptable pour des données
 * d'essai, refusé en production.
 */
export const isProductionDeployment = () => process.env.VERCEL_ENV === "production";

const DEV_SECRET = "pod-stud-cle-de-developpement-a-ne-pas-utiliser-en-production";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (isProductionDeployment())
    throw new Error("AUTH_SECRET manquant : la connexion est désactivée en production.");
  return DEV_SECRET;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function sign(payload: object): string {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T extends { exp: number }>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as T;
    return typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export const randomToken = (bytes = 18) => randomBytes(bytes).toString("base64url");

/** Lien de connexion : valable 20 minutes. */
export const LOGIN_TTL_MS = 20 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const SESSION_COOKIE = "podstud_session";

export interface LoginToken {
  purpose: "connexion";
  email: string;
  exp: number;
  next?: string;
}

export async function setSessionCookie(userId: string) {
  const h = await headers();
  const secure = (h.get("x-forwarded-proto") ?? "").includes("https");
  (await cookies()).set(SESSION_COOKIE, sign({ uid: userId, exp: Date.now() + SESSION_TTL_MS }), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Membre connecté, ou null. */
export async function currentUser(): Promise<User | null> {
  const s = verify<{ uid: string; exp: number }>((await cookies()).get(SESSION_COOKIE)?.value);
  return s ? getUser(s.uid) : null;
}

/** Adresse publique du site, pour fabriquer les liens envoyés par e-mail. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto.split(",")[0]}://${host}`;
}

/** Ne garde que les redirections internes au site. */
export const safeNext = (n: unknown) =>
  typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/collectifs";
