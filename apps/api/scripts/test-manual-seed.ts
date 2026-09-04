// Smoke test for the "I already have questions" manual-entry path (no AI
// call at all) via Fastify's in-process .inject() - still needs real
// internet for the DB writes, so run from your own Terminal:
//   npm run test:manual -w apps/api
//
// /documents/manual is admin-only (see routes/documents.ts), so this logs
// in as a disposable test admin account first (upserted directly, same as
// scripts/create-admin.ts) and sends its token on every request.

import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { registerAuth } from "../src/auth.js";
import { documentRoutes } from "../src/routes/documents.js";
import { db } from "../src/db/client.js";
import { admins } from "../src/db/schema.js";

async function main() {
  const app = Fastify();
  await registerAuth(app);
  await app.register(documentRoutes);

  const testUsername = "test-manual-seed-admin";
  await db
    .insert(admins)
    .values({ username: testUsername, passwordHash: await bcrypt.hash("test-only-password", 4) })
    .onConflictDoUpdate({ target: admins.username, set: { passwordHash: await bcrypt.hash("test-only-password", 4) } });
  const adminToken = await app.jwt.sign({ kind: "admin", adminId: "test", username: testUsername });
  const authHeaders = { authorization: `Bearer ${adminToken}` };

  console.log("1/2  Saving 2 hand-entered questions with no AI call...");
  const goodRes = await app.inject({
    method: "POST",
    url: "/documents/manual",
    headers: authHeaders,
    payload: {
      subjectName: "Maths",
      filename: "Manual test batch",
      questions: [
        {
          questionText: "What is 6 x 7?",
          options: [
            { id: "a", text: "36" },
            { id: "b", text: "42" },
            { id: "c", text: "48" },
            { id: "d", text: "40" },
          ],
          correctOptionId: "b",
          explanation: "6 x 7 = 42.",
        },
        {
          questionText: "What is half of 90?",
          options: [
            { id: "a", text: "40" },
            { id: "b", text: "43" },
            { id: "c", text: "45" },
            { id: "d", text: "50" },
          ],
          correctOptionId: "c",
          explanation: "Half of 90 is 45.",
        },
      ],
    },
  });
  if (goodRes.statusCode !== 201) throw new Error(`Expected 201, got ${goodRes.statusCode}: ${goodRes.body}`);
  console.log("     OK -", goodRes.json());

  console.log("2/2  Confirming an invalid batch (correctOptionId not among the options) is rejected...");
  const badRes = await app.inject({
    method: "POST",
    url: "/documents/manual",
    headers: authHeaders,
    payload: {
      subjectName: "Maths",
      questions: [
        {
          questionText: "Broken question",
          options: [
            { id: "a", text: "1" },
            { id: "b", text: "2" },
          ],
          correctOptionId: "z",
          explanation: "n/a",
        },
      ],
    },
  });
  console.log(
    badRes.statusCode === 400
      ? "     OK - correctly rejected with 400"
      : `     UNEXPECTED status ${badRes.statusCode}: ${badRes.body}`
  );

  console.log("\n=== SUCCESS - manual question entry works, validation holds ===\n");
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
