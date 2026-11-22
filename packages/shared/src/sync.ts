/**
 * Synchronisation des pistes sans clap (exigence ENR-07).
 *
 * 1. Horloge commune : chaque appareil mesure l'écart entre son horloge et celle du serveur
 *    (plusieurs allers-retours, on garde le plus rapide, comme NTP).
 * 2. Démarrage simultané : l'hôte annonce une heure de départ en temps serveur ; chaque appareil
 *    la convertit dans l'horloge de sa carte son et démarre à l'échantillon près.
 * 3. Dérive : une carte son à « 48 kHz » tourne en réalité à 48 kHz ± quelques dizaines de ppm,
 *    soit jusqu'à plusieurs centaines de millisecondes d'écart par heure. Pendant l'enregistrement,
 *    on note régulièrement des repères (numéro d'échantillon, heure serveur) ; à l'export, une
 *    régression donne la fréquence réelle et on rééchantillonne chaque piste sur une base commune.
 */

export interface ClockSample {
  /** Heure locale (ms) à l'envoi de la requête. */
  t0: number;
  /** Heure du serveur (ms) dans la réponse. */
  server: number;
  /** Heure locale (ms) à la réception de la réponse. */
  t1: number;
}

export interface ClockEstimate {
  /** À ajouter à l'heure locale pour obtenir l'heure du serveur (ms). */
  offsetMs: number;
  /** Aller-retour de la meilleure mesure (ms) ; l'erreur sur l'écart est au plus la moitié. */
  rttMs: number;
}

/** Écart d'horloge : la mesure au plus court aller-retour est la plus fiable. */
export function estimateClock(samples: ClockSample[]): ClockEstimate {
  if (!samples.length) throw new Error("aucune mesure d'horloge");
  let best = samples[0] as ClockSample;
  for (const s of samples) if (s.t1 - s.t0 < best.t1 - best.t0) best = s;
  return { offsetMs: best.server - (best.t0 + best.t1) / 2, rttMs: best.t1 - best.t0 };
}

/** Repère pris pendant l'enregistrement : tel échantillon de la piste a été capté à telle heure serveur. */
export interface SyncPoint {
  frame: number;
  serverMs: number;
}

export interface ClockFit {
  /** Heure serveur (ms) du premier échantillon de la piste. */
  startMs: number;
  /** Fréquence réelle de la carte son, mesurée sur l'horloge du serveur (échantillons par seconde). */
  rate: number;
  /** Écart type des repères autour de la droite (ms) : qualité de la mesure. */
  residualMs: number;
}

/**
 * Régression linéaire « heure serveur = début + échantillon / fréquence réelle ».
 * Avec moins de deux repères ou une durée trop courte, on garde la fréquence nominale.
 */
export function fitClock(points: SyncPoint[], nominalRate: number): ClockFit {
  if (!points.length) return { startMs: Number.NaN, rate: nominalRate, residualMs: Number.NaN };
  const n = points.length;
  const span = (points[n - 1] as SyncPoint).frame - (points[0] as SyncPoint).frame;
  if (n < 2 || span < nominalRate * 30) {
    // Moins de 30 s de repères : la pente serait plus bruitée que la dérive elle-même.
    const msPerFrame = 1000 / nominalRate;
    const start = points.reduce((s, p) => s + (p.serverMs - p.frame * msPerFrame), 0) / n;
    const res = Math.sqrt(
      points.reduce((s, p) => s + (p.serverMs - (start + p.frame * msPerFrame)) ** 2, 0) / n,
    );
    return { startMs: start, rate: nominalRate, residualMs: res };
  }
  // Calcul centré pour garder la précision malgré des heures serveur de l'ordre de 1e12 ms.
  const fx = points.reduce((s, p) => s + p.frame, 0) / n;
  const fy = points.reduce((s, p) => s + p.serverMs, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.frame - fx) * (p.serverMs - fy);
    sxx += (p.frame - fx) ** 2;
  }
  const msPerFrame = sxy / sxx;
  const start = fy - msPerFrame * fx;
  const res = Math.sqrt(
    points.reduce((s, p) => s + (p.serverMs - (start + p.frame * msPerFrame)) ** 2, 0) / n,
  );
  return { startMs: start, rate: 1000 / msPerFrame, residualMs: res };
}

export interface TrackPlan {
  /** Silence à ajouter au début de la piste exportée (échantillons à la fréquence de sortie). */
  padFrames: number;
  /** Échantillons de la piste source à sauter au début (si elle a démarré avant la référence). */
  skipSourceFrames: number;
  /** Rapport de rééchantillonnage : échantillons source consommés par échantillon produit. */
  step: number;
}

/**
 * Plan d'alignement d'une piste sur une heure de référence commune (en général le départ annoncé
 * par l'hôte), à la fréquence de sortie voulue (48 kHz).
 */
export function planTrack(fit: ClockFit, referenceMs: number, outRate = 48000): TrackPlan {
  const step = fit.rate / outRate;
  const deltaMs = fit.startMs - referenceMs;
  if (deltaMs >= 0)
    return { padFrames: Math.round((deltaMs / 1000) * outRate), skipSourceFrames: 0, step };
  return { padFrames: 0, skipSourceFrames: (-deltaMs / 1000) * fit.rate, step };
}

/**
 * Rééchantillonneur en continu (interpolation cubique d'Hermite sur 4 points) : fidèle pour les
 * très petits rapports de dérive (quelques ppm à quelques centaines de ppm) qu'on corrige ici,
 * et utilisable morceau par morceau sans charger toute la piste en mémoire.
 */
export class StreamResampler {
  private hist = new Float32Array(0);
  /** Position (en échantillons source) du prochain échantillon à produire, relative à hist[0]. */
  private pos: number;

  constructor(
    private readonly step: number,
    startPos = 0,
  ) {
    this.pos = startPos;
  }

  /** Ajoute des échantillons source ; rend les échantillons produits. `final` vide la fin. */
  push(input: Float32Array, final = false): Float32Array {
    const buf = new Float32Array(this.hist.length + input.length);
    buf.set(this.hist);
    buf.set(input, this.hist.length);
    const n = buf.length;
    const at = (i: number) => (n ? (buf[Math.min(Math.max(i, 0), n - 1)] as number) : 0);
    const out: number[] = [];
    for (;;) {
      const i = Math.floor(this.pos);
      // Sans `final`, on attend d'avoir les deux échantillons suivants pour interpoler.
      if (final ? i >= n : i + 2 >= n) break;
      const f = this.pos - i;
      const y0 = at(i - 1);
      const y1 = at(i);
      const y2 = at(i + 1);
      const y3 = at(i + 2);
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      out.push(((c3 * f + c2) * f + c1) * f + y1);
      this.pos += this.step;
    }
    // On garde un échantillon avant la position courante pour l'interpolation suivante.
    const drop = Math.max(0, Math.min(Math.floor(this.pos) - 1, n));
    this.hist = buf.slice(drop);
    this.pos -= drop;
    return Float32Array.from(out);
  }
}
