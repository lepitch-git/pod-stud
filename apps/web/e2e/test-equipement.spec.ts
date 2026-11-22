import { expect, test } from "@playwright/test";

// Cas de recette automatisés de l'étape 2 (test d'équipement, ENR-15).
// Les cas qui demandent un vrai micro ou une vraie caméra ne tournent qu'avec les périphériques simulés
// de Chromium et Firefox ; sur Safari et iPhone, ils se testent à la main.

const needsFakeMedia = (browserName: string) =>
  test.skip(browserName === "webkit", "Pas de micro ni de caméra simulés pour WebKit sous Linux");

test("SAL-01 : le nom saisi est conservé, sans compte", async ({ page }) => {
  await page.goto("/test-equipement");
  await page.getByTestId("name").fill("Lola");
  await page.reload();
  await expect(page.getByTestId("name")).toHaveValue("Lola");
  await expect(page.getByText("Aucun compte n'est nécessaire.")).toBeVisible();
});

test("SAL-02 : un refus d'accès au micro est expliqué en français", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("refus", "NotAllowedError"));
  });
  await page.goto("/test-equipement");
  await page.getByTestId("mic-open").click();
  await expect(page.getByTestId("mic-error")).toContainText("L'accès au micro a été refusé");
  await expect(page.getByTestId("mic-error")).toContainText("rechargez la page");
});

test("SAL-03 et SAL-05 : micro, vu-mètre et analyse du niveau", async ({ page, browserName }) => {
  needsFakeMedia(browserName);
  test.setTimeout(60_000);
  await page.goto("/test-equipement");
  await page.getByTestId("mic-open").click();
  await expect(page.getByTestId("mic-select")).toBeVisible();
  await expect(page.getByTestId("vu-meter")).toBeVisible();
  await page.getByTestId("mic-test").click();
  await expect(page.getByTestId("mic-phase")).toContainText("silencieux");
  await expect(page.getByTestId("mic-results")).toBeVisible({ timeout: 20_000 });
  for (const id of ["eq-clipping", "eq-noise"]) {
    await expect(page.getByTestId("mic-results").getByTestId(id)).toHaveAttribute(
      "data-status",
      /ok|warn|ko/,
    );
  }
});

test("SAL-07 : aperçu de la caméra et contrôle de l'image", async ({ page, browserName }) => {
  needsFakeMedia(browserName);
  await page.goto("/test-equipement");
  await page.getByTestId("cam-open").click();
  await expect(page.getByTestId("cam-preview")).toBeVisible();
  await page.waitForFunction(
    () => (document.querySelector("video") as HTMLVideoElement | null)?.videoWidth! > 0,
  );
  await page.getByTestId("cam-test").click();
  await expect(page.getByTestId("cam-results").getByTestId("eq-resolution")).toBeVisible();
  await expect(page.getByTestId("cam-results").getByTestId("eq-light")).toBeVisible();
});

test("SAL-08 : test de la connexion", async ({ page }) => {
  await page.goto("/test-equipement");
  await page.getByTestId("net-test").click();
  await expect(page.getByTestId("net-results").getByTestId("eq-upload")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("net-results").getByTestId("eq-latency")).toBeVisible();
});

test("SAL-09 et SAL-10 : verdict final, conservé pour le jour J", async ({ page, browserName }) => {
  needsFakeMedia(browserName);
  test.setTimeout(90_000);
  await page.goto("/test-equipement");
  await page.getByTestId("name").fill("Mister E");
  await page.getByTestId("video-toggle").uncheck();
  await page.getByTestId("mic-open").click();
  await page.getByTestId("mic-test").click();
  await expect(page.getByTestId("mic-results")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("hp-yes").check();
  await page.getByTestId("echo-test").click();
  await expect(page.getByTestId("echo-results")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("net-test").click();
  await expect(page.getByTestId("net-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("summary")).toHaveAttribute("data-complete", "true");
  await expect(page.getByTestId("final-verdict")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("saved-test")).toContainText("Mister E");
});
