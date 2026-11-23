"use client";

import { formatDuration, SILENCE_CHOICES, type MixSettings } from "@pod-stud/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { runMix } from "@/lib/studio/client";

export interface MixInfo {
  sources: { name: string; processed: boolean; url: string }[];
  sig: string;
  defaults: MixSettings;
  done: { settings: MixSettings; seconds: number; removedSec: number; cuts: number } | null;
  fresh: boolean;
}

const secs = (s: number) => (s < 60 ? `${Math.round(s)} s` : formatDuration(s));
const speedLabel = (v: number) => `×${v.toFixed(2).replace(".", ",")}`;

/** Mix de la prise (étape 6b) : somme des pistes, silences communs, vitesse, volume final. */
export function MixPanel({
  cid,
  sid,
  prise,
  info,
  disabled,
}: {
  cid: string;
  sid: string;
  prise: string;
  info: MixInfo;
  disabled: boolean;
}) {
  const router = useRouter();
  const [s, setS] = useState<MixSettings>(info.done?.settings ?? info.defaults);
  const [job, setJob] = useState<{ phase: string; ratio: number } | null>(null);
  const [estimate, setEstimate] = useState<{ key: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const key = `${s.silenceMax}`;
  const uploadUrl = `/api/collectifs/${cid}/mix/${sid}/${encodeURIComponent(prise)}`;
  const busy = job !== null;

  async function go(estimer: boolean) {
    setError("");
    setJob({ phase: "analyse", ratio: 0 });
    try {
      const r = await runMix(
        {
          urls: info.sources.map((x) => x.url),
          settings: s,
          estimer,
          uploadUrl,
          sources: info.sig,
        },
        (phase, ratio) => setJob({ phase, ratio }),
      );
      if (r.type === "estimation")
        setEstimate({
          key,
          text: r.cuts
            ? `${r.cuts} silence${r.cuts > 1 ? "s" : ""} raccourci${r.cuts > 1 ? "s" : ""} : ${secs(r.removedSec)} gagnées sur ${secs(r.seconds)}.`
            : "Aucun silence commun assez long à raccourcir.",
        });
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJob(null);
    }
  }

  return (
    <div
      className="post-mix"
      data-testid="mix-panel"
      data-fresh={info.done ? String(info.fresh) : "none"}
    >
      <h4>Mix de la prise</h4>
      <p className="hint">
        Pistes utilisées :{" "}
        {info.sources.map((x, i) => (
          <span key={x.url}>
            {i > 0 && ", "}
            {x.name} ({x.processed ? "traitée" : "originale"})
          </span>
        ))}
        . Traitez d&apos;abord les voix pour un meilleur résultat.
      </p>
      {info.done && (
        <p data-testid="mix-done" className={info.fresh ? "" : "warn-text"}>
          {info.fresh ? "Mix prêt" : "Les pistes ont changé depuis ce mix : relancez-le"} ·{" "}
          {secs(info.done.seconds)}
          {info.done.cuts > 0 && ` · ${secs(info.done.removedSec)} de silences en moins`}
          {info.done.settings.speed !== 1 &&
            ` · vitesse ${speedLabel(info.done.settings.speed)}`} · {info.done.settings.target} LUFS{" "}
          <a className="button secondary small" href={uploadUrl} data-testid="mix-download">
            Télécharger le mix (WAV)
          </a>
        </p>
      )}
      <label className="field">
        Raccourcir les silences communs à toutes les voix
        <select
          value={s.silenceMax}
          onChange={(e) => setS({ ...s, silenceMax: Number(e.target.value) })}
          data-testid="mix-silences"
        >
          {SILENCE_CHOICES.map((v) => (
            <option key={v} value={v}>
              {v === 0 ? "Ne pas toucher" : `Au plus ${String(v).replace(".", ",")} s`}
            </option>
          ))}
        </select>
      </label>
      {s.silenceMax > 0 && (
        <p>
          <button
            type="button"
            className="button secondary small"
            disabled={busy || disabled}
            onClick={() => go(true)}
            data-testid="mix-estimate"
          >
            Calculer le temps gagné
          </button>{" "}
          {estimate?.key === key && (
            <small className="hint" data-testid="mix-estimate-result">
              {estimate.text}
            </small>
          )}
        </p>
      )}
      <label className="field slider">
        Vitesse, sans changer la hauteur des voix : {speedLabel(s.speed)}
        <input
          type="range"
          min={0.8}
          max={1.25}
          step={0.05}
          value={s.speed}
          onChange={(e) => setS({ ...s, speed: Number(e.target.value) })}
          data-testid="mix-speed"
        />
        <span className="slider-ends">
          <small>plus lent</small>
          <small>plus rapide</small>
        </span>
      </label>
      {s.speed !== 1 && (
        <p className="hint">
          La vitesse s&apos;applique au mix entier : toutes les voix restent synchronisées.
        </p>
      )}
      <label className="field">
        Volume final
        <select
          value={s.target}
          onChange={(e) => setS({ ...s, target: Number(e.target.value) === -23 ? -23 : -16 })}
          data-testid="mix-target"
        >
          <option value={-16}>-16 LUFS (podcast)</option>
          <option value={-23}>-23 LUFS (diffusion radio)</option>
        </select>
      </label>
      <button
        type="button"
        className="button"
        disabled={busy || disabled || !info.sources.length}
        onClick={() => go(false)}
        data-testid="mix-run"
      >
        {info.done ? "Refaire le mix" : "Créer le mix"}
      </button>
      {job && (
        <p className="post-progress" data-testid="mix-progress">
          {job.phase === "analyse" ? "Analyse des pistes" : "Mixage et envoi"} :{" "}
          {Math.round(job.ratio * 100)} %
          <progress max={1} value={job.ratio} />
        </p>
      )}
      {error && (
        <p className="error-box" role="alert" data-testid="mix-error">
          {error}
        </p>
      )}
    </div>
  );
}
