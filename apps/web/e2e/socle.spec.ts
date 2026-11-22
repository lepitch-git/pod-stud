import { expect, test } from "@playwright/test";

// Cas de recette automatisés de l'étape 1. Les identifiants renvoient au cahier de recette.

test("SOC-01 : la page d'accueil s'affiche en français avec l'avancement", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Studio d'enregistrement");
  await expect(page.getByTestId("steps").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("app-version")).not.toBeEmpty();
});

test("SOC-02 : le diagnostic donne un verdict et détaille chaque contrôle", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Diagnostic navigateur" }).click();
  await expect(page).toHaveURL(/\/diagnostic$/);
  const diag = page.getByTestId("diagnostic");
  await expect(diag).toBeVisible();
  await expect(diag).toHaveAttribute("data-verdict", /^(ok|warn|ko)$/);
  await expect(page.getByTestId("browser-label")).not.toHaveText("Navigateur non reconnu");
  for (const id of [
    "secureContext",
    "getUserMedia",
    "audioWorklet",
    "opfs",
    "webrtc",
    "webCrypto",
  ]) {
    await expect(page.getByTestId(`check-${id}`)).toBeVisible();
  }
});

test("SOC-03 : les briques indispensables à l'enregistrement sont présentes", async ({ page }) => {
  await page.goto("/diagnostic");
  // localhost compte comme contexte sécurisé : ces contrôles doivent être verts sur les 3 moteurs.
  for (const id of [
    "secureContext",
    "getUserMedia",
    "audioWorklet",
    "webWorker",
    "webrtc",
    "webCrypto",
  ]) {
    await expect(page.getByTestId(`check-${id}`)).toHaveAttribute("data-status", "ok");
  }
});
