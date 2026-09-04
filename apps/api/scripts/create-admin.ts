#!/usr/bin/env tsx
// One-time CLI to create (or reset the password of) an admin account.
// There's no bootstrap/signup flow in the server itself - this script is
// the only way an admin account gets made, run once by hand from a real
// terminal (not the app), same as seed-questions.ts is for content.
//
// Usage:
//   npm run create-admin -w apps/api -- --username dad --password "some-strong-password"
//
// Re-running with the same --username updates that admin's password
// instead of failing on the unique constraint - handy for a forgotten
// password, without needing a separate reset flow.

import bcrypt from "bcryptjs";
import { db } from "../src/db/client.js";
import { admins } from "../src/db/schema.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg("username")?.trim();
  const password = arg("password");

  if (!username || !password) {
    throw new Error('Usage: npm run create-admin -w apps/api -- --username <name> --password "<password>"');
  }
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [admin] = await db
    .insert(admins)
    .values({ username, passwordHash })
    .onConflictDoUpdate({ target: admins.username, set: { passwordHash } })
    .returning({ id: admins.id, username: admins.username });

  console.log(`Admin account ready: "${admin.username}" (id ${admin.id}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to create admin:", err);
    process.exit(1);
  });
