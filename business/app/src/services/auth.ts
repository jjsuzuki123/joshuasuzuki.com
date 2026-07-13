import argon2 from "argon2";
import { z } from "zod";
import type { Repo, UserRow } from "../domain/repo.js";
import { generateToken, hashToken } from "../lib/crypto.js";
import { now } from "../db.js";
import { TRIAL_DAYS } from "../domain/plans.js";

const SESSION_TTL_SECONDS = 30 * 24 * 3600;
const RESET_TTL_SECONDS = 3600;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address.")
  .max(254, "That email address is too long.");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters — a short sentence works well.")
  .max(200, "That password is too long (200 characters max).");

export interface AuthResult {
  ok: boolean;
  error?: string;
  user?: UserRow;
  sessionToken?: string;
}

export class AuthService {
  constructor(private readonly repo: Repo) {}

  async signup(emailRaw: string, passwordRaw: string): Promise<AuthResult> {
    const email = emailSchema.safeParse(emailRaw);
    if (!email.success) return { ok: false, error: email.error.issues[0]!.message };
    const password = passwordSchema.safeParse(passwordRaw);
    if (!password.success) return { ok: false, error: password.error.issues[0]!.message };

    if (this.repo.getUserByEmail(email.data)) {
      // Deliberately the same shape as success path length-wise; the message is
      // honest because signup pages are not a meaningful oracle for this app.
      return { ok: false, error: "An account with this email already exists. Try logging in instead." };
    }
    const hash = await argon2.hash(password.data, { type: argon2.argon2id });
    const trialEndsAt = now() + TRIAL_DAYS * 24 * 3600;
    const user = this.repo.createUser(email.data, hash, trialEndsAt);
    const sessionToken = this.createSession(user.id);
    return { ok: true, user, sessionToken };
  }

  async login(emailRaw: string, passwordRaw: string): Promise<AuthResult> {
    const email = emailSchema.safeParse(emailRaw);
    const genericError = "That email and password combination doesn't match our records.";
    if (!email.success) return { ok: false, error: genericError };
    const user = this.repo.getUserByEmail(email.data);
    if (!user) {
      // Burn comparable time to a real verify so timing doesn't reveal account existence.
      await argon2
        .verify(
          "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$WYPOpUL5wnEwq/pRO1WWpQmVA2Y1WHnhAWmDgVIcTBE",
          passwordRaw ?? "",
        )
        .catch(() => undefined);
      return { ok: false, error: genericError };
    }
    const valid = await argon2.verify(user.password_hash, passwordRaw ?? "").catch(() => false);
    if (!valid) return { ok: false, error: genericError };
    const sessionToken = this.createSession(user.id);
    return { ok: true, user, sessionToken };
  }

  createSession(userId: number): string {
    const token = generateToken();
    this.repo.createSession(userId, hashToken(token), now() + SESSION_TTL_SECONDS);
    return token;
  }

  resolveSession(token: string | undefined): { user: UserRow; sessionId: number } | null {
    if (!token || token.length > 200) return null;
    const found = this.repo.getSessionUser(hashToken(token));
    if (!found) return null;
    // Rolling expiry: extend when less than half the TTL remains.
    if (found.expiresAt - now() < SESSION_TTL_SECONDS / 2) {
      this.repo.touchSession(found.sessionId, now() + SESSION_TTL_SECONDS);
    }
    return { user: found.user, sessionId: found.sessionId };
  }

  logout(token: string | undefined): void {
    if (token) this.repo.deleteSession(hashToken(token));
  }

  /** Always succeeds from the caller's perspective (no account enumeration). */
  createPasswordResetToken(emailRaw: string): { token: string; user: UserRow } | null {
    const email = emailSchema.safeParse(emailRaw);
    if (!email.success) return null;
    const user = this.repo.getUserByEmail(email.data);
    if (!user) return null;
    const token = generateToken();
    this.repo.createPasswordReset(user.id, hashToken(token), now() + RESET_TTL_SECONDS);
    return { token, user };
  }

  async resetPassword(token: string, newPasswordRaw: string): Promise<AuthResult> {
    const password = passwordSchema.safeParse(newPasswordRaw);
    if (!password.success) return { ok: false, error: password.error.issues[0]!.message };
    const reset = this.repo.usePasswordReset(hashToken(token ?? ""));
    if (!reset) {
      return { ok: false, error: "This reset link is invalid or has expired. Request a new one below." };
    }
    const hash = await argon2.hash(password.data, { type: argon2.argon2id });
    this.repo.updateUserPassword(reset.userId, hash);
    // Invalidate every existing session for safety, then issue a fresh one.
    this.repo.deleteSessionsForUser(reset.userId);
    const user = this.repo.getUserById(reset.userId)!;
    const sessionToken = this.createSession(user.id);
    return { ok: true, user, sessionToken };
  }
}
