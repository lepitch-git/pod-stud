import { expect, test, type Page } from "@playwright/test";
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

/** Collectif, session et une prise de quelques secondes enregistrée par l'hôte seul. */
async function recordedSession(page: Page, seconds = 8) {
  await login(page, `monteur-${uniq()}@exemple.fr`);
  const ids = await setup(page, { emission: "Ciné du commerce", episode: "Épisode 13" });
  await page.getByTestId("open-studio").click();
  await page.getByTestId("room-name").fill("Xad");
  await page.getByTestId("room-join").click();
  await expect(page.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("rec-start").click();
  await page.waitForTimeout(seconds * 1000);
  await page.getByTestId("rec-stop").click();
  await expect(page.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 30_000,
  });
  await page.goto(`/collectifs/${ids.cid}/sessions/${ids.sid}`);
  await page.getByTestId("tab-postproductions").click();
  return ids;
}

test("STU-03 : preset, réglages, écoute avant/après, traitement sans changer la durée", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "Pas de micro simulé pour WebKit sous Linux");
  const { cid } = await recordedSession(page);
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

test("STU-05, STU-14, STU-15 : mix de la prise, silences communs raccourcis, vitesse sans changer la hauteur", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "Pas de micro simulé pour WebKit sous Linux");
  const { cid } = await recordedSession(page, 10);
  const panel = page.getByTestId("mix-panel").first();
  await expect(panel).toHaveAttribute("data-fresh", "none");
  await expect(panel).toContainText("Xad (originale)");

  // Le micro simulé émet un bip par seconde : il y a des silences à raccourcir.
  await panel.getByTestId("mix-silences").selectOption("0.5");
  await panel.getByTestId("mix-estimate").click();
  await expect(panel.getByTestId("mix-estimate-result")).toBeVisible({ timeout: 60_000 });
  await panel.getByTestId("mix-speed").fill("1.25");
  await panel.getByTestId("mix-run").click();
  await expect(panel).toHaveAttribute("data-fresh", "true", { timeout: 90_000 });
  await expect(panel.getByTestId("mix-done")).toContainText("×1,25");

  const take = (await page.getByTestId("post-track").first().getAttribute("data-take")) as string;
  const original = wavInfo(
    await (await page.request.get(`/api/collectifs/${cid}/pistes/${take}`)).body(),
  );
  const href = (await panel.getByTestId("mix-download").getAttribute("href")) as string;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toContain("_Prise1_Mix.wav");
  const mixed = wavInfo(await res.body());
  // Plus court qu'à vitesse normale : ×1,25 au moins, plus les silences raccourcis.
  expect(mixed.frames).toBeLessThanOrEqual(Math.round(original.frames / 1.25));
  expect(mixed.frames).toBeGreaterThan(original.frames * 0.3);
  expect(mixed.peak).toBeLessThanOrEqual(0.9);

  // Une piste traitée ensuite rend le mix périmé.
  await page.getByTestId("post-run").first().click();
  await expect(page.getByTestId("post-track").first()).toHaveAttribute("data-state", "a-jour", {
    timeout: 90_000,
  });
  await expect(page.getByTestId("mix-panel").first()).toHaveAttribute("data-fresh", "false");
});

test("STU-08 à STU-10 : transcription corrigée à la main, remplacer partout, exports texte et sous-titres", async ({
  page,
  browserName,
}) => {
  test.skip(browserName === "webkit", "Pas de micro simulé pour WebKit sous Linux");
  // Le calcul Whisper lui-même se teste à la main (le modèle se télécharge depuis huggingface.co) :
  // ici, on dépose une transcription comme le ferait le navigateur, puis on la corrige et l'exporte.
  const { cid, sid } = await recordedSession(page, 6);
  const panel = page.getByTestId("transcript-panel").first();
  await expect(panel.getByTestId("transcript-summary")).toHaveText("pas encore faite");
  const prise = (await page.getByTestId("post-prise").first().getAttribute("data-key")) as string;
  const url = `/api/collectifs/${cid}/transcriptions/${sid}/${encodeURIComponent(prise)}`;
  const put = await page.request.put(url, {
    data: {
      model: "onnx-community/whisper-base",
      segments: [
        { start: 0.4, end: 2.1, speaker: "Xad", text: "Bienvenue au comptoir avec Mister I." },
        { start: 2.5, end: 3.9, speaker: "Xad", text: "Mister I, tu es là ?" },
        {
          start: 4,
          end: 5,
          speaker: "Xad",
          text: "Sous-titres réalisés par la communauté d'Amara.org",
        },
      ],
    },
  });
  expect(put.status()).toBe(200);
  expect((await put.json()).segments).toBe(2);

  await page.reload();
  await page.getByTestId("tab-postproductions").click();
  await expect(panel.getByTestId("transcript-summary")).toHaveText("2 passages");
  await panel.locator("summary").click();
  await expect(panel.getByTestId("transcript-line")).toHaveCount(2);
  await panel.getByTestId("transcript-find").fill("mister i");
  await panel.getByTestId("transcript-replace").fill("Mister E");
  await panel.getByTestId("transcript-replace-all").click();
  await expect(panel.getByTestId("transcript-line").first().locator("textarea")).toHaveValue(
    "Bienvenue au comptoir avec Mister E.",
  );
  await panel
    .getByTestId("transcript-line")
    .nth(1)
    .locator("textarea")
    .fill("Mister E, tu es là ce soir ?");
  await panel.getByTestId("transcript-save").click();
  await expect(panel.getByTestId("transcript-save")).toBeDisabled();

  const txt = await page.request.get(`${url}?format=txt`);
  expect(txt.headers()["content-disposition"]).toContain("_Prise1_Transcription.txt");
  expect(await txt.text()).toBe(
    "[00:00:00] Xad : Bienvenue au comptoir avec Mister E. Mister E, tu es là ce soir ?\n",
  );
  const srt = await (await page.request.get(`${url}?format=srt`)).text();
  expect(srt).toContain("2\n00:00:02,500 --> 00:00:03,900\nXad: Mister E, tu es là ce soir ?");

  // Sous-titres calés sur le mix à ×1,25 : les temps sont divisés par la vitesse.
  const mix = page.getByTestId("mix-panel").first();
  await mix.getByTestId("mix-speed").fill("1.25");
  await mix.getByTestId("mix-run").click();
  await expect(mix).toHaveAttribute("data-fresh", "true", { timeout: 90_000 });
  const srtMix = await (await page.request.get(`${url}?format=srt&base=mix`)).text();
  expect(srtMix).toContain("2\n00:00:02,000 --> 00:00:03,120\nXad: Mister E");
});
