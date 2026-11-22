import type { BrowserFamily } from "@pod-stud/shared";

/** Explication en français d'un échec d'accès au micro ou à la caméra (SAL-02). */
export function mediaErrorHelp(
  err: unknown,
  family: BrowserFamily,
  device: "micro" | "caméra",
): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `Aucun${device === "caméra" ? "e" : ""} ${device} n'a été trouvé${device === "caméra" ? "e" : ""}. Branchez-le${device === "caméra" ? "a" : ""}, puis rechargez la page.`;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `Votre ${device} est déjà utilisé${device === "caméra" ? "e" : ""} par une autre application (Zoom, Teams, Discord…). Fermez-la, puis réessayez.`;
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    const how: Record<BrowserFamily, string> = {
      chrome:
        "Cliquez sur l'icône à gauche de l'adresse du site, mettez « Micro » et « Caméra » sur Autoriser, puis rechargez la page.",
      edge: "Cliquez sur le cadenas à gauche de l'adresse du site, mettez « Micro » et « Caméra » sur Autoriser, puis rechargez la page.",
      firefox:
        "Cliquez sur l'icône barrée dans la barre d'adresse, retirez le blocage du micro et de la caméra, puis rechargez la page.",
      safari:
        "Dans le menu Safari, ouvrez « Réglages pour ce site web… », mettez Micro et Caméra sur « Autoriser », puis rechargez la page.",
      "safari-ios":
        "Touchez « aA » (ou l'icône de réglages) dans la barre d'adresse, puis « Réglages du site web », autorisez Micro et Caméra, et rechargez la page.",
      "chrome-android":
        "Touchez l'icône à gauche de l'adresse, puis Autorisations, autorisez Micro et Caméra, et rechargez la page.",
      autre:
        "Autorisez le micro et la caméra pour ce site dans les réglages du navigateur, puis rechargez la page.",
    };
    const system =
      family === "safari" || family === "chrome" || family === "firefox" || family === "edge"
        ? " Si cela ne suffit pas, vérifiez aussi les réglages de confidentialité de l'ordinateur (sur Mac : Réglages Système › Confidentialité et sécurité › Micro / Caméra)."
        : "";
    return `L'accès ${device === "micro" ? "au micro" : "à la caméra"} a été refusé. ${how[family]}${system}`;
  }
  return `Impossible d'accéder ${device === "micro" ? "au micro" : "à la caméra"} (${name || "erreur inconnue"}). Rechargez la page et réessayez.`;
}
