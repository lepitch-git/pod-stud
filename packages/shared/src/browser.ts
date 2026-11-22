/** Navigateur détecté à partir du User-Agent, pour le diagnostic et le cahier de recette. */
export type BrowserFamily =
  | "chrome"
  | "edge"
  | "firefox"
  | "safari"
  | "safari-ios"
  | "chrome-android"
  | "autre";

export interface BrowserInfo {
  family: BrowserFamily;
  /** Libellé lisible, par exemple « Safari 18.2 (iPhone) ». */
  label: string;
  version: string | null;
  mobile: boolean;
}

function match(ua: string, re: RegExp): string | null {
  const m = ua.match(re);
  return m?.[1] ?? null;
}

export function detectBrowser(ua: string): BrowserInfo {
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);

  if (isIOS) {
    // Sur iOS, tous les navigateurs utilisent le moteur de Safari (WebKit).
    const version =
      match(ua, /Version\/([\d.]+)/) ?? match(ua, /OS (\d+[_\d]*)/)?.replace(/_/g, ".") ?? null;
    const app = /CriOS/.test(ua)
      ? "Chrome"
      : /FxiOS/.test(ua)
        ? "Firefox"
        : /EdgiOS/.test(ua)
          ? "Edge"
          : "Safari";
    const device = /iPad/.test(ua) ? "iPad" : "iPhone";
    return {
      family: "safari-ios",
      label: `${app} ${version ?? ""} (${device}, moteur Safari)`.replace("  ", " "),
      version,
      mobile: true,
    };
  }
  const edge = match(ua, /Edg(?:A|e)?\/([\d.]+)/);
  if (edge)
    return {
      family: "edge",
      label: `Edge ${edge}${isAndroid ? " (Android)" : ""}`,
      version: edge,
      mobile: isAndroid,
    };
  const firefox = match(ua, /Firefox\/([\d.]+)/);
  if (firefox)
    return {
      family: "firefox",
      label: `Firefox ${firefox}${isAndroid ? " (Android)" : ""}`,
      version: firefox,
      mobile: isAndroid,
    };
  const chrome = match(ua, /Chrome\/([\d.]+)/);
  if (chrome) {
    return isAndroid
      ? {
          family: "chrome-android",
          label: `Chrome ${chrome} (Android)`,
          version: chrome,
          mobile: true,
        }
      : { family: "chrome", label: `Chrome ${chrome}`, version: chrome, mobile: false };
  }
  const safari = /Safari\//.test(ua) ? match(ua, /Version\/([\d.]+)/) : null;
  if (safari)
    return { family: "safari", label: `Safari ${safari} (Mac)`, version: safari, mobile: false };
  return { family: "autre", label: "Navigateur non reconnu", version: null, mobile: isAndroid };
}
