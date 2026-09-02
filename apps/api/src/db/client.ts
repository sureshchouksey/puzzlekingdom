import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { env } from "../env.js";

// `prepare: false` - required for Supabase's pooled (pgbouncer, transaction-mode)
// connection string, which doesn't support prepared statements.
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema });
