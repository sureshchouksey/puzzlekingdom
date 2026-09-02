import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { subjects } from "../db/schema.js";

export async function subjectRoutes(app: FastifyInstance) {
  app.get("/subjects", async () => {
    return db.select().from(subjects);
  });
}
