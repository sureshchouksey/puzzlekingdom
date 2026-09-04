import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { subjects } from "../db/schema.js";

export async function subjectRoutes(app: FastifyInstance) {
  // Note: to list only subjects available within a given class, use
  // GET /classes/:id/subjects instead - this always returns the full
  // global subject list (Maths, English, Science, ...), same as before
  // the class layer was added.
  app.get("/subjects", async () => {
    return db.select().from(subjects);
  });
}
