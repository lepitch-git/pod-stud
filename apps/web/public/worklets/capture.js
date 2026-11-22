// Processeur audio : recopie le son brut du micro (premier canal) par blocs de 2048 échantillons
// et l'envoie directement au worker d'écriture, sans passer par la page (ENR-03).
// Le départ et l'arrêt peuvent être programmés à un échantillon précis de l'horloge audio
// (`atFrame`), pour démarrer en même temps que les autres participants (ENR-07).
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port2 = null;
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.on = false;
    this.startAt = null;
    this.stopAt = null;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "port") this.port2 = m.port;
      else if (m.type === "start") this.startAt = typeof m.atFrame === "number" ? m.atFrame : -1;
      else if (m.type === "stop") this.stopAt = typeof m.atFrame === "number" ? m.atFrame : -1;
    };
  }
  flush() {
    if (!this.n || !this.port2) return;
    const out = this.buf.slice(0, this.n);
    this.port2.postMessage({ type: "pcm", data: out }, [out.buffer]);
    this.n = 0;
  }
  end() {
    this.flush();
    this.on = false;
    this.stopAt = null;
    this.port2 && this.port2.postMessage({ type: "end" });
    this.port.postMessage({ type: "stopped" });
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    // Pas d'entrée (micro coupé par le système) : on écrit du silence pour garder la durée exacte.
    const len = ch ? ch.length : 128;
    let from = 0;
    let to = len;
    if (!this.on && this.startAt !== null) {
      // Départ dans ce bloc ? (-1 : tout de suite)
      const at = this.startAt < 0 ? currentFrame : this.startAt;
      if (at < currentFrame + len) {
        from = Math.max(0, at - currentFrame);
        this.on = true;
        this.startAt = null;
        this.port.postMessage({ type: "started", frame: currentFrame + from, sampleRate });
      }
    }
    if (!this.on) return true;
    if (this.stopAt !== null) {
      const at = this.stopAt < 0 ? currentFrame : this.stopAt;
      if (at < currentFrame + len) to = Math.max(from, at - currentFrame);
    }
    for (let i = from; i < to; i++) {
      this.buf[this.n++] = ch ? ch[i] : 0;
      if (this.n === this.buf.length) this.flush();
    }
    if (to < len || (this.stopAt !== null && this.stopAt < 0)) this.end();
    return true;
  }
}
registerProcessor("podstud-capture", CaptureProcessor);
