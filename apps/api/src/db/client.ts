import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { env } from "../env.js";

// `prepare: false` - required for Supabase's pooled (pgbouncer, transaction-mode)
// connection string, which doesn't support prepared statements.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema });

// The `postgres` client above keeps its TCP socket open/ref'd by design
// (for connection reuse), which means the Node process never exits on
// its own - nothing was ever draining the event loop, so every
// `tsx watch` restart (a file save, Ctrl+C) had to sit out a timeout and
// force-kill the process. index.ts's SIGINT/SIGTERM handler calls this so
// a normal restart/shutdown actually exits cleanly instead.
export async function closeDb(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
