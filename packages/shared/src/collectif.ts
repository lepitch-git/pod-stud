/**
 * Collectif, émissions, épisodes, sessions (étape 5, ENR-16 à ENR-21) : règles partagées et testées
 * sans navigateur ni serveur (rôles, noms de fichiers, expiration, corbeille).
 */

/** Rôles d'un membre (spécifications, « Comptes collectif, émissions et rôles »). */
export type Role = "proprietaire" | "admin" | "animateur" | "monteur";

export const ROLES: { key: Role; label: string; help: string }[] = [
  {
    key: "proprietaire",
    label: "Propriétaire",
    help: "Tout, dont la suppression définitive et le transfert de propriété",
  },
  {
    key: "admin",
    label: "Administrateur",
    help: "Gère les membres, les émissions et les réglages ; voit toutes les sessions",
  },
  {
    key: "animateur",
    label: "Animateur",
    help: "Crée et anime des sessions, invite, télécharge les pistes de ses émissions",
  },
  {
    key: "monteur",
    label: "Monteur",
    help: "Accède aux pistes et au studio de montage, sans lancer d'enregistrement",
  },
];

export const roleLabel = (r: Role) => ROLES.find((x) => x.key === r)?.label ?? r;

export type Action =
  /** Voir l'émission, ses épisodes et ses sessions. */
  | "voir"
  /** Télécharger, renommer un intervenant, mettre une prise à la corbeille, archiver. */
  | "fichiers"
  /** Créer des épisodes et des sessions, inviter, lancer un enregistrement. */
  | "enregistrer"
  /** Gérer les membres, les émissions, le quota. */
  | "gerer"
  /** Supprimer définitivement, transférer la propriété. */
  | "posseder";

export interface MemberScope {
  role: Role;
  /** Émissions accessibles : toutes (« * ») ou une liste. Sans effet pour propriétaire et administrateur. */
  emissions: "*" | string[];
}

const ALLOWED: Record<Role, Action[]> = {
  proprietaire: ["voir", "fichiers", "enregistrer", "gerer", "posseder"],
  admin: ["voir", "fichiers", "enregistrer", "gerer"],
  animateur: ["voir", "fichiers", "enregistrer"],
  monteur: ["voir", "fichiers"],
};

/** Le membre peut-il faire cette action, sur le collectif (sans émission) ou sur une émission ? */
export function can(
  m: MemberScope | null | undefined,
  action: Action,
  emissionId?: string,
): boolean {
  if (!m || !ALLOWED[m.role].includes(action)) return false;
  if (m.role === "proprietaire" || m.role === "admin") return true;
  if (action === "gerer" || action === "posseder") return false;
  if (emissionId === undefined) return action === "voir";
  return m.emissions === "*" || m.emissions.includes(emissionId);
}

/** Émissions visibles par le membre. */
export function visibleEmissions<T extends { id: string }>(
  m: MemberScope | null | undefined,
  emissions: T[],
): T[] {
  return emissions.filter((e) => can(m, "voir", e.id));
}

/** Modes de session (ENR-02), repris par le lien d'invitation et le test d'équipement (?mode=). */
export type SessionKind = "video" | "visio" | "audio";

export const SESSION_MODES: { key: SessionKind; label: string }[] = [
  { key: "video", label: "Audio et vidéo enregistrés" },
  { key: "visio", label: "Audio enregistré, vidéo affichée" },
  { key: "audio", label: "Audio seul" },
];

export const LANGUAGES: { key: string; label: string }[] = [
  { key: "fr", label: "Français" },
  { key: "en", label: "Anglais" },
  { key: "es", label: "Espagnol" },
  { key: "de", label: "Allemand" },
  { key: "it", label: "Italien" },
];

/** Partie de nom de fichier : sans accents ni caractères spéciaux, mots séparés par des tirets. */
export function filePart(s: string, fallback = "sans-nom"): string {
  const out = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return out || fallback;
}

/** Nom d'une piste exportée (ENR-18), par exemple « Emission_Episode_Prise2_Lola.wav ». */
export function trackFileName(p: {
  emission: string;
  episode: string;
  prise: number;
  participant: string;
  ext?: string;
}): string {
  return `${filePart(p.emission)}_${filePart(p.episode)}_Prise${p.prise}_${filePart(p.participant, "Intervenant")}.${p.ext ?? "wav"}`;
}

/** Nomme sans doublon : un deuxième « Lola » dans la même prise devient « Lola-2 ». */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase();
    const c = (seen.get(k) ?? 0) + 1;
    seen.set(k, c);
    return c === 1 ? n : `${n}-${c}`;
  });
}

export const DAY_MS = 24 * 3600 * 1000;
/** Corbeille : restauration possible pendant 30 jours (ENR-20). */
export const TRASH_DAYS = 30;
/** Durées proposées pour les liens d'invitation (ENR-17). */
export const INVITE_DAYS = [1, 7, 30];

export type LinkState = "valide" | "revoque" | "expire" | "utilise";

export function linkState(
  l: { expiresAt: string; revokedAt?: string | null; usedAt?: string | null },
  now = Date.now(),
): LinkState {
  if (l.revokedAt) return "revoque";
  if (l.usedAt) return "utilise";
  if (Date.parse(l.expiresAt) <= now) return "expire";
  return "valide";
}

/** Jours restants avant suppression définitive d'un élément mis à la corbeille. */
export function trashDaysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((Date.parse(deletedAt) + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

export const trashExpired = (deletedAt: string, now = Date.now()) =>
  Date.parse(deletedAt) + TRASH_DAYS * DAY_MS <= now;

export function formatSize(n: number): string {
  if (n < 1000) return `${n} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let v = n;
  let u = -1;
  do {
    v /= 1000;
    u++;
  } while (v >= 1000 && u < units.length - 1);
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

export function isValidEmail(s: string): boolean {
  return s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/**
 * Numérotation des prises d'une session : une prise regroupe les pistes lancées par le même départ
 * commun ; numérotées dans l'ordre chronologique, numéros stables même si une prise est supprimée.
 */
export function numberPrises<T extends { startServerMs?: number | null; id: string }>(
  takes: T[],
): { key: string; number: number; startServerMs: number | null; tracks: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const t of takes) {
    const key = t.startServerMs ? String(t.startServerMs) : `seule-${t.id}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.entries()]
    .map(([key, tracks]) => ({ key, startServerMs: tracks[0]?.startServerMs ?? null, tracks }))
    .sort((a, b) => (a.startServerMs ?? 0) - (b.startServerMs ?? 0) || a.key.localeCompare(b.key))
    .map((g, i) => ({ ...g, number: i + 1 }));
}
