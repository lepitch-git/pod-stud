import { describe, expect, it } from "vitest";
import { detectBrowser } from "./browser";

const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
};

describe("detectBrowser", () => {
  it("reconnaît Chrome ordinateur", () => expect(detectBrowser(UA.chrome).family).toBe("chrome"));
  it("reconnaît Edge avant Chrome", () => expect(detectBrowser(UA.edge).family).toBe("edge"));
  it("reconnaît Firefox", () => expect(detectBrowser(UA.firefox).family).toBe("firefox"));
  it("reconnaît Safari Mac", () => {
    const b = detectBrowser(UA.safari);
    expect(b.family).toBe("safari");
    expect(b.version).toBe("26.1");
  });
  it("classe tout navigateur iPhone comme moteur Safari", () => {
    expect(detectBrowser(UA.iphone).family).toBe("safari-ios");
    const c = detectBrowser(UA.iphoneChrome);
    expect(c.family).toBe("safari-ios");
    expect(c.label).toContain("Chrome");
    expect(c.mobile).toBe(true);
  });
  it("reconnaît Chrome Android", () =>
    expect(detectBrowser(UA.android).family).toBe("chrome-android"));
});
