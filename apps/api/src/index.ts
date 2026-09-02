import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { subjectRoutes } from "./routes/subjects.js";
import { documentRoutes } from "./routes/documents.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);

app.get("/health", async () => ({ status: "ok" }));

await app.register(subjectRoutes);
await app.register(documentRoutes);

// Still to come, per docs/PLAN.md's build order:
//   POST /quizzes              - assemble a quiz for a chosen subject
//   POST /quizzes/:id/submit   - score a completed quiz
//   GET  /quizzes/:id/results  - the results + answer review screen

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
