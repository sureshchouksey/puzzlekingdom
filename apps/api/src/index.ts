import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { subjectRoutes } from "./routes/subjects.js";
import { documentRoutes } from "./routes/documents.js";
import { quizRoutes } from "./routes/quizzes.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);

app.get("/health", async () => ({ status: "ok" }));

await app.register(subjectRoutes);
await app.register(documentRoutes);
await app.register(quizRoutes);

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
