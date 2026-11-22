import { expect, test, type Page } from "@playwright/test";
import { login, newPage, setup, uniq } from "./aides";

// Cas de recette automatisés de l'étape 5 (CPT-xx) : collectif, rôles, émissions, sessions,
// invitations, fichiers. Les e-mails ne partent pas en test : les liens s'affichent à l'écran.

test.describe.configure({ timeout: 150_000 });

async function guestLink(page: Page, label: string) {
  await page.getByTestId("guest-label").fill(label);
  await page.getByTestId("guest-invite-create").click();
  await expect(page.getByTestId("guest-invite-done")).toContainText("Copiez le lien");
  return (await page.getByTestId("guest-invite-link").first().textContent()) as string;
}

test("CPT-01 à CPT-06, CPT-09, CPT-11, CPT-12 : collectif, rôles, invitations, archivage", async ({
  browser,
  page,
}) => {
  // CPT-01 : connexion par lien, sans mot de passe.
  const owner = `proprio-${uniq()}@exemple.fr`;
  await login(page, owner);

  // CPT-04, CPT-05 : deux émissions avec visuel ; épisode, session en mode « vidéo affichée ».
  const { cid, eid, sid } = await setup(page, {
    emission: "Ciné du commerce",
    episode: "Épisode 12",
    mode: "visio",
  });
  await expect(page.getByTestId("crumbs")).toContainText("Ciné du commerce");
  await expect(page.getByTestId("crumbs")).toContainText("Épisode 12");
  await page.goto(`/collectifs/${cid}`);
  await page.getByTestId("emission-name").fill("Pitch du Routard");
  await page.getByTestId("emission-create").click();
  await expect(page.getByTestId("emission-title")).toHaveText("Pitch du Routard");
  await page.goto(`/collectifs/${cid}`);
  await expect(page.getByTestId("emission-link")).toHaveCount(2);
  await expect(page.getByTestId("emission-visual")).toHaveCount(1);
  const visual = await page.request.get(
    (await page.getByTestId("emission-visual").getAttribute("src")) as string,
  );
  expect(visual.headers()["content-type"]).toBe("image/png");

  // CPT-02 : invitation d'un membre comme Monteur, pour la première émission seulement.
  await page.getByTestId("tab-membres").click();
  const editor = `monteur-${uniq()}@exemple.fr`;
  await page.getByTestId("invite-email").fill(editor);
  await page.getByTestId("role-select").last().selectOption("monteur");
  await page.locator('input[name="toutes"]').last().uncheck();
  await page.getByTestId("invite-emission").first().check();
  await page.getByTestId("invite-submit").click();
  await expect(page.getByTestId("invite-done")).toBeVisible();
  const memberLink = (await page.getByTestId("member-invite-link").first().textContent()) as string;

  const ed = await newPage(browser);
  await ed.goto(memberLink);
  await expect(ed.getByTestId("welcome")).toBeVisible();
  await expect(ed.getByTestId("my-role")).toHaveText("Monteur");
  await expect(ed.getByTestId("emission-link")).toHaveCount(1);
  await expect(ed.getByTestId("emission-link")).toContainText("Ciné du commerce");
  // Le lien a servi : il ne peut pas être réutilisé.
  const reuse = await newPage(browser);
  await reuse.goto(memberLink);
  await expect(reuse.getByTestId("link-state")).toHaveAttribute("data-state", "utilise");

  // CPT-03 : le monteur voit la session mais ne peut pas lancer d'enregistrement.
  await ed.goto(`/collectifs/${cid}/sessions/${sid}`);
  await expect(ed.getByTestId("cannot-record")).toBeVisible();
  await expect(ed.getByTestId("open-studio")).toHaveCount(0);
  await ed.goto(`/seance/${sid}`);
  await expect(ed.getByTestId("room-cannot-record")).toBeVisible();
  // … ni gérer le collectif, ni voir l'autre émission.
  await ed.goto(`/collectifs/${cid}/emissions/${eid}`);
  await expect(ed.getByTestId("episode-create")).toHaveCount(0);

  // CPT-06 : invitation d'un invité sans compte ; le mode de la session suit le lien.
  await page.goto(`/collectifs/${cid}/sessions/${sid}`);
  const link = await guestLink(page, "Lola");
  const guest = await newPage(browser);
  await guest.goto(link);
  await expect(guest.getByTestId("invitation-title")).toHaveText("Ciné du commerce");
  await expect(guest.getByTestId("invitation-mode")).toHaveText("Audio enregistré, vidéo affichée");
  await expect(guest.getByTestId("invitation-test")).toHaveAttribute("href", /mode=visio/);
  await guest.getByTestId("invitation-join").click();
  await expect(guest.getByTestId("room-name")).toBeVisible();

  // CPT-09 : avec un lien d'invité, aucun accès aux fichiers ni aux pages du collectif.
  for (const url of [`/api/collectifs/${cid}/zip?session=${sid}`, `/api/seances/${sid}`]) {
    const r = await guest.request.get(url);
    expect(r.status(), url).toBe(403);
  }
  await guest.goto(`/collectifs/${cid}/sessions/${sid}`);
  await expect(guest).toHaveURL(/\/connexion/);

  // Révocation : le lien affiche un message clair.
  await page.getByTestId("guest-invite-revoke").first().click();
  await expect(page.getByTestId("guest-invite").first()).toHaveAttribute("data-state", "revoque");
  await guest.goto(link);
  await expect(guest.getByTestId("link-state")).toHaveAttribute("data-state", "revoque");

  // CPT-12 : onglets, tri et vue mémorisés.
  await page.getByTestId("view-toggle").click();
  await expect(page.getByTestId("view-toggle")).toHaveText("Vue liste");
  await page.getByTestId("sort").selectOption("ancien");
  await page.reload();
  await expect(page.getByTestId("view-toggle")).toHaveText("Vue liste");
  await expect(page.getByTestId("sort")).toHaveValue("ancien");
  await page.getByTestId("tab-postproductions").click();
  await expect(page.getByTestId("postproductions-empty")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("postproductions-empty")).toBeVisible();
  await page.getByTestId("tab-recordings").click();

  // CPT-11 : archivage avec confirmation par le nom, filtre Actif / Archivé, restauration.
  await page.getByTestId("session-menu").locator("summary").click();
  await page.getByTestId("session-archive").click();
  await expect(page.getByTestId("archive-confirm")).toBeDisabled();
  await page.getByTestId("archive-confirm-input").fill("Session du jeudi");
  await page.getByTestId("archive-confirm").click();
  await expect(page.getByTestId("session-archived")).toBeVisible();
  await page.goto(`/collectifs/${cid}/emissions/${eid}`);
  await expect(page.getByTestId("session-link")).toHaveCount(0);
  await page.getByTestId("filter-archived").click();
  await expect(page.getByTestId("session-link")).toHaveCount(1);
  await page.getByTestId("session-link").click();
  await page.getByTestId("session-menu").locator("summary").click();
  await page.getByTestId("session-unarchive").click();
  await expect(page.getByTestId("session-archived")).toHaveCount(0);
  await expect(page.getByTestId("open-studio")).toBeVisible();

  // Journal des actions sensibles.
  await page.goto(`/collectifs/${cid}/journal`);
  await expect(page.getByTestId("audit")).toContainText("archivée");
  await expect(page.getByTestId("audit")).toContainText("Monteur");
});

test("CPT-07, CPT-08, CPT-10 : prise à deux, nom corrigé, piste et ZIP, corbeille", async ({
  browser,
  browserName,
  page,
}) => {
  test.skip(browserName === "webkit", "Pas de micro simulé pour WebKit sous Linux");
  await login(page, `animateur-${uniq()}@exemple.fr`);
  const { cid, sid } = await setup(page, { emission: "Ciné du commerce", episode: "Épisode 12" });
  const link = await guestLink(page, "Lola");

  // L'hôte ouvre le studio, l'invitée arrive par son lien et attend en salle d'attente.
  await page.getByTestId("open-studio").click();
  await page.getByTestId("room-name").fill("Xad");
  await page.getByTestId("room-join").click();
  await expect(page.getByTestId("room-manage-invites")).toBeVisible();
  const guest = await newPage(browser);
  await guest.goto(link);
  await guest.getByTestId("invitation-join").click();
  await guest.getByTestId("room-name").fill("Lola");
  await guest.getByTestId("room-join").click();
  await expect(guest.getByTestId("room-lobby")).toBeVisible();
  await page.getByTestId("room-admit").click({ timeout: 15_000 });
  await expect(guest.getByTestId("rec-wait-host")).toBeVisible({ timeout: 10_000 });

  // Une prise de quelques secondes pour tout le monde.
  await expect(page.getByTestId("rec-start")).toBeEnabled({ timeout: 15_000 });
  await page.getByTestId("rec-start").click();
  await expect(guest.getByTestId("rec-panel")).toHaveAttribute("data-phase", "recording", {
    timeout: 15_000,
  });
  await page.waitForTimeout(6000);
  await page.getByTestId("rec-stop").click();
  for (const p of [page, guest])
    await expect(p.getByTestId("rec-upload")).toContainText("Tout est envoyé", { timeout: 30_000 });
  // CPT-09 : l'invitée ne voit aucun lien de téléchargement.
  await expect(guest.getByTestId("rec-sent")).toBeVisible();
  await expect(guest.getByTestId("rec-download")).toHaveCount(0);

  // CPT-07 : l'hôte corrige le nom de l'invitée, le fichier porte le nom corrigé.
  await page.goto(`/collectifs/${cid}/sessions/${sid}`);
  await expect(page.getByTestId("prise")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("track")).toHaveCount(2);
  const lola = page.getByTestId("track").filter({ hasText: "Lola" });
  await lola.getByTestId("track-rename").click();
  await lola.getByTestId("track-rename-input").fill("Lola Bertin");
  await lola.getByTestId("track-rename-save").click();
  const renamed = page.getByTestId("track").filter({ hasText: "Lola Bertin" });
  await expect(renamed.getByTestId("track-download")).toHaveText(
    "Cine-du-commerce_Episode-12_Prise1_Lola-Bertin.wav",
  );
  const href = (await renamed.getByTestId("track-download").getAttribute("href")) as string;
  const wav = await page.request.get(href);
  expect(wav.status()).toBe(200);
  expect(wav.headers()["content-disposition"]).toContain(
    "Cine-du-commerce_Episode-12_Prise1_Lola-Bertin.wav",
  );
  const wbuf = await wav.body();
  expect(wbuf.readUInt32LE(24)).toBe(48000);
  expect(wbuf.length).toBe(wbuf.readUInt32LE(40) + 44);

  // CPT-08 : archive ZIP de la session, rangée par émission / épisode / session.
  const zip = await page.request.get(`/api/collectifs/${cid}/zip?session=${sid}`);
  expect(zip.status()).toBe(200);
  expect(zip.headers()["content-type"]).toBe("application/zip");
  const zbuf = await zip.body();
  expect(zbuf.subarray(0, 2).toString()).toBe("PK");
  // Fin d'archive (répertoire central) présente : le ZIP est complet.
  expect(zbuf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  const names = zbuf.toString("latin1");
  expect(names).toContain(
    "Cine-du-commerce/Episode-12/Session-du-jeudi/Cine-du-commerce_Episode-12_Prise1_Lola-Bertin.wav",
  );
  expect(names).toContain("Cine-du-commerce_Episode-12_Prise1_Xad.wav");

  // CPT-10 : prise à la corbeille, restauration, quota affiché.
  await page.getByTestId("prise-trash").click();
  await page.getByTestId("prise-trash-ok").click();
  await expect(page.getByTestId("prises-empty")).toBeVisible();
  await page.goto(`/collectifs/${cid}/corbeille`);
  await expect(page.getByTestId("trash-item")).toContainText("encore 30 jours");
  await expect(page.getByTestId("trash-quota")).toContainText("Mo");
  await page.getByTestId("trash-restore").click();
  await expect(page.getByTestId("trash-empty")).toBeVisible();
  await page.goto(`/collectifs/${cid}/sessions/${sid}`);
  await expect(page.getByTestId("prise")).toHaveCount(1);
  await page.goto(`/collectifs/${cid}`);
  await expect(page.getByTestId("quota-used")).toContainText("Mo");
});
