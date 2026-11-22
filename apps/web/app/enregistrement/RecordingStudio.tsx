"use client";

import {
  BYTES_PER_SAMPLE,
  chunkFrames,
  chunkName,
  detectBrowser,
  evaluateStorage,
  formatDuration,
  newTakeId,
  type EquipmentCheck,
  type Gap,
  type Marker,
} from "@pod-stud/shared";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeviceSelect } from "../test-equipement/DeviceSelect";
import { Checks, Meter } from "../test-equipement/Checks";
import { LevelMeter, listDevices, micConstraints, stopStream } from "@/lib/media";
import { mediaErrorHelp } from "@/lib/permissionHelp";
import {
  findPreferred,
  loadDevicePrefs,
  loadName,
  saveDevicePref,
  saveName,
} from "@/lib/savedTest";
import { LocalRecorder } from "@/lib/recorder/recorder";
import {
  getTake,
  loadTakes,
  localChunks,
  putTake,
  removeChunk,
  updateTake,
  type LocalTake,
} from "@/lib/recorder/takes";
import { Uploader } from "@/lib/recorder/uploader";

type Phase = "idle" | "starting" | "recording" | "stopping" | "uploading" | "sent";
type LockState = "pending" | "ok" | "busy";

interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export function RecordingStudio() {
  const [lock, setLock] = useState<LockState>("pending");
  const [name, setName] = useState("");
  const [takeName, setTakeName] = useState("Prise 1");
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [level, setLevel] = useState(-100);
  const [storageKind, setStorageKind] = useState<string | null>(null);
  const [storageCheck, setStorageCheck] = useState<EquipmentCheck | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [takeId, setTakeId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [written, setWritten] = useState(0);
  const [lastWrite, setLastWrite] = useState(0);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState<"on" | "off" | "absent">("off");
  const [, setTick] = useState(0);
  const [takes, setTakes] = useState<LocalTake[]>([]);
  const [recovered, setRecovered] = useState<string | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const meter = useRef<LevelMeter | null>(null);
  const recorder = useRef<LocalRecorder | null>(null);
  const uploader = useRef<Uploader | null>(null);
  const wake = useRef<WakeLockSentinelLike | null>(null);
  const clock = useRef({ start: 0, frames: 0, rate: 48000, lag: 0, hiddenAt: 0 });
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const takeIdRef = useRef<string | null>(null);
  takeIdRef.current = takeId;

  const refreshTakes = useCallback(() => setTakes(loadTakes().slice().reverse()), []);

  // --- Un seul onglet à la fois (CR-12), puis reprise des prises interrompues (CR-05 à CR-07) ---
  useEffect(() => {
    setName(loadName());
    const up = new Uploader();
    uploader.current = up;
    const unsub = up.subscribe(() => {
      setTick((t) => t + 1);
      refreshTakes();
    });
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => (release = r));
    const onLock = async (granted: boolean) => {
      if (!granted) {
        setLock("busy");
        return;
      }
      setLock("ok");
      await recoverTakes(up, setRecovered);
      refreshTakes();
    };
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) {
      void locks.request("podstud-enregistrement", { ifAvailable: true }, async (l) => {
        await onLock(!!l);
        if (l) await held;
      });
    } else void onLock(true);
    fetch("/api/stockage")
      .then((r) => r.json())
      .then((j: { kind: string }) => setStorageKind(j.kind))
      .catch(() => setStorageKind(null));
    return () => {
      unsub();
      up.dispose();
      (release as (() => void) | null)?.();
    };
  }, [refreshTakes]);

  // --- Micro ---
  const openMic = useCallback(async (deviceId?: string) => {
    meter.current?.close();
    stopStream(stream.current);
    setMicError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
      stream.current = s;
      const list = await listDevices("audioinput");
      setMics(list);
      const track = s.getAudioTracks()[0];
      const id = deviceId ?? track?.getSettings().deviceId ?? "";
      if (deviceId) saveDevicePref("mic", deviceId, track?.label ?? "");
      else {
        const pref = findPreferred(list, loadDevicePrefs().mic);
        if (pref && pref.label !== track?.label) return openMic(pref.deviceId);
      }
      setMicId(list.find((d) => d.label === track?.label)?.deviceId ?? id);
      meter.current = new LevelMeter(s);
      await meter.current.resume();
    } catch (e) {
      setMicError(mediaErrorHelp(e, detectBrowser(navigator.userAgent).family, "micro"));
    }
  }, []);

  useEffect(() => {
    if (lock !== "ok") return;
    void openMic();
    void (async () => {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      const free = est?.quota != null ? est.quota - (est.usage ?? 0) : null;
      setStorageCheck(evaluateStorage(free, "audio"));
    })();
    return () => {
      meter.current?.close();
      stopStream(stream.current);
    };
  }, [lock, openMic]);

  // Vu-mètre et horloge (détection des trous)
  useEffect(() => {
    const t = setInterval(() => {
      if (meter.current) setLevel(meter.current.read().rmsDb);
      if (phaseRef.current !== "recording") return;
      const c = clock.current;
      const wall = (performance.now() - c.start) / 1000;
      const captured = c.frames / c.rate;
      const lag = wall - captured;
      // Plus de 2 s d'écart nouvelles : le son ne nous est pas parvenu (appli en arrière-plan, micro coupé).
      if (lag - c.lag > 2) {
        const gap = { at: captured, seconds: Math.round((lag - c.lag) * 10) / 10 };
        c.lag = lag;
        setGaps((g) => {
          const next = [...g, gap];
          if (takeIdRef.current) updateTake(takeIdRef.current, (x) => (x.gaps = next));
          return next;
        });
      }
      setSeconds(captured);
    }, 250);
    return () => clearInterval(t);
  }, []);

  // Avertir avant de fermer la page pendant l'enregistrement ou l'envoi
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === "idle" || phaseRef.current === "sent") {
        if (!uploader.current?.status.pending) return;
      }
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // Écran allumé (ENR-08) : redemandé au retour sur la page
  const requestWake = useCallback(async () => {
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request(t: "screen"): Promise<WakeLockSentinelLike> };
      }
    ).wakeLock;
    if (!wl) return setWakeLock("absent");
    try {
      wake.current = await wl.request("screen");
      setWakeLock("on");
    } catch {
      setWakeLock("off");
    }
  }, []);
  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "visible" && phaseRef.current === "recording")
        void requestWake();
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [requestWake]);

  const addMarker = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    setMarkers((m) => {
      const next = [
        ...m,
        { at: clock.current.frames / clock.current.rate, label: `Marqueur ${m.length + 1}` },
      ];
      if (takeIdRef.current) updateTake(takeIdRef.current, (x) => (x.markers = next));
      return next;
    });
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      if (e.key === "m" || e.key === "M") addMarker();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [addMarker]);

  // --- Démarrer / arrêter ---
  async function start() {
    if (!stream.current) return;
    setError(null);
    setPhase("starting");
    saveName(name);
    const id = newTakeId();
    const browser = detectBrowser(navigator.userAgent);
    const take: LocalTake = {
      id,
      name: takeName.trim() || "Prise",
      participant: name.trim(),
      sampleRate: 48000,
      startedAt: new Date().toISOString(),
      endedAt: null,
      state: "recording",
      chunkCount: null,
      sent: [],
      markers: [],
      gaps: [],
      browser: `${browser.label} ${browser.version}`.trim(),
    };
    try {
      await navigator.storage?.persist?.().catch(() => false);
      const rec = new LocalRecorder({
        onChunk: (index) => {
          setWritten(index + 1);
          uploader.current?.add(id, index);
        },
        onProgress: (frames) => {
          clock.current.frames = frames;
          setLastWrite(Date.now());
        },
        onError: (msg) => setError(msg),
      });
      const rate = await rec.prepare(stream.current, id);
      take.sampleRate = rate;
      putTake(take);
      recorder.current = rec;
      clock.current = { start: performance.now(), frames: 0, rate, lag: 0, hiddenAt: 0 };
      setTakeId(id);
      setMarkers([]);
      setGaps([]);
      setWritten(0);
      setSeconds(0);
      await rec.start();
      setPhase("recording");
      void requestWake();
      refreshTakes();
    } catch (e) {
      recorder.current?.dispose();
      setError(
        `L'enregistrement n'a pas pu démarrer : ${(e as Error).message}. ` +
          "Ce navigateur ne permet peut-être pas l'écriture locale : essayez une version récente de Chrome, Firefox, Safari ou Edge.",
      );
      setPhase("idle");
    }
  }

  async function stop() {
    const rec = recorder.current;
    const id = takeIdRef.current;
    if (!rec || !id) return;
    setPhase("stopping");
    try {
      const r = await rec.stop();
      updateTake(id, (t) => {
        t.chunkCount = r.chunkCount;
        t.endedAt = new Date().toISOString();
        t.state = "uploading";
      });
      setSeconds(r.frames / clock.current.rate);
      setWritten(r.chunkCount);
    } catch (e) {
      setError((e as Error).message);
    }
    recorder.current = null;
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
    setWakeLock("off");
    setPhase("uploading");
    await uploader.current?.maybeFinish(id);
    refreshTakes();
    const n = Number(/(\d+)$/.exec(takeName)?.[1] ?? 0);
    setTakeName(n ? takeName.replace(/\d+$/, String(n + 1)) : `${takeName} 2`);
  }

  const current = takeId ? (takes.find((t) => t.id === takeId) ?? getTake(takeId)) : undefined;
  useEffect(() => {
    if (phase === "uploading" && current?.state === "done") setPhase("sent");
  }, [phase, current?.state]);

  const st = uploader.current?.status;
  const pendingCurrent = current ? (current.chunkCount ?? written) - current.sent.length : 0;
  const localOk = phase === "recording" && !error && Date.now() - lastWrite < 3000;

  if (lock === "busy")
    return (
      <p className="error-box" data-testid="rec-busy">
        Un enregistrement est déjà ouvert dans un autre onglet de ce navigateur. Fermez cet
        onglet-ci et revenez sur l&apos;autre : deux enregistrements simultanés sur le même appareil
        abîmeraient la piste.
      </p>
    );

  return (
    <>
      {recovered && (
        <p className="info-box" data-testid="rec-recovered">
          {recovered}
        </p>
      )}
      {storageKind === "temporaire" && (
        <p className="advice-box" data-testid="rec-storage-temp">
          ⚠️ Version de test : le serveur garde les enregistrements dans un espace temporaire, qui
          peut être vidé à tout moment. Téléchargez votre piste juste après l&apos;envoi.
        </p>
      )}

      <section className="card">
        <h2>1. Avant de commencer</h2>
        <label className="field">
          Votre nom
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={phase !== "idle" && phase !== "sent"}
            data-testid="rec-name"
          />
        </label>
        <label className="field">
          Nom de la prise
          <input
            value={takeName}
            onChange={(e) => setTakeName(e.target.value)}
            disabled={phase !== "idle" && phase !== "sent"}
            data-testid="rec-take-name"
          />
        </label>
        {micError ? (
          <p className="error-box" data-testid="rec-mic-error">
            {micError}
          </p>
        ) : (
          <>
            <DeviceSelect
              kind="micro"
              devices={mics}
              value={micId}
              onChange={(id) => void openMic(id)}
              testId="rec-mic"
            />
            <Meter db={level} />
          </>
        )}
        {storageCheck && <Checks checks={[storageCheck]} testId="rec-storage" />}
        <p className="hint">
          Pas encore testé votre micro ?{" "}
          <Link href="/test-equipement?mode=audio">Tester mon équipement</Link>
        </p>
      </section>

      <section className="card" data-testid="rec-panel" data-phase={phase}>
        <h2>2. Enregistrement</h2>
        <div className="rec-controls">
          {phase === "recording" || phase === "stopping" ? (
            <>
              <button
                type="button"
                className="button danger"
                onClick={() => void stop()}
                disabled={phase === "stopping"}
                data-testid="rec-stop"
              >
                ■ Arrêter
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={addMarker}
                data-testid="rec-marker"
              >
                Marqueur (touche M)
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => void start()}
              disabled={
                !stream.current || phase === "starting" || phase === "uploading" || lock !== "ok"
              }
              data-testid="rec-start"
            >
              ● Enregistrer
            </button>
          )}
          <span className="rec-time" data-testid="rec-time">
            {formatDuration(seconds)}
          </span>
        </div>

        {(phase === "recording" || phase === "stopping") && (
          <ul className="rec-status">
            <li data-testid="rec-local" data-ok={localOk}>
              {localOk ? "🟢 Enregistrement local OK" : "🔴 Enregistrement local interrompu"} —{" "}
              {written} morceau{written > 1 ? "x" : ""} écrit{written > 1 ? "s" : ""} sur
              l&apos;appareil
            </li>
            <li>
              {wakeLock === "on"
                ? "🔆 L'écran reste allumé pendant l'enregistrement."
                : wakeLock === "absent"
                  ? "⚠️ Ce navigateur ne peut pas empêcher la mise en veille : touchez l'écran de temps en temps."
                  : "⚠️ L'écran pourrait se mettre en veille."}
            </li>
          </ul>
        )}

        {takeId && current && (
          <p
            className="rec-upload"
            data-testid="rec-upload"
            data-pending={pendingCurrent}
            data-online={st?.online}
          >
            {current.state === "done"
              ? "✅ Tout est envoyé, vous pouvez fermer la page."
              : st && (!st.online || st.error)
                ? `⏸️ Envoi en attente (${st.online ? st.error : "pas de connexion"}) : ${pendingCurrent} morceau${pendingCurrent > 1 ? "x" : ""} gardé${pendingCurrent > 1 ? "s" : ""} sur l'appareil. L'envoi reprendra tout seul.`
                : phase === "recording"
                  ? `📤 Envoi au fil de l'eau : ${current.sent.length} morceau${current.sent.length > 1 ? "x" : ""} reçu${current.sent.length > 1 ? "s" : ""} par le serveur.`
                  : `📤 Envoi en cours, ne fermez pas la page : ${pendingCurrent} morceau${pendingCurrent > 1 ? "x" : ""} restant${pendingCurrent > 1 ? "s" : ""}.`}
            {st?.retryAt && current.state !== "done" && (
              <>
                {" "}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => uploader.current?.retryNow()}
                >
                  Réessayer maintenant
                </button>
              </>
            )}
          </p>
        )}

        {gaps.length > 0 && (
          <p className="advice-box" data-testid="rec-gaps">
            ⚠️ Le son ne nous est pas parvenu pendant{" "}
            {gaps.map((g) => `${g.seconds} s (à ${formatDuration(g.at)})`).join(", ")}. Cela arrive
            quand l&apos;application passe en arrière-plan ou que l&apos;écran se verrouille :
            gardez la page ouverte au premier plan.
          </p>
        )}
        {error && (
          <p className="error-box" data-testid="rec-error">
            {error}
          </p>
        )}
        {markers.length > 0 && (
          <p className="hint" data-testid="rec-markers">
            Marqueurs : {markers.map((m) => formatDuration(m.at)).join(", ")}
          </p>
        )}
      </section>

      <section className="card">
        <h2>3. Mes prises sur cet appareil</h2>
        {takes.length === 0 ? (
          <p className="hint">Aucune prise pour l&apos;instant.</p>
        ) : (
          <ul className="takes" data-testid="rec-takes">
            {takes.map((t) => (
              <TakeRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function TakeRow({ t }: { t: LocalTake }) {
  const when = new Date(t.startedAt).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <li data-testid="rec-take" data-state={t.state} data-id={t.id}>
      <strong>{t.name}</strong> · {when}
      {t.participant && ` · ${t.participant}`} ·{" "}
      {t.state === "done" ? (
        <>
          envoyée ✅ ·{" "}
          <a href={`/api/prises/${t.id}/piste.wav`} data-testid="rec-download">
            Télécharger la piste WAV
          </a>
          {t.markers.length > 0 && (
            <>
              {" "}
              · <a href={`/api/prises/${t.id}/marqueurs.txt`}>Marqueurs (Audacity)</a>
            </>
          )}
        </>
      ) : t.state === "recording" ? (
        "en cours d'enregistrement"
      ) : (
        `envoi en cours (${t.sent.length}/${t.chunkCount ?? "?"})`
      )}
      {t.recovered && " · reprise après interruption"}
    </li>
  );
}

/**
 * Prises interrompues (onglet fermé, navigateur planté, ordinateur redémarré) : les morceaux restés sur
 * l'appareil sont comptés, la prise est clôturée et l'envoi repart. On ne perd au plus que la dernière seconde.
 */
async function recoverTakes(up: Uploader, say: (s: string) => void) {
  const pending = loadTakes().filter((t) => t.state !== "done");
  let recoveredSeconds = 0;
  let n = 0;
  for (const t of pending) {
    if (t.state === "recording") {
      const local = await localChunks(t.id);
      const nonEmpty = local.filter((c) => c.size > 0);
      const maxLocal = nonEmpty.length ? Math.max(...nonEmpty.map((c) => c.index)) : -1;
      const maxSent = t.sent.length ? Math.max(...t.sent) : -1;
      const count = Math.max(maxLocal, maxSent) + 1;
      const full = chunkFrames(t.sampleRate) * BYTES_PER_SAMPLE;
      const bytes = t.sent.length * full + nonEmpty.reduce((s, c) => s + c.size, 0);
      recoveredSeconds += bytes / BYTES_PER_SAMPLE / t.sampleRate;
      n++;
      updateTake(t.id, (x) => {
        x.state = "uploading";
        x.chunkCount = count;
        x.recovered = true;
        x.endedAt = new Date().toISOString();
      });
      // Les fichiers vides (morceau à peine commencé) sont ignorés.
      for (const c of local) if (c.size === 0) await removeChunk(t.id, chunkName(c.index));
    }
    void up.resume(t.id);
  }
  if (n)
    say(
      `Une prise interrompue a été retrouvée sur cet appareil (${formatDuration(recoveredSeconds)} d'enregistrement). ` +
        "Son envoi a repris automatiquement ; au plus la dernière seconde avant la fermeture a pu être perdue.",
    );
}
