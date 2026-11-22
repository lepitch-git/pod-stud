import { describe, expect, it } from "vitest";
import {
  can,
  DAY_MS,
  dedupeNames,
  filePart,
  formatSize,
  isValidEmail,
  linkState,
  numberPrises,
  trackFileName,
  trashDaysLeft,
  trashExpired,
  visibleEmissions,
} from "./collectif";

describe("rôles", () => {
  const monteur = { role: "monteur" as const, emissions: ["e1"] };
  const animateur = { role: "animateur" as const, emissions: "*" as const };
  it("le monteur accède aux fichiers de ses émissions mais n'enregistre pas (CPT-03)", () => {
    expect(can(monteur, "fichiers", "e1")).toBe(true);
    expect(can(monteur, "enregistrer", "e1")).toBe(false);
    expect(can(monteur, "fichiers", "e2")).toBe(false);
  });
  it("l'animateur enregistre mais ne gère pas le collectif", () => {
    expect(can(animateur, "enregistrer", "e9")).toBe(true);
    expect(can(animateur, "gerer")).toBe(false);
  });
  it("l'administrateur gère tout sauf la propriété", () => {
    const admin = { role: "admin" as const, emissions: [] };
    expect(can(admin, "gerer")).toBe(true);
    expect(can(admin, "fichiers", "e1")).toBe(true);
    expect(can(admin, "posseder")).toBe(false);
    expect(can({ role: "proprietaire", emissions: [] }, "posseder")).toBe(true);
  });
  it("sans membre, rien n'est permis", () => {
    expect(can(null, "voir")).toBe(false);
  });
  it("ne montre que les émissions permises", () => {
    expect(visibleEmissions(monteur, [{ id: "e1" }, { id: "e2" }])).toEqual([{ id: "e1" }]);
  });
});

describe("noms de fichiers (ENR-18)", () => {
  it("suit le modèle Emission_Episode_Prise2_Lola.wav", () => {
    expect(
      trackFileName({
        emission: "Ciné du commerce",
        episode: "Épisode 12",
        prise: 2,
        participant: "Lola",
      }),
    ).toBe("Cine-du-commerce_Episode-12_Prise2_Lola.wav");
  });
  it("remplace un nom vide", () => {
    expect(filePart("  ?? ")).toBe("sans-nom");
    expect(trackFileName({ emission: "A", episode: "B", prise: 1, participant: "" })).toBe(
      "A_B_Prise1_Intervenant.wav",
    );
  });
  it("distingue deux intervenants homonymes", () => {
    expect(dedupeNames(["Lola", "Max", "lola"])).toEqual(["Lola", "Max", "lola-2"]);
  });
});

describe("liens d'invitation (ENR-17)", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");
  it("valide, expiré, révoqué, utilisé", () => {
    expect(linkState({ expiresAt: "2026-11-23T00:00:00Z" }, now)).toBe("valide");
    expect(linkState({ expiresAt: "2026-11-22T11:00:00Z" }, now)).toBe("expire");
    expect(linkState({ expiresAt: "2026-11-23T00:00:00Z", revokedAt: "x" }, now)).toBe("revoque");
    expect(linkState({ expiresAt: "2026-11-23T00:00:00Z", usedAt: "x" }, now)).toBe("utilise");
  });
});

describe("corbeille (ENR-20)", () => {
  it("garde 30 jours", () => {
    const d = "2026-11-01T00:00:00Z";
    expect(trashDaysLeft(d, Date.parse(d) + DAY_MS)).toBe(29);
    expect(trashExpired(d, Date.parse(d) + 29 * DAY_MS)).toBe(false);
    expect(trashExpired(d, Date.parse(d) + 30 * DAY_MS)).toBe(true);
  });
});

describe("divers", () => {
  it("formate les tailles", () => {
    expect(formatSize(512)).toBe("512 o");
    expect(formatSize(1_500_000).replace(/\s/g, " ")).toBe("1,5 Mo");
    expect(formatSize(500e9).replace(/\s/g, " ")).toBe("500 Go");
  });
  it("vérifie les adresses e-mail", () => {
    expect(isValidEmail("lola@exemple.fr")).toBe(true);
    expect(isValidEmail("lola@exemple")).toBe(false);
  });
  it("numérote les prises par départ commun", () => {
    const p = numberPrises([
      { id: "b1", startServerMs: 2000 },
      { id: "a1", startServerMs: 1000 },
      { id: "a2", startServerMs: 1000 },
    ]);
    expect(p.map((g) => [g.number, g.tracks.map((t) => t.id)])).toEqual([
      [1, ["a1", "a2"]],
      [2, ["b1"]],
    ]);
  });
});
