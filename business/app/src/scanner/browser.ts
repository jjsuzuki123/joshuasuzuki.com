import { chromium, type Browser } from "playwright";

/**
 * Shared Chromium instance. Launched lazily, restarted if it dies, and closed
 * between site scans to bound memory on a small VPS.
 */
let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    const b = browser;
    browser = null;
    await b.close().catch(() => undefined);
  }
}
