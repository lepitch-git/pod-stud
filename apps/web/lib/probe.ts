import type { CapabilityProbe } from "@pod-stud/shared";

const VIDEO_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1,mp4a",
  "video/mp4",
];

/** Relève, sans rien demander à l'utilisateur, ce que le navigateur sait faire. */
export async function probeCapabilities(): Promise<CapabilityProbe> {
  const nav = navigator as Navigator & { wakeLock?: unknown };
  const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";
  const mediaRecorderTypes = hasMediaRecorder
    ? Array.from(
        new Set(
          VIDEO_TYPES.filter((t) => {
            try {
              return MediaRecorder.isTypeSupported(t);
            } catch {
              return false;
            }
          }).map((t) => t.split(";")[0] as string),
        ),
      )
    : [];

  let opfs = false;
  try {
    if (navigator.storage && typeof navigator.storage.getDirectory === "function") {
      await navigator.storage.getDirectory();
      opfs = true;
    }
  } catch {
    opfs = false; // par exemple en navigation privée sur certains navigateurs
  }

  let storagePersisted: boolean | null = null;
  try {
    if (navigator.storage?.persisted) storagePersisted = await navigator.storage.persisted();
  } catch {
    storagePersisted = null;
  }

  let storageAvailableBytes: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const { quota, usage } = await navigator.storage.estimate();
      if (typeof quota === "number") storageAvailableBytes = Math.max(0, quota - (usage ?? 0));
    }
  } catch {
    storageAvailableBytes = null;
  }

  return {
    secureContext: window.isSecureContext,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    audioWorklet:
      typeof window.AudioContext !== "undefined" && "audioWorklet" in AudioContext.prototype,
    webWorker: typeof window.Worker !== "undefined",
    opfs,
    indexedDb: typeof window.indexedDB !== "undefined",
    storagePersisted,
    storageAvailableBytes,
    webrtc: typeof window.RTCPeerConnection !== "undefined",
    mediaRecorder: hasMediaRecorder,
    mediaRecorderTypes,
    wakeLock: typeof nav.wakeLock !== "undefined",
    webCrypto: typeof window.crypto?.subtle?.digest === "function",
  };
}
