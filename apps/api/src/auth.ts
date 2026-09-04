import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import jwt from "@fastify/jwt";
import { env } from "./env.js";

// Session identity carried in a signed JWT - either a lightweight player
// profile (no password) or a real admin account. Decoded once per request
// by the onRequest hook below (registerAuth) and consulted by
// requireIdentity/requireAdmin, and sometimes directly by routes that
// behave differently for profile vs admin callers (e.g. /reports).
export type Identity =
  | { kind: "profile"; profileId: string; name: string }
  | { kind: "admin"; adminId: string; username: string };

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: Identity;
    user: Identity;
  }
}

// Registers @fastify/jwt and a soft onRequest hook that decodes an
// optional "Authorization: Bearer <token>" header into request.identity.
// Never rejects on its own - most routes (classes, subjects, quizzes,
// leaderboard) stay exactly as open as they are today. Routes that need a
// logged-in caller use the requireIdentity/requireAdmin preHandlers below.
export async function registerAuth(app: FastifyInstance) {
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorateRequest("identity", null);

  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    try {
      request.identity = await request.jwtVerify<Identity>();
    } catch {
      request.identity = null;
    }
  });
}

// preHandler: 401s unless a valid profile or admin token was sent.
export async function requireIdentity(request: FastifyRequest, reply: FastifyReply) {
  if (!request.identity) {
    reply.status(401).send({ error: "Login required" });
  }
}

// preHandler: 403s unless the caller is a logged-in admin. A non-admin
// identity or no identity at all both fail this check.
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (request.identity?.kind !== "admin") {
    reply.status(403).send({ error: "Admin access required" });
  }
}
