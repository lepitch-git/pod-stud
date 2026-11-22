"use client";

import { formatDuration, PRESETS, presetOf, treatmentKey, type Treatment } from "@pod-stud/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { previewTrack, processTrack } from "@/lib/studio/client";

export type PostState = "brut" | "a-faire" | "a-jour" | "perime";

export interface PostTrack {
  takeId: string;
  displayName: string;
  fileName: string;
  seconds: number;
  complete: boolean;
  treatment: Treatment;
  /** Réglage propre à la piste (sinon celui de l'émission). */
  own: boolean;
  state: PostState;
  done: { inputLufs: number; outputLufs: number; repaired: number; breaths: number } | null;
}

export interface PostPrise {
  key: string;
  number: number;
  recordedLabel: string;
  tracks: PostTrack[];
}

type Save = (
  cid: string,
  sid: string,
  take: string,
  prise: string[],
  fd: FormData,
) => Promise<void>;
type Job = { phase: string; ratio: number } | { error: string } | "attente";

const STATE_LABEL: Record<PostState, string> = {
  brut: "Brut : aucun traitement",
  "a-faire": "Pas encore traitée",
  "a-jour": "Traitée",
  perime: "Réglages modifiés : à relancer",
};
const lufs = (v: number) =>
  Number.isFinite(v) ? `${v.toFixed(1).replace(".", ",")} LUFS` : "silence";

/**
 * Postproductions (étape 6a) : un traitement de la voix par piste, réglé avec un preset, trois
 * curseurs et deux options. Le calcul se fait dans ce navigateur (laissez l'onglet ouvert), puis la
 * version traitée est rangée sur le serveur et se télécharge comme les autres pistes.
 */
export function Postproductions({
  cid,
  sid,
  prises,
  emissionName,
  save,
}: {
  cid: string;
  sid: string;
  prises: PostPrise[];
  emissionName: string;
  save: Save;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const busy = Object.values(jobs).some(
    (j) => j === "attente" || (typeof j === "object" && "phase" in j),
  );

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function runAll(tracks: PostTrack[]) {
    const todo = tracks.filter((t) => t.complete && t.state !== "brut" && t.state !== "a-jour");
    setJobs((j) => ({
      ...j,
      ...Object.fromEntries(todo.map((t) => [t.takeId, "attente" as Job])),
    }));
    for (const t of todo) {
      try {
        await processTrack(cid, t.takeId, t.treatment, treatmentKey(t.treatment), (phase, ratio) =>
          setJobs((j) => ({ ...j, [t.takeId]: { phase, ratio } })),
        );
        setJobs((j) => {
          const n = { ...j };
          delete n[t.takeId];
          return n;
        });
      } catch (e) {
        setJobs((j) => ({ ...j, [t.takeId]: { error: (e as Error).message } }));
      }
      router.refresh();
    }
  }

  if (!prises.length)
    return (
      <p className="hint" data-testid="postproductions-empty">
        Aucune prise à traiter pour l&apos;instant.
      </p>
    );
  return (
    <div data-testid="postproductions">
      <p className="hint">
        Chaque voix est nettoyée et mise au bon volume selon un preset. Le calcul se fait dans ce
        navigateur : laissez l&apos;onglet ouvert pendant le traitement. La durée des pistes ne
        change jamais, elles restent synchronisées. Réglage par défaut des nouvelles pistes : celui
        de l&apos;émission « {emissionName} ».
      </p>
      {prises.map((p) => {
        const todo = p.tracks.filter(
          (t) => t.complete && (t.state === "a-faire" || t.state === "perime"),
        );
        return (
          <section key={p.key} className="prise" data-testid="post-prise" data-number={p.number}>
            <h3>
              Prise {p.number} <small className="hint">· {p.recordedLabel}</small>
            </h3>
            <ul className="plain">
              {p.tracks.map((t) => (
                <PostTrackRow
                  key={t.takeId}
                  cid={cid}
                  sid={sid}
                  track={t}
                  priseTakes={p.tracks.map((x) => x.takeId)}
                  job={jobs[t.takeId]}
                  busy={busy}
                  save={save}
                  run={() => runAll([t])}
                />
              ))}
            </ul>
            {todo.length > 1 && (
              <p>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => runAll(todo)}
                  data-testid="post-run-prise"
                >
                  Traiter les {todo.length} pistes de la prise
                </button>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PostTrackRow({
  cid,
  sid,
  track: t,
  priseTakes,
  job,
  busy,
  save,
  run,
}: {
  cid: string;
  sid: string;
  track: PostTrack;
  priseTakes: string[];
  job: Job | undefined;
  busy: boolean;
  save: Save;
  run: () => void;
}) {
  const [open, setOpen] = useState(false);
  const preset = presetOf(t.treatment.preset);
  const running = job === "attente" || (typeof job === "object" && "phase" in job);
  return (
    <li className="post-track" data-testid="post-track" data-take={t.takeId} data-state={t.state}>
      <strong>{t.displayName}</strong> · {formatDuration(t.seconds)} ·{" "}
      <span data-testid="post-preset">{preset.label}</span>
      {!t.own && <small className="hint"> (réglage de l&apos;émission)</small>}{" "}
      <em className={`tag post-${t.state}`} data-testid="post-state">
        {STATE_LABEL[t.state]}
      </em>
      {t.state === "a-jour" && t.done && (
        <small className="hint" data-testid="post-stats">
          <br />
          Volume {lufs(t.done.inputLufs)} → {preset.targetLufs} LUFS · {t.done.repaired} bruit
          {t.done.repaired > 1 ? "s" : ""} de bouche réparé{t.done.repaired > 1 ? "s" : ""}
          {t.treatment.respirations > 0 &&
            ` · ${t.done.breaths} respiration${t.done.breaths > 1 ? "s" : ""} atténuée${t.done.breaths > 1 ? "s" : ""}`}
        </small>
      )}
      {!t.complete && (
        <small className="hint">
          <br />
          L&apos;envoi de cette piste n&apos;est pas terminé : elle pourra être traitée ensuite.
        </small>
      )}
      <div className="post-actions">
        {(t.state === "a-jour" || t.state === "brut") && t.complete && (
          <a
            className="button secondary small"
            href={`/api/collectifs/${cid}/pistes/${t.takeId}?traitee=1`}
            data-testid="post-download"
          >
            Télécharger la version traitée
          </a>
        )}
        {t.complete && (t.state === "a-faire" || t.state === "perime") && !running && (
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={run}
            data-testid="post-run"
          >
            {t.state === "perime" ? "Relancer le traitement" : "Traiter"}
          </button>
        )}
        <button
          type="button"
          className="button secondary small"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-testid="post-edit"
        >
          {open ? "Fermer les réglages" : "Régler et écouter"}
        </button>
      </div>
      {running && (
        <p className="post-progress" data-testid="post-progress">
          {job === "attente"
            ? "En attente…"
            : `${job.phase === "mesure" ? "Mesure du volume" : "Traitement et envoi"} : ${Math.round(job.ratio * 100)} %`}
          <progress
            max={1}
            value={
              job === "attente"
                ? 0
                : job.ratio * (job.phase === "mesure" ? 0.2 : 0.8) +
                  (job.phase === "mesure" ? 0 : 0.2)
            }
          />
        </p>
      )}
      {typeof job === "object" && "error" in job && (
        <p className="error-box" role="alert" data-testid="post-error">
          Le traitement n&apos;a pas abouti : {job.error}
        </p>
      )}
      {open && (
        <TreatmentEditor cid={cid} sid={sid} track={t} priseTakes={priseTakes} save={save} />
      )}
    </li>
  );
}

function TreatmentEditor({
  cid,
  sid,
  track: t,
  priseTakes,
  save,
}: {
  cid: string;
  sid: string;
  track: PostTrack;
  priseTakes: string[];
  save: Save;
}) {
  const [d, setD] = useState<Treatment>(t.treatment);
  const set = <K extends keyof Treatment>(k: K, v: Treatment[K]) => setD((x) => ({ ...x, [k]: v }));
  const brut = d.preset === "brut";
  const changed = treatmentKey(d) !== treatmentKey(t.treatment);
  return (
    <form
      className="post-editor"
      action={save.bind(null, cid, sid, t.takeId, priseTakes)}
      data-testid="post-editor"
    >
      <fieldset>
        <legend>Preset</legend>
        {PRESETS.map((p) => (
          <label key={p.key} className="radio-line">
            <input
              type="radio"
              name="preset"
              value={p.key}
              checked={d.preset === p.key}
              onChange={() => set("preset", p.key)}
              data-testid={`preset-${p.key}`}
            />{" "}
            <strong>{p.label}</strong> <small className="hint">{p.help}</small>
          </label>
        ))}
      </fieldset>
      <Slider
        name="voix"
        label="Voix"
        left="discrète"
        right="très présente"
        value={d.voix}
        disabled={brut}
        onChange={(v) => set("voix", v)}
      />
      <Slider
        name="bruit"
        label="Bruit de fond"
        left="garder"
        right="enlever fort"
        value={d.bruit}
        disabled={brut}
        onChange={(v) => set("bruit", v)}
      />
      <Slider
        name="ambiance"
        label="Ambiance de la pièce"
        left="très sèche"
        right="naturelle"
        value={d.ambiance}
        disabled={brut}
        onChange={(v) => set("ambiance", v)}
      />
      <label className="field">
        Bruits de bouche (clics, salive)
        <select
          name="antiBouche"
          value={d.antiBouche}
          disabled={brut}
          onChange={(e) => set("antiBouche", e.target.value as Treatment["antiBouche"])}
          data-testid="post-antibouche"
        >
          <option value="off">Ne pas toucher</option>
          <option value="leger">Léger</option>
          <option value="moyen">Moyen</option>
          <option value="fort">Fort</option>
        </select>
      </label>
      <label className="field">
        Respirations (expérimental, jamais supprimées)
        <select
          name="respirations"
          value={d.respirations}
          disabled={brut}
          onChange={(e) => set("respirations", Number(e.target.value) as Treatment["respirations"])}
          data-testid="post-respirations"
        >
          <option value={0}>Ne pas toucher</option>
          <option value={6}>Atténuer un peu (-6 dB)</option>
          <option value={12}>Atténuer davantage (-12 dB)</option>
        </select>
      </label>
      <Preview cid={cid} track={t} treatment={d} />
      <label className="field">
        Appliquer ces réglages
        <select name="portee" defaultValue="piste" data-testid="post-portee">
          <option value="piste">À cette piste seulement</option>
          <option value="prise">À toutes les pistes de la prise</option>
          <option value="emission">Par défaut pour l&apos;émission (et cette prise)</option>
        </select>
      </label>
      {/* Les champs désactivés ne partent pas avec le formulaire : on les recopie. */}
      {brut && (
        <>
          <input type="hidden" name="voix" value={d.voix} />
          <input type="hidden" name="bruit" value={d.bruit} />
          <input type="hidden" name="ambiance" value={d.ambiance} />
          <input type="hidden" name="antiBouche" value={d.antiBouche} />
          <input type="hidden" name="respirations" value={d.respirations} />
        </>
      )}
      <button type="submit" className="button" data-testid="post-save">
        Enregistrer les réglages
      </button>{" "}
      {changed && <small className="hint">Réglages modifiés, pas encore enregistrés.</small>}
    </form>
  );
}

function Slider({
  name,
  label,
  left,
  right,
  value,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  left: string;
  right: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field slider">
      {label} <small className="hint">({value})</small>
      <input
        type="range"
        name={name}
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={`post-${name}`}
      />
      <span className="slider-ends">
        <small>{left}</small>
        <small>{right}</small>
      </span>
    </label>
  );
}

/** Écoute avant / après sur un extrait de 20 s, au même volume, en passant de l'un à l'autre. */
function Preview({
  cid,
  track: t,
  treatment,
}: {
  cid: string;
  track: PostTrack;
  treatment: Treatment;
}) {
  const [start, setStart] = useState(Math.min(60, Math.floor(t.seconds / 3)));
  const [state, setState] = useState<"idle" | "calcul" | "pret">("idle");
  const [error, setError] = useState("");
  const [side, setSide] = useState<"avant" | "apres">("apres");
  const [playing, setPlaying] = useState(false);
  const [info, setInfo] = useState("");
  const [forKey, setForKey] = useState("");
  const audio = useRef<{
    ctx: AudioContext;
    before: AudioBuffer;
    after: AudioBuffer;
    src: AudioBufferSourceNode | null;
    t0: number;
    offset: number;
  } | null>(null);

  useEffect(() => () => void audio.current?.ctx.close(), []);
  const stale = state === "pret" && forKey !== `${treatmentKey(treatment)}@${start}`;

  async function compute() {
    setState("calcul");
    setError("");
    stop();
    try {
      const r = await previewTrack(cid, t.takeId, treatment, start);
      const ctx = audio.current?.ctx ?? new AudioContext({ sampleRate: 48000 });
      const buf = (x: Float32Array) => {
        const b = ctx.createBuffer(1, x.length, 48000);
        b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
        return b;
      };
      audio.current = {
        ctx,
        before: buf(r.before),
        after: buf(r.after),
        src: null,
        t0: 0,
        offset: 0,
      };
      setInfo(
        `${r.repaired} bruit${r.repaired > 1 ? "s" : ""} de bouche et ${r.breaths} respiration${r.breaths > 1 ? "s" : ""} repérés dans l'extrait.`,
      );
      setForKey(`${treatmentKey(treatment)}@${start}`);
      setState("pret");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  function position() {
    const a = audio.current;
    if (!a) return 0;
    return a.src ? a.offset + (a.ctx.currentTime - a.t0) : a.offset;
  }

  function play(which: "avant" | "apres", from = position()) {
    const a = audio.current;
    if (!a) return;
    if (a.src) {
      a.src.onended = null;
      a.src.stop();
    }
    const buffer = which === "avant" ? a.before : a.after;
    const off = from >= buffer.duration ? 0 : from;
    const src = a.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(a.ctx.destination);
    src.onended = () => {
      a.src = null;
      a.offset = 0;
      setPlaying(false);
    };
    void a.ctx.resume();
    src.start(0, off);
    a.src = src;
    a.t0 = a.ctx.currentTime;
    a.offset = off;
    setPlaying(true);
  }

  function stop() {
    const a = audio.current;
    if (!a?.src) return;
    a.offset = position();
    a.src.onended = null;
    a.src.stop();
    a.src = null;
    setPlaying(false);
  }

  return (
    <div className="post-preview" data-testid="post-preview" data-state={state}>
      <p>
        <strong>Écouter avant / après</strong>{" "}
        <small className="hint">(extrait de 20 s, les deux au même volume)</small>
      </p>
      <label className="inline">
        À partir de{" "}
        <input
          type="number"
          min={0}
          max={Math.max(0, Math.floor(t.seconds) - 1)}
          value={start}
          onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
          className="short"
          aria-label="Début de l'extrait en secondes"
        />{" "}
        s
      </label>{" "}
      <button
        type="button"
        className="button secondary small"
        disabled={!t.complete || state === "calcul"}
        onClick={compute}
        data-testid="post-preview-compute"
      >
        {state === "calcul" ? "Calcul…" : state === "pret" ? "Recalculer" : "Préparer l'écoute"}
      </button>
      {stale && <small className="hint"> Réglages changés : recalculez pour les entendre.</small>}
      {state === "pret" && (
        <p className="ab">
          <span className="segmented" role="group" aria-label="Version écoutée">
            <button
              type="button"
              aria-pressed={side === "avant"}
              onClick={() => {
                setSide("avant");
                if (playing) play("avant");
              }}
              data-testid="post-ab-avant"
            >
              Avant
            </button>
            <button
              type="button"
              aria-pressed={side === "apres"}
              onClick={() => {
                setSide("apres");
                if (playing) play("apres");
              }}
              data-testid="post-ab-apres"
            >
              Après
            </button>
          </span>{" "}
          <button
            type="button"
            className="button small"
            onClick={() => (playing ? stop() : play(side))}
            data-testid="post-play"
          >
            {playing ? "Pause" : "Lecture"}
          </button>{" "}
          <small className="hint" data-testid="post-preview-info">
            {info}
          </small>
        </p>
      )}
      {error && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
