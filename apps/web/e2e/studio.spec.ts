import { expect, test } from "@playwright/test";
import { login, setup, uniq } from "./aides";

// Cas de recette automatisés de l'étape 6a (STU-xx) : traitement de la voix d'une piste.

test.describe.configure({ timeout: 180_000 });

/** Lit un WAV mono 24 bits : nombre d'échantillons et crête (0 à 1). */
function wavInfo(buf: Buffer) {
  expect(buf.subarray(0, 4).toString()).toBe("RIFF");
  const data = buf.readUInt32LE(40);
  expect(buf.length).toBe(data + 44);
  let peak = 0;
  for (let o = 44; o + 3 <= buf.length; o += 3) {
    const v = Math.abs(buf.readIntLE(o, 3)) / 0x800000;
    if (v > peak) peak = v;
  }
  return { frames: data / 3, peak };
}

test("STU-03 : preset, réglages, écoute avant/après, traitement sans changer la durée", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "Pas de micro simulé pour WebKit sous Linux");
  await login(page, `monteur-${uniq()}@exemple.fr`);
  const { cid, sid } = await setup(page, { emission: "Ciné du commerce", episode: "Épisode 13" });

  // Une prise de quelques secondes.
  await page.getByTestId("open-studio").click();
  await page.getByTestId("room-name").fill("Xad");
  await page.getByTestId("room-join").click();
  await expect(page.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("rec-start").click();
  await page.waitForTimeout(8000);
  await page.getByTestId("rec-stop").click();
  await expect(page.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 30_000,
  });

  await page.goto(`/collectifs/${cid}/sessions/${sid}`);
  await page.getByTestId("tab-postproductions").click();
  const track = page.getByTestId("post-track").first();
  await expect(track).toHaveAttribute("data-state", "a-faire", { timeout: 15_000 });
  await expect(track.getByTestId("post-preset")).toHaveText("Naturel");

  // Réglages : preset Radio chaleureuse, bruits de bouche « fort », respirations -6 dB.
  await track.getByTestId("post-edit").click();
  await track.getByTestId("preset-radio").check();
  await track.getByTestId("post-antibouche").selectOption("fort");
  await track.getByTestId("post-respirations").selectOption("6");
  await track.getByTestId("post-bruit").fill("70");

  // Écoute avant / après sur un extrait, calculée dans le navigateur.
  await track.getByTestId("post-preview-compute").click();
  await expect(track.getByTestId("post-preview")).toHaveAttribute("data-state", "pret", {
    timeout: 60_000,
  });
  await expect(track.getByTestId("post-preview-info")).toContainText("bruit");
  await track.getByTestId("post-play").click();
  await track.getByTestId("post-ab-avant").click();
  await expect(track.getByTestId("post-ab-avant")).toHaveAttribute("aria-pressed", "true");
  await track.getByTestId("post-play").click();

  await track.getByTestId("post-save").click();
  const saved = page.getByTestId("post-track").first();
  await page.getByTestId("tab-postproductions").click();
  await expect(saved.getByTestId("post-preset")).toHaveText("Radio chaleureuse");

  // Traitement : la version traitée a exactement la durée de l'originale et ne sature pas.
  await saved.getByTestId("post-run").click();
  await expect(saved).toHaveAttribute("data-state", "a-jour", { timeout: 90_000 });
  await expect(saved.getByTestId("post-stats")).toContainText("-16 LUFS");
  await expect(page.getByTestId("tab-postproductions")).toContainText("(1)");
  const take = (await saved.getAttribute("data-take")) as string;
  const original = wavInfo(
    await (await page.request.get(`/api/collectifs/${cid}/pistes/${take}`)).body(),
  );
  const res = await page.request.get(`/api/collectifs/${cid}/pistes/${take}?traitee=1`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("_Xad_traitee.wav");
  const processed = wavInfo(await res.body());
  expect(processed.frames).toBe(original.frames);
  expect(processed.peak).toBeLessThanOrEqual(0.9);
  expect(processed.peak).toBeGreaterThan(0.05);

  // Un réglage changé rend la version traitée périmée, jusqu'au prochain traitement.
  await saved.getByTestId("post-edit").click();
  await saved.getByTestId("preset-clarte").check();
  await saved.getByTestId("post-save").click();
  await page.getByTestId("tab-postproductions").click();
  await expect(page.getByTestId("post-track").first()).toHaveAttribute("data-state", "perime");
  const stale = await page.request.get(`/api/collectifs/${cid}/pistes/${take}?traitee=1`);
  expect(stale.status()).toBe(409);

  // Le journal garde la trace des réglages.
  await page.goto(`/collectifs/${cid}/journal`);
  await expect(page.getByTestId("audit")).toContainText("Traitement de la voix");
});
