import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../config.js";

/**
 * All outbound email goes through here. When SMTP isn't configured the mailer
 * reports itself disabled and callers degrade gracefully (features that need
 * email explain themselves in the UI instead of erroring).
 */
export class Mailer {
  private transporter: Transporter | null = null;
  readonly enabled: boolean;
  private readonly from: string = "";

  constructor(
    config: AppConfig,
    private readonly log: (msg: string) => void,
  ) {
    if (config.smtp) {
      this.transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass ?? "" } : undefined,
      });
      this.from = config.smtp.from;
      this.enabled = true;
    } else {
      this.enabled = false;
    }
  }

  /** Send; never throws. Returns false if disabled or the send failed. */
  async send(to: string, subject: string, text: string): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
      return true;
    } catch (err) {
      this.log(`email send failed (${subject}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}

export function passwordResetEmail(baseUrl: string, token: string): { subject: string; text: string } {
  return {
    subject: "Reset your SiteRamp password",
    text: [
      "Someone (hopefully you) asked to reset the password for this SiteRamp account.",
      "",
      `Reset it here (link valid for 1 hour): ${baseUrl}/reset-password?token=${token}`,
      "",
      "If you didn't ask for this, you can ignore this email — nothing changes.",
    ].join("\n"),
  };
}

export function scanFinishedEmail(input: {
  baseUrl: string;
  siteName: string;
  scanId: number;
  score: number | null;
  grade: string;
  newIssues: number;
  resolvedIssues: number;
  failed: boolean;
  errorMessage?: string | null;
}): { subject: string; text: string } {
  if (input.failed) {
    return {
      subject: `Scan failed: ${input.siteName}`,
      text: [
        `The scheduled scan of ${input.siteName} could not complete.`,
        "",
        `Reason: ${input.errorMessage ?? "Unknown error."}`,
        "",
        `Details: ${input.baseUrl}/scans/${input.scanId}`,
      ].join("\n"),
    };
  }
  return {
    subject:
      input.newIssues > 0
        ? `${input.siteName}: ${input.newIssues} new accessibility ${input.newIssues === 1 ? "issue" : "issues"} found`
        : `${input.siteName}: scan complete — no new issues`,
    text: [
      `Scheduled scan finished for ${input.siteName}.`,
      "",
      `Score: ${input.score ?? "—"} (${input.grade})`,
      `New issues since last scan: ${input.newIssues}`,
      `Resolved since last scan: ${input.resolvedIssues}`,
      "",
      `Full report: ${input.baseUrl}/scans/${input.scanId}`,
    ].join("\n"),
  };
}
