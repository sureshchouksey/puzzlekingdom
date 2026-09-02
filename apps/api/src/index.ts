import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./env.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);

app.get("/health", async () => ({ status: "ok" }));

// Routes land here as each step of docs/PLAN.md's build order is built:
//   POST /documents           - upload a PDF/image, tag it with a subject
//   POST /documents/:id/generate - call Claude, generate + save questions
//   GET  /subjects            - list subjects (for the subject picker)
//   POST /quizzes              - assemble a quiz for a chosen subject
//   POST /quizzes/:id/submit   - score a completed quiz
//   GET  /quizzes/:id/results  - the results + answer review screen

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
