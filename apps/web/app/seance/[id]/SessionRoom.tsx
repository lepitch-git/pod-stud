"use client";

import { formatDuration, isValidTakeId } from "@pod-stud/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Meter } from "../../test-equipement/Checks";
import {
  RecordingStudio,
  type RecordCommand,
  type SessionControl,
} from "../../enregistrement/RecordingStudio";
import { loadDevicePrefs, loadName, saveName } from "@/lib/savedTest";
import {
  LiveKitBus,
  RelayBus,
  type Envelope,
  type RoomBus,
  type RoomMessage,
} from "@/lib/session/bus";

import { ServerClock } from "@/lib/sync/clock";

interface Peer {
  id: string;
  name: string;
  role: "hote" | "invite";
  admitted: boolean;
  phase: string;
  pending: number;
  level: number;
  seen: number;
}

interface TrackInfo {
  takeId: string;
  participant: string;
  name: string;
  browser: string;
  seconds: number;
  startOffsetMs: number;
  driftPpm: number;
  residualMs: number;
  syncPoints: number;
  clockRttMs: number | null;
}

const PHASES: Record<string, string> = {
  idle: "prêt",
  starting: "démarre…",
  recording: "enregistre",
  stopping: "s'arrête…",
  uploading: "envoi en cours",
  sent: "tout est envoyé",
};

function myId(): string {
  try {
    let id = sessionStorage.getItem("podstud.participant");
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem("podstud.participant", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

/**
 * Séance à plusieurs (étape 4) : salle d'attente, entrée des invités par l'hôte, tableau de bord,
 * départ et arrêt communs à l'heure serveur, puis pistes alignées sans clap.
 */
export function SessionRoom({ sessionId, host }: { sessionId: string; host: boolean }) {
  const role: "hote" | "invite" = host ? "hote" : "invite";
  const [me] = useState(() => (typeof window === "undefined" ? "" : myId()));
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [admitted, setAdmitted] = useState(host);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [command, setCommand] = useState<RecordCommand | null>(null);
  const [tracks, setTracks] = useState<{ startServerMs: number | null; tracks: TrackInfo[] }[]>([]);
  const [copied, setCopied] = useState(false);
  const [busKind, setBusKind] = useState<RoomBus["kind"] | null>(null);
  const bus = useRef<RoomBus | null>(null);
  const clock = useRef<ServerClock | null>(null);
  const status = useRef({ phase: "idle", pending: 0, level: -100 });
  const admittedRef = useRef(admitted);
  admittedRef.current = admitted;

  useEffect(() => setName(loadName()), []);

  const onMessage = useCallback(
    ({ from, msg }: Envelope) => {
      if (msg.type === "hello" || msg.type === "status") {
        setPeers((p) => ({
          ...p,
          [from]: {
            ...(p[from] ?? { phase: "idle", pending: 0, level: -100, admitted: false }),
            id: from,
            name: msg.name,
            role: msg.role,
            ...(msg.type === "status"
              ? { phase: msg.phase, pending: msg.pending, level: msg.level, admitted: msg.admitted }
              : {}),
            seen: Date.now(),
          },
        }));
      } else if (msg.type === "admit" && msg.to === me) setAdmitted(true);
      else if (msg.type === "command") setCommand(msg.command);
      else if (msg.type === "leave")
        setPeers((p) => {
          const n = { ...p };
          delete n[from];
          return n;
        });
    },
    [me],
  );

  // Connexion à la séance une fois le nom saisi.
  useEffect(() => {
    if (!joined || !me) return;
    const sc = new ServerClock();
    clock.current = sc;
    void sc.sample(6).then(() => sc.keepFresh());
    let b: RoomBus | null = null;
    let t: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    void (async () => {
      // Conversation en direct si LiveKit est configuré, sinon relais de test par le serveur.
      const lk = await LiveKitBus.connect(sessionId, me, name, onMessage);
      if (cancelled) return lk?.close();
      b = lk ?? new RelayBus(sessionId, me, onMessage);
      bus.current = b;
      setBusKind(b.kind);
      const hello: RoomMessage = { type: "hello", name, role };
      void b.send(hello);
      t = setInterval(() => {
        void b?.send({
          type: "status",
          name,
          role,
          admitted: admittedRef.current,
          ...status.current,
        });
      }, 1000);
    })();
    const bye = () => void b?.send({ type: "leave" });
    window.addEventListener("pagehide", bye);
    return () => {
      cancelled = true;
      if (t) clearInterval(t);
      window.removeEventListener("pagehide", bye);
      sc.stop();
      b?.close();
    };
  }, [joined, me, name, role, sessionId, onMessage]);

  // Entrée dans la conversation en direct une fois admis (l'hôte l'est d'office).
  useEffect(() => {
    if (admitted && busKind === "livekit" && bus.current instanceof LiveKitBus)
      void bus.current.goLive(loadDevicePrefs().mic?.id);
  }, [admitted, busKind]);

  // Hôte : pistes alignées de la séance, rafraîchies régulièrement.
  useEffect(() => {
    if (!host || !joined) return;
    const load = () =>
      fetch(`/api/seances/${sessionId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { takes: typeof tracks } | null) => j && setTracks(j.takes))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [host, joined, sessionId]);

  const session: SessionControl = useMemo(
    () => ({
      sessionId,
      role,
      participant: name,
      command,
      onRequest: (type, takeName) => {
        const sc = clock.current;
        if (!sc || !bus.current) return;
        // Départ dans 3 secondes, le temps que la commande arrive partout ; arrêt dans une demi-seconde.
        const atServerMs = sc.now() + (type === "start" ? 3000 : 600);
        void bus.current.send({
          type: "command",
          command: { seq: Date.now(), type, atServerMs, takeName },
        });
      },
      onStatus: (s) => (status.current = s),
    }),
    [sessionId, role, name, command],
  );

  if (!isValidTakeId(sessionId))
    return <p className="error-box">Ce lien de séance n&apos;est pas valide.</p>;

  const inviteUrl =
    typeof window === "undefined" ? "" : `${window.location.origin}/seance/${sessionId}`;
  const now = Date.now();
  const others = Object.values(peers).filter((p) => p.id !== me && now - p.seen < 8000);
  const waiting = others.filter((p) => !p.admitted && p.role === "invite");
  const inRoom = others.filter((p) => p.admitted || p.role === "hote");

  if (!joined)
    return (
      <>
        <h1>{host ? "Votre séance" : "Rejoindre la séance"}</h1>
        <section className="card">
          <label className="field">
            Votre nom
            <input value={name} onChange={(e) => setName(e.target.value)} data-testid="room-name" />
          </label>
          <button
            type="button"
            className="button"
            disabled={!name.trim()}
            onClick={() => {
              saveName(name.trim());
              setName(name.trim());
              setJoined(true);
            }}
            data-testid="room-join"
          >
            {host ? "Ouvrir la séance" : "Entrer en salle d'attente"}
          </button>
        </section>
      </>
    );

  return (
    <>
      <h1>{host ? "Votre séance" : "Séance"}</h1>
      {busKind === "relais" && (
        <p className="advice-box" data-testid="room-relay-warning">
          ⚠️ Version de test sans conversation en direct : les participants ne s&apos;entendent pas,
          et le relais entre participants n&apos;est fiable qu&apos;en local. Le direct arrivera
          quand le service LiveKit sera branché.
        </p>
      )}
      {busKind === "livekit" && admitted && (
        <p className="info-box" data-testid="room-live">
          🔊 Conversation en direct : vous entendez les autres participants. Un casque est
          conseillé.
        </p>
      )}

      {host && (
        <section className="card">
          <h2>Inviter</h2>
          <p>Envoyez ce lien aux invités :</p>
          <p>
            <code data-testid="room-invite">{inviteUrl}</code>{" "}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(inviteUrl)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }
            >
              {copied ? "Copié" : "Copier le lien"}
            </button>
          </p>
          {waiting.length > 0 && (
            <div data-testid="room-waiting">
              <h3>En salle d&apos;attente</h3>
              <ul>
                {waiting.map((p) => (
                  <li key={p.id}>
                    {p.name}{" "}
                    <button
                      type="button"
                      className="button"
                      onClick={() => void bus.current?.send({ type: "admit", to: p.id })}
                      data-testid="room-admit"
                    >
                      Faire entrer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h3>Participants</h3>
          <ul className="peers" data-testid="room-peers">
            <li>
              {name} (vous, hôte) · {PHASES[status.current.phase] ?? status.current.phase}
            </li>
            {inRoom.map((p) => (
              <li key={p.id} data-testid="room-peer" data-phase={p.phase}>
                <strong>{p.name}</strong> · {PHASES[p.phase] ?? p.phase}
                {p.pending > 0 && ` · ${p.pending} morceau${p.pending > 1 ? "x" : ""} à envoyer`}
                <Meter db={p.level} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!admitted ? (
        <section className="card" data-testid="room-lobby">
          <h2>Salle d&apos;attente</h2>
          <p>
            Bonjour {name} ! L&apos;hôte va vous faire entrer. En attendant, vérifiez votre micro
            avec le <a href="/test-equipement?mode=audio">test d&apos;équipement</a> dans un autre
            onglet.
          </p>
        </section>
      ) : (
        <RecordingStudio session={session} />
      )}

      {host && tracks.length > 0 && (
        <section className="card" data-testid="room-tracks">
          <h2>Pistes alignées</h2>
          <p className="hint">
            Toutes les pistes d&apos;une même prise commencent au même instant et durent autant :
            posez-les l&apos;une sous l&apos;autre dans votre logiciel de montage, sans clap.
          </p>
          {tracks.map((g, gi) => (
            <div key={gi}>
              <h3>
                {g.tracks[0]?.name}
                {g.startServerMs && ` · ${new Date(g.startServerMs).toLocaleTimeString("fr-FR")}`}
              </h3>
              <ul>
                {g.tracks.map((t) => (
                  <li key={t.takeId} data-testid="room-track" data-offset={t.startOffsetMs}>
                    <strong>{t.participant}</strong> · {formatDuration(t.seconds)} · décalage
                    corrigé {Math.round(t.startOffsetMs * 10) / 10} ms · dérive{" "}
                    {Math.round(t.driftPpm)} ppm ·{" "}
                    <a href={`/api/seances/${sessionId}/alignee/${t.takeId}.wav`}>
                      Télécharger (alignée)
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
