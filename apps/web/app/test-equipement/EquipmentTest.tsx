"use client";

import {
  detectBrowser,
  evaluateCamera,
  evaluateCapabilities,
  evaluateEcho,
  evaluateMic,
  evaluateNetwork,
  summarizeMic,
  VERDICT_TEXT,
  worstStatus,
  type BrowserInfo,
  type EquipmentCheck,
} from "@pod-stud/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectFrames,
  detectEcho,
  LevelMeter,
  listDevices,
  measureBrightness,
  measureNetwork,
  micConstraints,
  stopStream,
} from "@/lib/media";
import { mediaErrorHelp } from "@/lib/permissionHelp";
import { probeCapabilities } from "@/lib/probe";
import { loadName, loadSavedTest, saveName, saveTest, type SavedTest } from "@/lib/savedTest";
import { Checks, ICON, Meter } from "./Checks";

const PHRASE =
  "« Bonjour, je teste mon micro pour le podcast. Le film de ce soir est un classique, et je vais vous dire pourquoi. »";

type MicPhase = "idle" | "silence" | "speech" | "done";

export default function EquipmentTest() {
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [saved, setSaved] = useState<SavedTest | null>(null);
  const [name, setName] = useState("");
  const [video, setVideo] = useState(true);

  // Micro
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");
  const [level, setLevel] = useState(-120);
  const [micPhase, setMicPhase] = useState<MicPhase>("idle");
  const [micChecks, setMicChecks] = useState<EquipmentCheck[] | null>(null);
  const [playback, setPlayback] = useState<string | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);

  // Casque
  const [headphones, setHeadphones] = useState<boolean | null>(null);
  const [echoBusy, setEchoBusy] = useState(false);
  const [echoCheck, setEchoCheck] = useState<EquipmentCheck | null>(null);

  // Caméra
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState("");
  const [camChecks, setCamChecks] = useState<EquipmentCheck[] | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Réseau et navigateur
  const [netBusy, setNetBusy] = useState(false);
  const [netChecks, setNetChecks] = useState<EquipmentCheck[] | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [browserCheck, setBrowserCheck] = useState<EquipmentCheck | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const b = detectBrowser(navigator.userAgent);
    setBrowser(b);
    setSaved(loadSavedTest());
    setName(loadName());
    probeCapabilities()
      .then((p) => {
        const d = evaluateCapabilities(p);
        setBrowserCheck({
          id: "browser",
          label: `Navigateur (${b.label})`,
          status: d.verdict,
          detail: d.summary,
          advice:
            d.verdict === "ok" ? undefined : "Le détail est sur la page Diagnostic navigateur.",
        });
      })
      .catch(() => undefined);
  }, []);

  // Vu-mètre en continu
  useEffect(() => {
    if (!micStream) return;
    const meter = new LevelMeter(micStream);
    meterRef.current = meter;
    void meter.resume();
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 60) {
        setLevel(meter.read().peakDb);
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      meterRef.current = null;
      void meter.close();
    };
  }, [micStream]);

  // Libère micro et caméra en quittant la page
  useEffect(() => () => stopStream(micStream), [micStream]);
  useEffect(() => () => stopStream(camStream), [camStream]);

  const openMic = useCallback(
    async (deviceId?: string) => {
      setMicError(null);
      try {
        const s = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId));
        setMicStream((old) => {
          stopStream(old);
          return s;
        });
        setMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? deviceId ?? "");
        setMics(await listDevices("audioinput"));
        setMicChecks(null);
        setMicPhase("idle");
      } catch (e) {
        setMicError(mediaErrorHelp(e, browser?.family ?? "autre", "micro"));
      }
    },
    [browser],
  );

  const runMicTest = async () => {
    const meter = meterRef.current;
    if (!meter || !micStream) return;
    await meter.resume();
    setPlayback(null);
    setMicPhase("silence");
    const silence = await collectFrames(meter, 3000);

    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    if (typeof MediaRecorder !== "undefined") {
      try {
        recorder = new MediaRecorder(micStream);
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.start();
      } catch {
        recorder = null;
      }
    }
    setMicPhase("speech");
    const speech = await collectFrames(meter, 6000);
    if (recorder) {
      await new Promise<void>((resolve) => {
        recorder!.onstop = () => resolve();
        recorder!.stop();
      });
      if (chunks.length)
        setPlayback(URL.createObjectURL(new Blob(chunks, { type: chunks[0]?.type })));
    }
    setMicChecks(evaluateMic(summarizeMic(silence, speech)));
    setMicPhase("done");
  };

  const runEcho = async () => {
    const meter = meterRef.current;
    if (!meter || headphones === null) return;
    setEchoBusy(true);
    try {
      await meter.resume();
      const detected = await detectEcho(meter);
      setEchoCheck(evaluateEcho({ headphones, echoDetected: detected }));
    } finally {
      setEchoBusy(false);
    }
  };

  const openCam = async (deviceId?: string) => {
    setCamError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setCamStream((old) => {
        stopStream(old);
        return s;
      });
      setCamId(s.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? "");
      setCams(await listDevices("videoinput"));
      setCamChecks(null);
    } catch (e) {
      setCamError(mediaErrorHelp(e, browser?.family ?? "autre", "caméra"));
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !camStream) return;
    v.srcObject = camStream;
    void v.play().catch(() => undefined);
  }, [camStream]);

  const runCamCheck = () => {
    const v = videoRef.current;
    const track = camStream?.getVideoTracks()[0];
    if (!v || !track) return;
    const s = track.getSettings();
    setCamChecks(
      evaluateCamera({
        width: s.width ?? v.videoWidth,
        height: s.height ?? v.videoHeight,
        brightness: measureBrightness(v),
      }),
    );
  };

  const runNetwork = async () => {
    setNetBusy(true);
    setNetError(null);
    try {
      setNetChecks(evaluateNetwork(await measureNetwork()));
    } catch {
      setNetError(
        "Le serveur ne répond pas : vérifiez que vous êtes bien connecté à Internet, puis réessayez.",
      );
    } finally {
      setNetBusy(false);
    }
  };

  const all: EquipmentCheck[] = [
    ...(browserCheck ? [browserCheck] : []),
    ...(micChecks ?? []),
    ...(echoCheck ? [echoCheck] : []),
    ...(video ? (camChecks ?? []) : []),
    ...(netChecks ?? []),
  ];
  const complete =
    !!micChecks && !!echoCheck && !!netChecks && (!video || !!camChecks) && name.trim() !== "";
  const verdict = worstStatus(all.map((c) => c.status));

  useEffect(() => {
    if (!complete || !browser) return;
    const t: SavedTest = {
      name: name.trim(),
      at: new Date().toISOString(),
      verdict,
      checks: all,
      browser: browser.label,
    };
    saveTest(t);
  }, [complete, verdict, micChecks, echoCheck, camChecks, netChecks]);

  const report = () =>
    [
      `Test d'équipement Pod Stud, version ${process.env.NEXT_PUBLIC_APP_VERSION}`,
      `Intervenant : ${name.trim()}`,
      `Date : ${new Date().toLocaleString("fr-FR")}`,
      `Navigateur : ${browser?.label ?? "?"}`,
      `Verdict : ${verdict === "ok" ? "Vert" : verdict === "warn" ? "Orange" : "Rouge"}`,
      ...all.map(
        (c) =>
          `${ICON[c.status]} ${c.label} : ${c.detail}${c.advice ? " Conseil : " + c.advice : ""}`,
      ),
    ].join("\n");

  return (
    <div className="steps-flow">
      {saved && (
        <p className={`verdict verdict-${saved.verdict}`} data-testid="saved-test">
          {ICON[saved.verdict]} Dernier test de {saved.name} le{" "}
          {new Date(saved.at).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}{" "}
          sur {saved.browser} : {VERDICT_TEXT[saved.verdict]} Vous pouvez le refaire ci-dessous.
        </p>
      )}

      <section className="card">
        <h2>1. Votre nom</h2>
        <label className="field">
          Nom affiché aux autres et utilisé pour nommer votre piste
          <input
            type="text"
            value={name}
            maxLength={40}
            autoComplete="name"
            placeholder="Par exemple : Lola"
            onChange={(e) => {
              setName(e.target.value);
              saveName(e.target.value);
            }}
            data-testid="name"
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={video}
            onChange={(e) => setVideo(e.target.checked)}
            data-testid="video-toggle"
          />
          Je serai filmé(e) (session vidéo)
        </label>
        <p className="hint">Aucun compte n&apos;est nécessaire.</p>
      </section>

      <section className="card">
        <h2>2. Micro</h2>
        {!micStream && (
          <button type="button" className="button" onClick={() => openMic()} data-testid="mic-open">
            Autoriser le micro
          </button>
        )}
        {micError && (
          <p className="verdict verdict-ko" role="alert" data-testid="mic-error">
            {micError}
          </p>
        )}
        {micStream && (
          <>
            <label className="field">
              Micro utilisé
              <select
                value={micId}
                onChange={(e) => openMic(e.target.value)}
                data-testid="mic-select"
              >
                {mics.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Micro ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <Meter db={level} />
            <p className="hint">
              Parlez : la barre doit monter jusqu&apos;à la zone verte, sans atteindre le rouge.
            </p>
            {micPhase === "idle" || micPhase === "done" ? (
              <button type="button" className="button" onClick={runMicTest} data-testid="mic-test">
                {micPhase === "done" ? "Refaire le test du micro" : "Lancer le test du micro (9 s)"}
              </button>
            ) : (
              <p className="instruction" aria-live="polite" data-testid="mic-phase">
                {micPhase === "silence"
                  ? "Restez silencieux 3 secondes : on mesure le bruit de la pièce…"
                  : `Lisez à voix haute, comme pendant l'émission : ${PHRASE}`}
              </p>
            )}
            {micChecks && <Checks checks={micChecks} testId="mic-results" />}
            {playback && (
              <div className="playback">
                <p>Écoutez votre voix telle qu&apos;elle sera enregistrée :</p>
                <audio controls src={playback} data-testid="mic-playback" />
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>3. Casque et écho</h2>
        <p>Portez-vous un casque ou des écouteurs ?</p>
        <div className="choices">
          <label className="inline">
            <input
              type="radio"
              name="hp"
              checked={headphones === true}
              onChange={() => setHeadphones(true)}
              data-testid="hp-yes"
            />
            Oui
          </label>
          <label className="inline">
            <input
              type="radio"
              name="hp"
              checked={headphones === false}
              onChange={() => setHeadphones(false)}
              data-testid="hp-no"
            />
            Non
          </label>
        </div>
        <button
          type="button"
          className="button"
          disabled={!micStream || headphones === null || echoBusy}
          onClick={runEcho}
          data-testid="echo-test"
        >
          {echoBusy ? "Écoute en cours…" : "Tester l'écho (2 s, un bip va retentir)"}
        </button>
        {!micStream && <p className="hint">Autorisez d&apos;abord le micro.</p>}
        {echoCheck && <Checks checks={[echoCheck]} testId="echo-results" />}
      </section>

      {video && (
        <section className="card">
          <h2>4. Caméra</h2>
          {!camStream && (
            <button
              type="button"
              className="button"
              onClick={() => openCam()}
              data-testid="cam-open"
            >
              Autoriser la caméra
            </button>
          )}
          {camError && (
            <p className="verdict verdict-ko" role="alert" data-testid="cam-error">
              {camError}
            </p>
          )}
          {camStream && (
            <>
              <label className="field">
                Caméra utilisée
                <select
                  value={camId}
                  onChange={(e) => openCam(e.target.value)}
                  data-testid="cam-select"
                >
                  {cams.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Caméra ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <video
                ref={videoRef}
                className="preview"
                muted
                playsInline
                autoPlay
                data-testid="cam-preview"
              />
              <button type="button" className="button" onClick={runCamCheck} data-testid="cam-test">
                Vérifier l&apos;image
              </button>
              {camChecks && <Checks checks={camChecks} testId="cam-results" />}
            </>
          )}
        </section>
      )}

      <section className="card">
        <h2>{video ? "5" : "4"}. Connexion</h2>
        <button
          type="button"
          className="button"
          onClick={runNetwork}
          disabled={netBusy}
          data-testid="net-test"
        >
          {netBusy ? "Mesure en cours…" : "Tester ma connexion"}
        </button>
        {netError && (
          <p className="verdict verdict-ko" role="alert">
            {netError}
          </p>
        )}
        {netChecks && <Checks checks={netChecks} testId="net-results" />}
      </section>

      <section
        className="card"
        data-testid="summary"
        data-complete={complete}
        data-verdict={complete ? verdict : ""}
      >
        <h2>Résultat</h2>
        {complete ? (
          <>
            <p className={`verdict verdict-${verdict}`} data-testid="final-verdict">
              {ICON[verdict]} {VERDICT_TEXT[verdict]}
            </p>
            <Checks checks={all.filter((c) => c.status !== "ok")} />
            <p className="hint">
              Ce résultat est conservé sur cet appareil pour le jour de l&apos;enregistrement.
            </p>
            <button
              type="button"
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(report());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 3000);
                } catch {
                  setCopied(false);
                }
              }}
              data-testid="copy-eq-report"
            >
              {copied ? "Rapport copié" : "Copier le rapport pour le cahier de recette"}
            </button>
          </>
        ) : (
          <p className="hint">
            Terminez les étapes ci-dessus{name.trim() === "" ? ", sans oublier votre nom" : ""}.
          </p>
        )}
      </section>
    </div>
  );
}
