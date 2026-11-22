import "server-only";

/**
 * Relais de messages d'une séance, en mémoire du serveur : sert quand la conversation en direct
 * (LiveKit) n'est pas configurée, en développement et pendant les tests automatiques.
 * Sur Vercel, plusieurs copies du serveur tournent en parallèle et ne partagent pas leur mémoire :
 * ce relais n'y est donc pas fiable, la page l'indique.
 */
export interface RelayMessage {
  n: number;
  from: string;
  at: number;
  msg: unknown;
}

interface Room {
  next: number;
  list: RelayMessage[];
  touched: number;
}

const g = globalThis as unknown as { __podstudRelay?: Map<string, Room> };
const rooms = (g.__podstudRelay ??= new Map<string, Room>());

export function post(id: string, from: string, msg: unknown): RelayMessage {
  let r = rooms.get(id);
  if (!r) rooms.set(id, (r = { next: 1, list: [], touched: Date.now() }));
  const m = { n: r.next++, from, at: Date.now(), msg };
  r.list.push(m);
  if (r.list.length > 500) r.list.splice(0, r.list.length - 500);
  r.touched = Date.now();
  // Ménage : séances inactives depuis plus de 6 heures.
  for (const [k, v] of rooms) if (Date.now() - v.touched > 6 * 3600_000) rooms.delete(k);
  return m;
}

export function since(id: string, after: number): RelayMessage[] {
  return rooms.get(id)?.list.filter((m) => m.n > after) ?? [];
}
