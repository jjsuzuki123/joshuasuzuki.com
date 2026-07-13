/**
 * Dev seed: creates a demo account so the local demo starts populated.
 *   email: demo@example.com  password: demo-password-123
 * Run with: npm run seed
 */
import argon2 from "argon2";
import { loadConfig } from "../config.js";
import { openDb, now } from "../db.js";
import { Repo } from "../domain/repo.js";
import { TRIAL_DAYS } from "../domain/plans.js";

async function main(): Promise<void> {
  const config = loadConfig();
  if (config.isProd) {
    console.error("Refusing to seed a production database.");
    process.exit(1);
  }
  const db = openDb(config.dataDir);
  const repo = new Repo(db);
  const email = "demo@example.com";
  if (repo.getUserByEmail(email)) {
    console.log(`Seed user ${email} already exists — nothing to do.`);
    return;
  }
  const hash = await argon2.hash("demo-password-123", { type: argon2.argon2id });
  const user = repo.createUser(email, hash, now() + TRIAL_DAYS * 24 * 3600);
  repo.updateUserProfile(user.id, "Demo Web Studio", "#1d4ed8");
  console.log(`Created ${email} (password: demo-password-123).`);
  console.log("Log in and add any public site — or run the bundled fixture site (see README).");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
