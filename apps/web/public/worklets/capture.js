// Processeur audio : recopie le son brut du micro (premier canal) par blocs de 2048 échantillons
// et l'envoie directement au worker d'écriture, sans passer par la page (ENR-03).
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port2 = null;
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.on = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "port") this.port2 = m.port;
      else if (m.type === "start") this.on = true;
      else if (m.type === "stop") {
        this.flush();
        this.on = false;
        this.port2 && this.port2.postMessage({ type: "end" });
      }
    };
  }
  flush() {
    if (!this.n || !this.port2) return;
    const out = this.buf.slice(0, this.n);
    this.port2.postMessage({ type: "pcm", data: out }, [out.buffer]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const ch = inputs[0] && inputs[0][0];
    // Pas d'entrée (micro coupé par le système) : on écrit du silence pour garder la durée exacte.
    const len = ch ? ch.length : 128;
    for (let i = 0; i < len; i++) {
      this.buf[this.n++] = ch ? ch[i] : 0;
      if (this.n === this.buf.length) this.flush();
    }
    return true;
  }
}
registerProcessor("podstud-capture", CaptureProcessor);
