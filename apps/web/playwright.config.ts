import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout sur les trois moteurs de navigateurs visés (ENR-08) :
 * Chromium (Chrome, Edge, Android), Firefox et WebKit (Safari Mac et iPhone).
 * PW_PROJECTS=chromium permet de n'en lancer qu'un en local.
 */
const only = process.env.PW_PROJECTS?.split(",");
const projects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
  { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
].filter((p) => !only || only.includes(p.name));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3000", trace: "off" },
  projects,
  webServer: {
    command: "pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
