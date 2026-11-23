"use client";

import { replaceAll, type Segment, type Transcript } from "@pod-stud/shared";
import { useState } from "react";
import { runTranscription } from "@/lib/studio/client";

export interface TranscriptInfo {
  tracks: { url: string; speaker: string }[];
  language: string;
  hasMix: boolean;
  summary: { segments: number; updatedAt: string } | null;
}

const clock = (t: number) => {
  const s = Math.floor(t);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
const PHASE: Record<string, string> = {
  analyse: "Repérage des passages parlés",
  modele: "Téléchargement du modèle (une seule fois)",
  transcription: "Transcription",
};

/** Transcription de la prise (étape 6c) : calcul dans le navigateur, corrections, exports. */
export function TranscriptPanel({
  cid,
  sid,
  prise,
  info,
  disabled,
}: {
  cid: string;
  sid: string;
  prise: string;
  info: TranscriptInfo;
  disabled: boolean;
}) {
  const url = `/api/collectifs/${cid}/transcriptions/${sid}/${encodeURIComponent(prise)}`;
  const [model, setModel] = useState<"rapide" | "precis">("rapide");
  const [job, setJob] = useState<{ phase: string; ratio: number; detail?: string } | null>(null);
  const [error, setError] = useState("");
  const [segs, setSegs] = useState<Segment[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(info.summary?.segments ?? null);
  const [find, setFind] = useState("");
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    if (segs) return;
    const r = await fetch(url, { cache: "no-store" });
    const t = (await r.json()) as Transcript | null;
    setSegs(t?.segments ?? []);
  }

  async function save(segments: Segment[], extra: Partial<Transcript> = {}) {
    const r = await fetch(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...extra, segments }),
    });
    const j = (await r.json().catch(() => null)) as { error?: string; segments?: number } | null;
    if (!r.ok) throw new Error(j?.error ?? `Enregistrement refusé (${r.status}).`);
    setSaved(j?.segments ?? segments.length);
    setDirty(false);
  }

  async function run() {
    setError("");
    setNote("");
    setJob({ phase: "analyse", ratio: 0 });
    try {
      const r = await runTranscription(
        { tracks: info.tracks, language: info.language, model },
        (phase, ratio, detail) => setJob({ phase, ratio, detail }),
      );
      await save(r.segments, { model: r.model, language: info.language });
      const t = (await (await fetch(url, { cache: "no-store" })).json()) as Transcript;
      setSegs(t.segments);
      setNote(
        `Transcription terminée (${r.device === "webgpu" ? "carte graphique" : "processeur"}).`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJob(null);
    }
  }

  return (
    <details
      className="post-transcript"
      data-testid="transcript-panel"
      data-saved={saved ?? 0}
      onToggle={(e) => (e.currentTarget.open ? void load() : undefined)}
    >
      <summary>
        <strong>Transcription</strong>{" "}
        <small className="hint" data-testid="transcript-summary">
          {saved ? `${saved} passage${saved > 1 ? "s" : ""}` : "pas encore faite"}
        </small>
      </summary>
      <p className="hint">
        Whisper tourne dans ce navigateur, sans compte ni service payant. Chaque voix est transcrite
        à part : on sait qui parle. Le modèle se télécharge une fois (environ 80 Mo en rapide, 250
        Mo en précis). Comptez quelques minutes par quart d&apos;heure de parole, moins avec une
        carte graphique récente.
      </p>
      <p>
        <label className="inline">
          Modèle{" "}
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as "rapide")}
            data-testid="transcript-model"
          >
            <option value="rapide">Rapide</option>
            <option value="precis">Précis (plus lent)</option>
          </select>
        </label>{" "}
        <button
          type="button"
          className="button small"
          disabled={disabled || job !== null || !info.tracks.length}
          onClick={run}
          data-testid="transcript-run"
        >
          {saved ? "Refaire la transcription" : "Transcrire la prise"}
        </button>
      </p>
      {job && (
        <p className="post-progress" data-testid="transcript-progress">
          {PHASE[job.phase] ?? job.phase}
          {job.detail ? ` (${job.detail})` : ""} : {Math.round(job.ratio * 100)} %
          <progress max={1} value={job.ratio} />
        </p>
      )}
      {error && (
        <p className="error-box" role="alert" data-testid="transcript-error">
          La transcription n&apos;a pas abouti : {error}
        </p>
      )}
      {note && <p className="info-box">{note}</p>}
      {saved ? (
        <p className="post-actions" data-testid="transcript-exports">
          <a
            className="button secondary small"
            href={`${url}?format=txt`}
            data-testid="transcript-txt"
          >
            Texte (.txt)
          </a>
          <a
            className="button secondary small"
            href={`${url}?format=srt`}
            data-testid="transcript-srt"
          >
            Sous-titres (.srt)
          </a>
          <a className="button secondary small" href={`${url}?format=vtt`}>
            WebVTT (.vtt)
          </a>
          {info.hasMix && (
            <a
              className="button secondary small"
              href={`${url}?format=srt&base=mix`}
              data-testid="transcript-srt-mix"
            >
              Sous-titres calés sur le mix (.srt)
            </a>
          )}
        </p>
      ) : null}
      {segs && segs.length > 0 && (
        <div className="transcript-editor" data-testid="transcript-editor">
          <p className="find-replace">
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Mot mal compris"
              aria-label="Rechercher"
              data-testid="transcript-find"
            />{" "}
            →{" "}
            <input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              placeholder="Correction"
              aria-label="Remplacer par"
              data-testid="transcript-replace"
            />{" "}
            <button
              type="button"
              className="button secondary small"
              disabled={!find}
              onClick={() => {
                const r = replaceAll(segs, find, by);
                setSegs(r.segments);
                if (r.count) setDirty(true);
                setNote(`${r.count} remplacement${r.count > 1 ? "s" : ""}.`);
              }}
              data-testid="transcript-replace-all"
            >
              Remplacer partout
            </button>
          </p>
          <ol className="plain">
            {segs.map((s, i) => (
              <li key={i} className="transcript-line" data-testid="transcript-line">
                <small className="hint">
                  {clock(s.start)} · <strong>{s.speaker}</strong>
                </small>
                <textarea
                  value={s.text}
                  rows={Math.max(1, Math.ceil(s.text.length / 90))}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSegs(segs.map((x, j) => (j === i ? { ...x, text: v } : x)));
                    setDirty(true);
                  }}
                  aria-label={`Passage de ${s.speaker} à ${clock(s.start)}`}
                />
              </li>
            ))}
          </ol>
          <p>
            <button
              type="button"
              className="button"
              disabled={!dirty}
              onClick={() =>
                save(segs).then(
                  () => setNote("Corrections enregistrées."),
                  (e: Error) => setError(e.message),
                )
              }
              data-testid="transcript-save"
            >
              Enregistrer les corrections
            </button>{" "}
            {dirty && <small className="hint">Corrections pas encore enregistrées.</small>}
          </p>
        </div>
      )}
    </details>
  );
}
