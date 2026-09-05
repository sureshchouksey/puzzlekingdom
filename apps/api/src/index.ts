import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { subjectRoutes } from "./routes/subjects.js";
import { classRoutes } from "./routes/classes.js";
import { documentRoutes } from "./routes/documents.js";
import { quizRoutes } from "./routes/quizzes.js";
import { reportRoutes } from "./routes/reports.js";
import { profileRoutes } from "./routes/profiles.js";
import { leaderboardRoutes } from "./routes/leaderboard.js";
import { registerAuth } from "./auth.js";
import { adminRoutes } from "./routes/admin.js";
import { tutorRoutes } from "./routes/tutor.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);

app.get("/health", async () => ({ status: "ok" }));

// Shared family passcode gate for the public deployment - every route
// except /health must send a matching "x-app-passcode" header once
// APP_PASSCODE is configured. Left unset (local/LAN dev), this hook is a
// no-op and nothing behaves differently than before. This is deliberately
// NOT real per-user authentication - just a single shared secret to keep
// random internet visitors out, since profiles have no passwords.
app.addHook("onRequest", async (request, reply) => {
  if (!env.APP_PASSCODE) return;
  if (request.url === "/health") return;
  if (request.headers["x-app-passcode"] !== env.APP_PASSCODE) {
    reply.status(401).send({ error: "Invalid or missing passcode" });
  }
});

// Lightweight endpoint the frontend's passcode gate calls to check whether
// a passcode the user just typed in is correct - the onRequest hook above
// already does the real check, so a 200 here just confirms it passed.
app.get("/auth/check", async () => ({ ok: true }));

// Real per-user sessions (profile or admin), layered on top of the shared
// passcode gate above. Soft: most routes don't require a logged-in caller,
// same as before this existed - see auth.ts.
await registerAuth(app);

await app.register(subjectRoutes);
await app.register(classRoutes);
await app.register(documentRoutes);
await app.register(quizRoutes);
await app.register(reportRoutes);
await app.register(profileRoutes);
await app.register(leaderboardRoutes);
await app.register(adminRoutes);
await app.register(tutorRoutes);

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
