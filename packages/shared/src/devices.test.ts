import { describe, expect, it } from "vitest";
import { assessDevice, cleanLabel, dedupeDevices, recommendDevice } from "./devices";

describe("assessDevice", () => {
  it("reconnaît un micro USB comme externe et conseillé", () => {
    expect(assessDevice("Blue Yeti (046d:0ab7)", "micro").category).toBe("externe");
    expect(assessDevice("Shure MV7", "micro").category).toBe("externe");
  });
  it("avertit pour un micro Bluetooth", () => {
    const a = assessDevice("AirPods Pro de Lola", "micro");
    expect(a.category).toBe("bluetooth");
    expect(a.note).toContain("qualité téléphone");
  });
  it("conseille un meilleur micro que celui intégré", () => {
    const a = assessDevice("Default - MacBook Pro Microphone (Built-in)", "micro");
    expect(a.category).toBe("integre");
    expect(a.note).toContain("micro USB");
  });
  it("écarte les périphériques virtuels", () => {
    expect(assessDevice("BlackHole 2ch", "micro").category).toBe("virtuel");
    expect(assessDevice("OBS Virtual Camera", "camera").category).toBe("virtuel");
  });
  it("prévient que les haut-parleurs intégrés créent de l'écho", () => {
    expect(assessDevice("Haut-parleurs (Realtek High Definition Audio)", "sortie").note).toContain(
      "casque",
    );
  });
});

describe("recommendDevice", () => {
  it("préfère le micro USB au micro intégré et au Bluetooth", () => {
    const id = recommendDevice(
      [
        { deviceId: "a", label: "MacBook Pro Microphone" },
        { deviceId: "b", label: "AirPods Pro" },
        { deviceId: "c", label: "Rode NT-USB" },
      ],
      "micro",
    );
    expect(id).toBe("c");
  });
  it("garde le premier en cas d'égalité", () => {
    expect(
      recommendDevice(
        [
          { deviceId: "x", label: "Micro A" },
          { deviceId: "y", label: "Micro B" },
        ],
        "micro",
      ),
    ).toBe("x");
  });
  it("préfère un casque filaire aux haut-parleurs", () => {
    expect(
      recommendDevice(
        [
          { deviceId: "s", label: "MacBook Pro Speakers" },
          { deviceId: "h", label: "External Headphones" },
        ],
        "sortie",
      ),
    ).toBe("h");
  });
});

describe("dedupeDevices", () => {
  it("retire les doublons « Par défaut » et « Communications » de Chrome", () => {
    const list = dedupeDevices([
      { deviceId: "default", label: "Par défaut - Micro USB" },
      { deviceId: "communications", label: "Communications - Micro USB" },
      { deviceId: "abc", label: "Micro USB" },
      { deviceId: "def", label: "Micro intégré" },
    ]);
    expect(list.map((d) => d.deviceId)).toEqual(["abc", "def"]);
  });
  it("nettoie les préfixes", () => expect(cleanLabel("Default - Casque")).toBe("Casque"));
});
