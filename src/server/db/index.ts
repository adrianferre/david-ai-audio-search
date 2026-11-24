import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { env } from "@/env";

let sql: NeonQueryFunction<false, false> | undefined;

/**
 * Neon's HTTP driver: one fetch per query (or transaction), no connection
 * pool to manage. Created lazily so importing this module never needs the
 * connection string.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (!env.DATABASE_URL) {
    // Without it, next.config.ts proxies /api/* upstream, so this is only reached
    // by code that queries the database outside the API routes.
    throw new Error("DATABASE_URL is not set. Run `vercel env pull .env.local` to query the database.");
  }
  sql ??= neon(env.DATABASE_URL);
  return sql;
}
