import { expect, type Browser, type Page } from "@playwright/test";

// Aides communes aux cas de recette des collectifs (étape 5) et du studio (étape 6).

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
export const uniq = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export async function login(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-test-mode")).toBeVisible();
  await page.getByTestId("login-test-link").click();
  await expect(page).toHaveURL(/\/collectifs/);
  await expect(page.getByTestId("me-email")).toHaveText(email);
}

export async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

/** Collectif avec une émission, un épisode et une session ; rend les adresses utiles. */
export async function setup(
  page: Page,
  opts: { emission: string; episode: string; mode?: string },
) {
  await page.getByTestId("collectif-name").fill(`Collectif ${uniq()}`);
  await page.getByTestId("collectif-create").click();
  await expect(page.getByTestId("collectif-title")).toBeVisible();
  const cid = page.url().split("/collectifs/")[1]?.split(/[?#]/)[0] as string;
  await page.getByTestId("emission-name").fill(opts.emission);
  await page.getByTestId("emission-visual-input").setInputFiles({
    name: "visuel.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByTestId("emission-create").click();
  await expect(page.getByTestId("emission-title")).toHaveText(opts.emission);
  const eid = page.url().split("/emissions/")[1]?.split(/[?#]/)[0] as string;
  await page.getByTestId("episode-title").fill(opts.episode);
  await page.getByTestId("episode-create").click();
  await page.getByTestId("session-new").click();
  await page.getByTestId("session-name").fill("Session du jeudi");
  await page.getByTestId(`session-mode-${opts.mode ?? "audio"}`).check();
  await page.getByTestId("session-create").click();
  await expect(page.getByTestId("session-title")).toHaveText("Session du jeudi");
  const sid = page.url().split("/sessions/")[1]?.split(/[?#]/)[0] as string;
  return { cid, eid, sid };
}
