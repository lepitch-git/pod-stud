import type { RecordCommand } from "@/app/enregistrement/RecordingStudio";

/** Messages échangés entre participants d'une séance. */
export type RoomMessage =
  | { type: "hello"; name: string; role: "hote" | "invite" }
  | {
      type: "status";
      name: string;
      role: "hote" | "invite";
      phase: string;
      pending: number;
      level: number;
      admitted: boolean;
    }
  | { type: "admit"; to: string }
  | { type: "command"; command: RecordCommand }
  | { type: "leave" };

export interface Envelope {
  from: string;
  msg: RoomMessage;
}

export interface RoomBus {
  kind: "livekit" | "relais";
  send(msg: RoomMessage): Promise<void>;
  close(): void;
}

/**
 * Relais par le serveur de l'application (sans LiveKit) : interrogation toutes les 400 ms.
 * Chaque participant reçoit aussi ses propres messages, ce qui simplifie la logique (l'hôte applique
 * sa propre commande de départ exactement comme les invités).
 */
export class RelayBus implements RoomBus {
  readonly kind = "relais" as const;
  private after = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly me: string,
    private readonly onMessage: (e: Envelope) => void,
  ) {
    void this.poll();
  }

  private async poll() {
    if (this.closed) return;
    try {
      const r = await fetch(`/api/seances/${this.sessionId}/messages?after=${this.after}`, {
        cache: "no-store",
      });
      const { messages } = (await r.json()) as {
        messages: { n: number; from: string; msg: RoomMessage }[];
      };
      for (const m of messages) {
        this.after = Math.max(this.after, m.n);
        this.onMessage({ from: m.from, msg: m.msg });
      }
    } catch {
      /* réseau coupé : on réessaie */
    }
    this.timer = setTimeout(() => void this.poll(), 400);
  }

  async send(msg: RoomMessage) {
    await fetch(`/api/seances/${this.sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: this.me, msg }),
    }).catch(() => undefined);
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * Conversation en direct par LiveKit : le son de chacun (avec annulation d'écho, distinct de la piste
 * enregistrée en pleine qualité) et les messages de la séance passent par le même salon.
 * Les invités en salle d'attente sont connectés mais n'entendent personne et ne sont pas entendus
 * tant que l'hôte ne les a pas fait entrer.
 */
export class LiveKitBus implements RoomBus {
  readonly kind = "livekit" as const;
  private room: import("livekit-client").Room | null = null;
  private audioEls: HTMLMediaElement[] = [];
  private live = false;

  private constructor(
    private readonly me: string,
    private readonly onMessage: (e: Envelope) => void,
  ) {}

  /** Connexion au salon ; rend null si la conversation en direct n'est pas configurée. */
  static async connect(
    sessionId: string,
    me: string,
    name: string,
    onMessage: (e: Envelope) => void,
    invitation?: string,
  ): Promise<LiveKitBus | null> {
    const r = await fetch("/api/livekit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, identity: me, name, invitation }),
    }).catch(() => null);
    if (!r?.ok) return null;
    const { url, token } = (await r.json()) as { url: string; token: string };
    const lk = await import("livekit-client");
    const bus = new LiveKitBus(me, onMessage);
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    bus.room = room;
    room.on(lk.RoomEvent.DataReceived, (payload, participant) => {
      try {
        // L'expéditeur voyage dans le message : selon les versions de LiveKit, l'événement ne
        // précise pas toujours qui l'a envoyé.
        const e = JSON.parse(new TextDecoder().decode(payload)) as Partial<Envelope>;
        const from = e.from ?? participant?.identity;
        if (from && e.msg) onMessage({ from, msg: e.msg });
      } catch {
        /* message illisible ignoré */
      }
    });
    room.on(lk.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== lk.Track.Kind.Audio) return;
      const el = track.attach();
      el.muted = !bus.live;
      el.dataset.podstud = "live";
      document.body.appendChild(el);
      bus.audioEls.push(el);
    });
    room.on(lk.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((e) => e.remove()));
    try {
      await room.connect(url, token, { autoSubscribe: true });
    } catch {
      return null;
    }
    return bus;
  }

  /** Entrée dans la conversation (après admission) : on publie son micro et on entend les autres. */
  async goLive(deviceId?: string) {
    if (!this.room || this.live) return;
    this.live = true;
    this.audioEls.forEach((e) => (e.muted = false));
    await this.room.localParticipant
      .setMicrophoneEnabled(true, {
        deviceId,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      .catch(() => undefined);
  }

  async send(msg: RoomMessage) {
    // On se livre aussi le message à soi-même, comme le relais.
    const envelope: Envelope = { from: this.me, msg };
    this.onMessage(envelope);
    await this.room?.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify(envelope)), { reliable: true })
      .catch((e: unknown) => console.warn("Message de séance non envoyé", e));
  }

  close() {
    this.audioEls.forEach((e) => e.remove());
    void this.room?.disconnect();
  }
}
