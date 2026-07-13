import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { getBrowser } from "../scanner/browser.js";
import type { ReportViewModel } from "../domain/report.js";
import type { AppContext } from "../app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, "..", "views");

let env: nunjucks.Environment | null = null;
function getEnv(): nunjucks.Environment {
  if (!env) {
    env = new nunjucks.Environment(new nunjucks.FileSystemLoader(viewsDir), { autoescape: true });
    env.addFilter("datetime", (unixSeconds: number | null) =>
      unixSeconds
        ? new Date(unixSeconds * 1000).toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
          })
        : "—",
    );
    env.addFilter("dateonly", (unixSeconds: number | null) =>
      unixSeconds
        ? new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })
        : "—",
    );
    env.addFilter("hostname", (url: string) => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    });
    env.addFilter("pathOf", (url: string) => {
      try {
        const u = new URL(url);
        return u.pathname + u.search || "/";
      } catch {
        return url;
      }
    });
  }
  return env;
}

/**
 * Render the branded report to PDF bytes. The HTML is rendered server-side and
 * loaded with page.setContent — no network round-trip, no auth plumbing, and
 * the logo is inlined as a data URI so the PDF is self-contained.
 */
export async function renderReportPdf(vm: ReportViewModel, ctx: AppContext): Promise<Buffer> {
  const logoDataUri = vm.branding.logoPath ? logoToDataUri(ctx.config.dataDir, vm.branding.logoPath) : null;
  const html = getEnv().render("report-print.njk", {
    vm,
    brand: "SiteRamp",
    logoDataUri,
    forPdf: true,
  });

  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function logoToDataUri(dataDir: string, logoPath: string): string | null {
  try {
    // logoPath is stored as a bare filename inside dataDir/logos (validated at upload).
    const safeName = path.basename(logoPath);
    const abs = path.join(dataDir, "logos", safeName);
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(safeName).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
