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
  sql ??= neon(env.DATABASE_URL);
  return sql;
}
