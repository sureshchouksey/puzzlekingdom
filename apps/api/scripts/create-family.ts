#!/usr/bin/env tsx
// One-time CLI to create the first family + its first owner account, and
// (by default) adopt every existing profile that has no family yet into
// it - this is how the 13 profiles that predate the family flow (Track 7,
// migration 0024) get a family, since the migration itself deliberately
// leaves family_id null rather than guessing. Same pattern as
// create-admin.ts: run once by hand from a real terminal (not the app;
// device_bash on the cloud side has no network path to the live DB),
// safe to re-run (re-running with the same --email updates that owner's
// PIN instead of failing on the unique constraint).
//
// Family owners log in with a 4-digit PIN (migration 0025), matching the
// keypad a child profile already uses - not a password.
//
// Usage:
//   npm run create-family -w apps/api -- --name "The Chouksey Family" --email dad@example.com --pin 1234
//
// Add --no-adopt-orphans to skip adopting existing family_id=null
// profiles (e.g. if you want to assign them by hand afterwards instead).

import bcrypt from "bcryptjs";
import { eq, isNull } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { families, familyOwners, profiles } from "../src/db/schema.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flag(name: string, defaultValue: boolean): boolean {
  if (process.argv.includes(`--no-${name}`)) return false;
  if (process.argv.includes(`--${name}`)) return true;
  return defaultValue;
}

async function main() {
  const name = arg("name")?.trim();
  const email = arg("email")?.trim();
  const pin = arg("pin");
  const adoptOrphans = flag("adopt-orphans", true);

  if (!name || !email || !pin) {
    throw new Error(
      'Usage: npm run create-family -w apps/api -- --name "The Chouksey Family" --email <email> --pin <4-digit-pin>'
    );
  }
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }

  const pinHash = await bcrypt.hash(pin, 10);

  const [existingOwner] = await db.select().from(familyOwners).where(eq(familyOwners.email, email)).limit(1);
  if (existingOwner) {
    const [updated] = await db
      .update(familyOwners)
      .set({ pinHash })
      .where(eq(familyOwners.id, existingOwner.id))
      .returning({ id: familyOwners.id, familyId: familyOwners.familyId, email: familyOwners.email });
    console.log(`Family owner "${updated.email}" already existed - PIN updated (family ${updated.familyId}).`);
    process.exit(0);
  }

  const result = await db.transaction(async (tx) => {
    const [family] = await tx.insert(families).values({ name }).returning();
    const [owner] = await tx
      .insert(familyOwners)
      .values({ familyId: family.id, email, pinHash })
      .returning();

    let adoptedCount = 0;
    if (adoptOrphans) {
      const adopted = await tx
        .update(profiles)
        .set({ familyId: family.id })
        .where(isNull(profiles.familyId))
        .returning({ id: profiles.id, name: profiles.name });
      adoptedCount = adopted.length;
    }

    return { family, owner, adoptedCount };
  });

  console.log(
    `Family "${result.family.name}" ready (id ${result.family.id}), owner "${result.owner.email}" created.` +
      (adoptOrphans ? ` Adopted ${result.adoptedCount} existing profile(s) with no family into it.` : "")
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to create family:", err);
    process.exit(1);
  });
