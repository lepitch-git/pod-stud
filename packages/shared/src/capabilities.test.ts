import { describe, expect, it } from "vitest";
import { evaluateCapabilities, type CapabilityProbe } from "./capabilities";

const full: CapabilityProbe = {
  secureContext: true,
  getUserMedia: true,
  audioWorklet: true,
  webWorker: true,
  opfs: true,
  indexedDb: true,
  storagePersisted: true,
  storageAvailableBytes: 50 * 1024 ** 3,
  webrtc: true,
  mediaRecorder: true,
  mediaRecorderTypes: ["video/webm"],
  wakeLock: true,
  webCrypto: true,
};

describe("evaluateCapabilities", () => {
  it("donne un verdict vert quand tout est disponible", () => {
    const d = evaluateCapabilities(full);
    expect(d.verdict).toBe("ok");
    expect(d.checks.every((c) => c.status === "ok")).toBe(true);
  });

  it("passe au rouge sans HTTPS", () => {
    expect(evaluateCapabilities({ ...full, secureContext: false }).verdict).toBe("ko");
  });

  it("passe au rouge sans AudioWorklet (enregistrement impossible)", () => {
    expect(evaluateCapabilities({ ...full, audioWorklet: false }).verdict).toBe("ko");
  });

  it("reste orange avec le repli IndexedDB quand OPFS manque", () => {
    const d = evaluateCapabilities({ ...full, opfs: false });
    expect(d.verdict).toBe("warn");
    expect(d.checks.find((c) => c.id === "opfs")?.status).toBe("warn");
  });

  it("passe au rouge sans aucun stockage local", () => {
    expect(evaluateCapabilities({ ...full, opfs: false, indexedDb: false }).verdict).toBe("ko");
  });

  it("alerte quand l'espace disque est faible", () => {
    const d = evaluateCapabilities({ ...full, storageAvailableBytes: 500 * 1024 ** 2 });
    const c = d.checks.find((x) => x.id === "storageSpace");
    expect(c?.status).toBe("warn");
    expect(c?.detail).toContain("500 Mo");
  });

  it("ne bloque pas une session audio si la vidéo est indisponible", () => {
    const d = evaluateCapabilities({ ...full, mediaRecorder: false, mediaRecorderTypes: [] });
    expect(d.verdict).toBe("warn");
  });

  it("ne pénalise pas un stockage persistant pas encore demandé", () => {
    expect(evaluateCapabilities({ ...full, storagePersisted: false }).verdict).toBe("ok");
  });

  it("rattache chaque contrôle à une exigence de la spécification", () => {
    for (const c of evaluateCapabilities(full).checks) expect(c.requirement).toMatch(/ENR-\d{2}/);
  });
});
