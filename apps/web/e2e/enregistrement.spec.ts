import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Cas de recette automatisés de l'étape 3 (enregistrement local résistant aux coupures).
// Micro simulé de Chromium et Firefox ; sur Safari et iPhone, ces cas se testent à la main.

test.skip(
  ({ browserName }) => browserName === "webkit",
  "Pas de micro simulé pour WebKit sous Linux",
);
test.describe.configure({ timeout: 90_000 });

async function startRecording(page: Page) {
  await page.goto("/enregistrement");
  await page.getByTestId("rec-name").fill("Testeur");
  await expect(page.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("rec-start").click();
  // En cas d'échec au démarrage, afficher le message de la page plutôt qu'un simple délai dépassé.
  await expect(page.getByTestId("rec-panel"))
    .toHaveAttribute("data-phase", "recording", {
      timeout: 15_000,
    })
    .catch(async (e) => {
      const err = await page
        .getByTestId("rec-error")
        .textContent()
        .catch(() => null);
      throw new Error(`${err ?? "pas de message d'erreur"} / ${(e as Error).message}`);
    });
  await expect(page.getByTestId("rec-local")).toHaveAttribute("data-ok", "true", {
    timeout: 15_000,
  });
}

async function lastTakeId(page: Page): Promise<string> {
  const id = await page.getByTestId("rec-take").first().getAttribute("data-id");
  expect(id).toBeTruthy();
  return id as string;
}

/** Télécharge la piste WAV et rend sa durée en secondes (en vérifiant l'en-tête). */
async function wavSeconds(request: APIRequestContext, id: string): Promise<number> {
  const res = await request.get(`/api/prises/${id}/piste.wav`);
  expect(res.status()).toBe(200);
  const buf = await res.body();
  expect(buf.subarray(0, 4).toString()).toBe("RIFF");
  expect(buf.readUInt16LE(34)).toBe(24);
  const rate = buf.readUInt32LE(24);
  expect([44100, 48000]).toContain(rate);
  const data = buf.readUInt32LE(40);
  expect(buf.length).toBe(data + 44);
  return data / 3 / rate;
}

test("REC-01, REC-03 et REC-08 : enregistrer, marquer, arrêter, tout est envoyé", async ({
  page,
  request,
}) => {
  await startRecording(page);
  await page.waitForTimeout(4000);
  await page.keyboard.press("m");
  await expect(page.getByTestId("rec-markers")).toContainText("Marqueurs : 0:0");
  await page.waitForTimeout(8000);
  await page.getByTestId("rec-stop").click();
  await expect(page.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 30_000,
  });
  const id = await lastTakeId(page);
  const s = await wavSeconds(request, id);
  expect(s).toBeGreaterThan(10.5);
  expect(s).toBeLessThan(15);
  const labels = await (await request.get(`/api/prises/${id}/marqueurs.txt`)).text();
  expect(labels).toMatch(/^\d+\.\d{3}\t\d+\.\d{3}\tMarqueur 1\n$/);
  await expect(page.getByTestId("rec-download").first()).toBeVisible();
});

test("CR-01 : réseau coupé pendant l'enregistrement, rien n'est perdu", async ({
  page,
  context,
  request,
}) => {
  await startRecording(page);
  await page.waitForTimeout(2000);
  await context.setOffline(true);
  await page.waitForTimeout(9000);
  await expect(page.getByTestId("rec-upload")).toContainText("Envoi en attente");
  expect(Number(await page.getByTestId("rec-upload").getAttribute("data-pending"))).toBeGreaterThan(
    0,
  );
  await expect(page.getByTestId("rec-local")).toHaveAttribute("data-ok", "true");
  await context.setOffline(false);
  await page.waitForTimeout(2000);
  await page.getByTestId("rec-stop").click();
  await expect(page.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 40_000,
  });
  const s = await wavSeconds(request, await lastTakeId(page));
  expect(s).toBeGreaterThan(11.5);
});

test("CR-05 : onglet fermé pendant l'enregistrement, la prise est retrouvée et envoyée", async ({
  page,
  context,
  request,
}) => {
  await startRecording(page);
  await page.waitForTimeout(8000);
  const id = await lastTakeId(page);
  await page.close({ runBeforeUnload: false });
  const again = await context.newPage();
  await again.goto("/enregistrement");
  await expect(again.getByTestId("rec-recovered")).toContainText("prise interrompue", {
    timeout: 15_000,
  });
  await expect(again.locator(`[data-testid=rec-take][data-id="${id}"]`)).toHaveAttribute(
    "data-state",
    "done",
    { timeout: 30_000 },
  );
  const s = await wavSeconds(request, id);
  expect(s).toBeGreaterThan(6);
});

test("CR-12 : un second onglet ne peut pas enregistrer en même temps", async ({
  page,
  context,
}) => {
  await page.goto("/enregistrement");
  await expect(page.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  const second = await context.newPage();
  await second.goto("/enregistrement");
  await expect(second.getByTestId("rec-busy")).toBeVisible();
});

test("REC-11 : une piste introuvable affiche un message clair, jamais du code brut", async ({
  page,
}) => {
  await page.goto("/api/prises/20260101-000000-inconnue/piste.wav");
  await expect(page.getByTestId("download-error")).toContainText("ne retrouve pas cette piste");
  await expect(page.getByText('{"error"')).toHaveCount(0);
  await page.getByRole("link", { name: "Revenir à l'enregistrement" }).click();
  await expect(page).toHaveURL(/\/enregistrement$/);
});
