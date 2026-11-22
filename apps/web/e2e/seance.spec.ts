import { expect, test, type Browser, type Page } from "@playwright/test";

// Cas de recette automatisés de l'étape 4 : séance à deux (hôte et invité, chacun dans son propre
// navigateur simulé), départ commun, pistes alignées.

test.skip(
  ({ browserName }) => browserName === "webkit",
  "Pas de micro simulé pour WebKit sous Linux",
);
test.describe.configure({ timeout: 120_000 });

async function participant(browser: Browser, url: string, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByTestId("room-name").fill(name);
  await page.getByTestId("room-join").click();
  return page;
}

test("SAL-11, SYN-01 et SYN-02 : salle d'attente, départ commun, pistes alignées", async ({
  browser,
  request,
}) => {
  const host = await participant(browser, "/seance/nouvelle", "Hôte");
  await expect(host).toHaveURL(/\/seance\/[a-z0-9-]+\?hote=1$/);
  // Le lien d'invitation affiché par l'hôte
  const invite = (await host.getByTestId("room-invite").textContent()) as string;
  const sessionId = invite.split("/seance/")[1] as string;

  const guest = await participant(browser, invite, "Invitée");
  await expect(guest.getByTestId("room-lobby")).toBeVisible();

  // L'hôte voit l'invitée en salle d'attente et la fait entrer.
  await host.getByTestId("room-admit").click({ timeout: 15_000 });
  await expect(guest.getByTestId("rec-wait-host")).toBeVisible({ timeout: 10_000 });
  await expect(host.getByTestId("room-peer")).toHaveCount(1, { timeout: 10_000 });
  // Avec LiveKit (job dédié de la CI), la conversation en direct est active des deux côtés.
  if (process.env.PODSTUD_EXPECT_LIVEKIT) {
    await expect(host.getByTestId("room-live")).toBeVisible();
    await expect(guest.getByTestId("room-live")).toBeVisible();
  } else await expect(host.getByTestId("room-relay-warning")).toBeVisible();

  // Départ commun : décompte chez les deux, puis enregistrement des deux côtés.
  await expect(host.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  await host.getByTestId("rec-start").click();
  await expect(guest.getByTestId("rec-countdown")).toBeVisible({ timeout: 5_000 });
  await expect(host.getByTestId("rec-panel")).toHaveAttribute("data-phase", "recording", {
    timeout: 10_000,
  });
  await expect(guest.getByTestId("rec-panel")).toHaveAttribute("data-phase", "recording", {
    timeout: 10_000,
  });
  await expect(host.getByTestId("room-peer")).toHaveAttribute("data-phase", "recording", {
    timeout: 10_000,
  });
  await host.waitForTimeout(8000);
  await host.getByTestId("rec-stop").click();
  await expect(host.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 30_000,
  });
  await expect(guest.getByTestId("rec-upload")).toContainText("Tout est envoyé", {
    timeout: 30_000,
  });

  // Deux pistes alignées : même départ (à quelques ms près) et même durée.
  await expect(host.getByTestId("room-track")).toHaveCount(2, { timeout: 15_000 });
  const info = await (await request.get(`/api/seances/${sessionId}`)).json();
  const tracks = info.takes[0].tracks as {
    startOffsetMs: number;
    seconds: number;
    takeId: string;
  }[];
  expect(tracks).toHaveLength(2);
  for (const t of tracks) expect(Math.abs(t.startOffsetMs)).toBeLessThan(30);
  expect(Math.abs((tracks[0]?.seconds ?? 0) - (tracks[1]?.seconds ?? 0))).toBeLessThan(0.05);
  for (const t of tracks) {
    const res = await request.get(`/api/seances/${sessionId}/alignee/${t.takeId}.wav`);
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect(buf.readUInt32LE(24)).toBe(48000);
    expect(buf.length).toBe(buf.readUInt32LE(40) + 44);
  }
});
