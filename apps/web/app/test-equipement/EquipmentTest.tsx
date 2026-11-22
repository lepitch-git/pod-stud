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
  cleanLabel,
  dedupeDevices,
  evaluateStorage,
  type BrowserInfo,
  type EquipmentCheck,
  type SessionMode,
} from "@pod-stud/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  canChooseOutput,
  collectFrames,
  detectEcho,
  LevelMeter,
  listDevices,
  measureBrightness,
  measureNetwork,
  micConstraints,
  sleep,
  stopStream,
  testSoundUrl,
} from "@/lib/media";
import { mediaErrorHelp } from "@/lib/permissionHelp";
import { probeCapabilities } from "@/lib/probe";
import {
  findPreferred,
  loadDevicePrefs,
  loadName,
  loadSavedTest,
  saveDevicePref,
  saveName,
  saveTest,
  type SavedTest,
} from "@/lib/savedTest";
import { DeviceSelect } from "./DeviceSelect";
import { Checks, ICON, Meter } from "./Checks";

type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };
type SelectOutput = { selectAudioOutput?: (o?: { deviceId?: string }) => Promise<MediaDeviceInfo> };

async function listClean(kind: MediaDeviceKind) {
  return dedupeDevices(await listDevices(kind));
}

const MODES = [
  {
    key: "video",
    label: "Enregistrer l'audio et la vidéo",
    detail: "On se voit, et le son comme l'image sont enregistrés.",
    icons: "🎥 🎙️",
  },
  {
    key: "visio",
    label: "Enregistrer l'audio, vidéo affichée",
    detail: "On se voit pendant la session, mais seul le son est enregistré.",
    icons: "👀 🎙️",
  },
  {
    key: "audio",
    label: "Audio seul, sans vidéo",
    detail: "On ne se voit pas ; seul le son est enregistré.",
    icons: "🎙️",
  },
] as const;

const PHRASE =
  "« Bonjour, je teste mon micro pour le podcast. Le film de ce soir est un classique, et je vais vous dire pourquoi. »";

type MicPhase = "idle" | "silence" | "speech" | "done";

export default function EquipmentTest() {
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [saved, setSaved] = useState<SavedTest | null>(null);
  const [name, setName] = useState("");
  // Type de session : choisi par l'hôte (paramètre ?mode= du lien), sinon par la personne qui teste
  // Deux réglages distincts, comme sur Zencastr : ce qu'on voit en direct, et ce qui est enregistré.
  // Enregistrer la vidéo suppose de la voir en direct.
  const [live, setLive] = useState<SessionMode>("video");
  const [rec, setRec] = useState<SessionMode>("audio");
  const [modeLocked, setModeLocked] = useState(false);
  const [freeBytes, setFreeBytes] = useState<number | null | undefined>(undefined);
  const video = live === "video";
  const modeKey = rec === "video" ? "video" : live === "video" ? "visio" : "audio";
  const setModeKey = (k: string) => {
    setLive(k === "audio" ? "audio" : "video");
    setRec(k === "video" ? "video" : "audio");
  };

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

  // Sortie audio
  const [outs, setOuts] = useState<MediaDeviceInfo[]>([]);
  const [outId, setOutId] = useState("");
  const [soundPlayed, setSoundPlayed] = useState(false);
  const [deviceNews, setDeviceNews] = useState<string | null>(null);

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
    // Lien d'invitation : ?mode=audio (audio seul), visio (vidéo en direct, audio enregistré), video (tout enregistré)
    const m = new URLSearchParams(window.location.search).get("mode");
    if (m === "audio" || m === "visio" || m === "video") {
      setModeKey(m);
      setModeLocked(true);
    }
    probeCapabilities()
      .then((p) => {
        setFreeBytes(p.storageAvailableBytes);
        // l'espace disque est évalué à part, selon le type de session
        const d = evaluateCapabilities(p);
        const others = d.checks.filter((c) => c.id !== "storageSpace");
        const status = worstStatus(others.map((c) => c.status));
        setBrowserCheck({
          id: "browser",
          label: `Navigateur (${b.label})`,
          status,
          detail:
            status === "ok"
              ? "Ce navigateur est prêt pour l'enregistrement."
              : status === "warn"
                ? "Ce navigateur peut enregistrer, avec quelques points d'attention."
                : "Ce navigateur ne permet pas d'enregistrer dans de bonnes conditions.",
          advice: status === "ok" ? undefined : "Le détail est sur la page Diagnostic navigateur.",
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
        // certains navigateurs renvoient « default » : on garde l'identifiant demandé quand il y en a un
        setMicId(deviceId ?? s.getAudioTracks()[0]?.getSettings().deviceId ?? "");
        const list = await listClean("audioinput");
        setMics(list);
        if (deviceId) {
          const d = list.find((x) => x.deviceId === deviceId);
          saveDevicePref("mic", deviceId, d?.label ?? "");
        } else {
          // premier accès : on reprend le micro choisi la dernière fois s'il est branché
          const pref = findPreferred(list, loadDevicePrefs().mic);
          const current = s.getAudioTracks()[0]?.label;
          if (pref && pref.label !== current) {
            stopStream(s);
            setMicStream(null);
            return openMic(pref.deviceId);
          }
        }
        setOuts(await listClean("audiooutput"));
        setMicChecks(null);
        setMicPhase("idle");
      } catch (e) {
        setMicError(mediaErrorHelp(e, browser?.family ?? "autre", "micro"));
      }
    },
    [browser],
  );

  // Branchement et débranchement à chaud
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = async () => {
      const [newMics, newCams, newOuts] = await Promise.all([
        listClean("audioinput"),
        listClean("videoinput"),
        listClean("audiooutput"),
      ]);
      const known = new Set([...mics, ...cams, ...outs].map((d) => cleanLabel(d.label)));
      const added = [...newMics, ...newCams, ...newOuts].filter(
        (d) => d.label && !known.has(cleanLabel(d.label)),
      );
      if (micStream) setMics(newMics);
      if (camStream) setCams(newCams);
      setOuts(newOuts);
      const micGone = micStream && micStream.getAudioTracks()[0]?.readyState === "ended";
      const camGone = camStream && camStream.getVideoTracks()[0]?.readyState === "ended";
      if (micGone) {
        setDeviceNews(
          "Le micro choisi a été débranché : nous sommes repassés sur le micro par défaut. Vérifiez la liste.",
        );
        void openMic();
      } else if (camGone) {
        setDeviceNews("La caméra choisie a été débranchée : choisissez-en une autre.");
        setCamStream(null);
      } else if (added.length) {
        setDeviceNews(
          `Nouvel appareil branché : ${added.map((d) => cleanLabel(d.label)).join(", ")}. Vous pouvez le choisir dans la liste.`,
        );
      }
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [mics, cams, outs, micStream, camStream, openMic]);

  // Sortie audio mémorisée
  useEffect(() => {
    const saved = findPreferred(outs, loadDevicePrefs().out)?.deviceId;
    if (saved && saved !== outId && !outId) setOutId(saved);
    else if (!outId && outs[0]) setOutId(outs[0].deviceId);
  }, [outs, outId]);

  const chooseOutput = (id: string) => {
    setOutId(id);
    saveDevicePref("out", id, outs.find((x) => x.deviceId === id)?.label ?? "");
    setSoundPlayed(false);
  };

  const pickOutputFirefox = async () => {
    try {
      const d = await (navigator.mediaDevices as MediaDevices & SelectOutput).selectAudioOutput?.();
      if (d) {
        setOuts((o) => (o.some((x) => x.deviceId === d.deviceId) ? o : [...o, d]));
        chooseOutput(d.deviceId);
      }
    } catch {
      /* choix annulé */
    }
  };

  const playTestSound = async () => {
    const a: SinkElement = new Audio(testSoundUrl());
    if (outId && a.setSinkId) await a.setSinkId(outId).catch(() => undefined);
    await a.play().catch(() => undefined);
    setSoundPlayed(true);
  };

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
      // L'arrêt de l'enregistreur ne doit jamais bloquer le test : 2 secondes au plus.
      await Promise.race([
        new Promise<void>((resolve) => {
          recorder!.onstop = () => resolve();
          recorder!.stop();
        }),
        sleep(2000),
      ]);
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
      const ctx = meter.ctx as SinkContext;
      if (outId && ctx.setSinkId) await ctx.setSinkId(outId).catch(() => undefined);
      const detected = await detectEcho(meter);
      setEchoCheck(evaluateEcho({ headphones, echoDetected: detected }));
    } finally {
      setEchoBusy(false);
    }
  };

  const openCam = async (deviceId?: string) => {
    setCamError(null);
    const savedCam = deviceId ? undefined : loadDevicePrefs().cam?.id;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: deviceId ? { exact: deviceId } : savedCam ? { ideal: savedCam } : undefined,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setCamStream((old) => {
        stopStream(old);
        return s;
      });
      setCamId(deviceId ?? s.getVideoTracks()[0]?.getSettings().deviceId ?? "");
      const camList = await listClean("videoinput");
      setCams(camList);
      if (deviceId)
        saveDevicePref("cam", deviceId, camList.find((x) => x.deviceId === deviceId)?.label ?? "");
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
    ...(freeBytes !== undefined ? [evaluateStorage(freeBytes, rec)] : []),
    ...(micChecks ?? []),
    ...(echoCheck ? [echoCheck] : []),
    // la définition de la caméra ne compte que si la vidéo est enregistrée
    ...(video ? (camChecks ?? []).filter((c) => rec === "video" || c.id !== "resolution") : []),
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
      {deviceNews && (
        <p className="advice-box" role="status" data-testid="device-news">
          {deviceNews}{" "}
          <button type="button" className="linklike" onClick={() => setDeviceNews(null)}>
            OK
          </button>
        </p>
      )}
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
        <fieldset className="mode" data-testid="mode">
          <legend>Type de session</legend>
          {modeLocked ? (
            <p data-testid="mode-locked">
              {MODES.find((x) => x.key === modeKey)?.label}, choisi par l&apos;hôte.
            </p>
          ) : (
            <>
              {MODES.map((x) => (
                <label className={`mode-card${modeKey === x.key ? " selected" : ""}`} key={x.key}>
                  <input
                    type="radio"
                    name="mode"
                    checked={modeKey === x.key}
                    onChange={() => setModeKey(x.key)}
                    data-testid={`mode-${x.key}`}
                  />
                  <span className="mode-icons" aria-hidden>
                    {x.icons}
                  </span>
                  <span>
                    <strong>{x.label}</strong>
                    <br />
                    <span className="hint">{x.detail}</span>
                  </span>
                </label>
              ))}
              <p className="hint">
                Dans une vraie session, c&apos;est l&apos;hôte qui choisit, et le lien
                d&apos;invitation règle ce choix tout seul.
              </p>
            </>
          )}
        </fieldset>
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
            <DeviceSelect
              kind="micro"
              devices={mics}
              value={micId}
              onChange={(id) => openMic(id)}
              testId="mic-select"
            />
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
        <h2>3. Écoute : casque et écho</h2>
        {canChooseOutput() && outs.length > 0 ? (
          <DeviceSelect
            kind="sortie"
            devices={outs}
            value={outId}
            onChange={chooseOutput}
            testId="out-select"
          />
        ) : canChooseOutput() &&
          (navigator.mediaDevices as MediaDevices & SelectOutput)?.selectAudioOutput ? (
          <p>
            <button
              type="button"
              className="button"
              onClick={pickOutputFirefox}
              data-testid="out-pick"
            >
              Choisir la sortie audio
            </button>
          </p>
        ) : (
          <p className="info-box" data-testid="out-system">
            Sur ce navigateur, la sortie audio se choisit dans le système :{" "}
            {browser?.family === "safari-ios"
              ? "branchez le casque, ou ouvrez le Centre de contrôle et touchez l'icône AirPlay du lecteur."
              : browser?.family === "chrome-android"
                ? "branchez le casque ; le téléphone bascule dessus automatiquement."
                : "sur Mac, menu Pomme › Réglages Système › Son › Sortie ; sur Windows, l'icône haut-parleur de la barre des tâches."}
          </p>
        )}
        <p>
          <button
            type="button"
            className="button secondary"
            onClick={playTestSound}
            data-testid="out-test"
          >
            Tester le son
          </button>
          {soundPlayed && (
            <span className="hint" data-testid="out-test-hint">
              {" "}
              Vous devez entendre trois notes. Sinon, changez de sortie ou montez le volume.
            </span>
          )}
        </p>
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
              <DeviceSelect
                kind="camera"
                devices={cams}
                value={camId}
                onChange={(id) => openCam(id)}
                testId="cam-select"
              />
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
