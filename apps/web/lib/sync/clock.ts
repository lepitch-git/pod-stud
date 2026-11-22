import { estimateClock, type ClockEstimate, type ClockSample } from "@pod-stud/shared";

/** Heure locale à haute résolution (ms), qui ne saute pas quand l'heure du système est réglée. */
export const localNow = () => performance.timeOrigin + performance.now();

/**
 * Horloge commune (ENR-07) : mesure l'écart entre cet appareil et le serveur par plusieurs allers-retours
 * et le tient à jour. Toutes les heures échangées entre participants sont en « heure serveur ».
 */
export class ServerClock {
  private samples: ClockSample[] = [];
  estimate: ClockEstimate | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async sample(n = 6) {
    for (let i = 0; i < n; i++) {
      const t0 = localNow();
      try {
        const r = await fetch(`/api/horloge?i=${i}&r=${Math.random()}`, { cache: "no-store" });
        const { t } = (await r.json()) as { t: number };
        this.samples.push({ t0, server: t, t1: localNow() });
      } catch {
        /* réseau coupé : on garde l'estimation précédente */
      }
    }
    // On ne garde que les 2 dernières minutes de mesures : l'horloge locale dérive aussi.
    const since = localNow() - 120_000;
    this.samples = this.samples.filter((s) => s.t0 >= since).slice(-40);
    if (this.samples.length) this.estimate = estimateClock(this.samples);
    return this.estimate;
  }

  /** Remesure toutes les 20 secondes, en tâche de fond. */
  keepFresh() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sample(3), 20_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Heure serveur actuelle estimée (ms). */
  now(): number {
    return localNow() + (this.estimate?.offsetMs ?? 0);
  }

  toServer(local: number): number {
    return local + (this.estimate?.offsetMs ?? 0);
  }

  toLocal(server: number): number {
    return server - (this.estimate?.offsetMs ?? 0);
  }
}
