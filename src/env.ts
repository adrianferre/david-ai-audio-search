import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Typed, validated environment variables.
 *
 * - Server-only vars go in `server` and are never exposed to the browser.
 * - Browser-visible vars must be prefixed with `NEXT_PUBLIC_` and go in `client`.
 * - Every var must also be listed in `runtimeEnv` (or `experimental__runtimeEnv`).
 *
 * Import `env` from "@/env" instead of reading `process.env` directly.
 * Document new variables in `.env.example`.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Neon Postgres (pooled). Set by the Neon integration: `vercel env pull .env.local`.
    // Required on Vercel. Optional locally: without it, `next.config.ts` proxies
    // /api/* to API_UPSTREAM_URL instead of serving it from the local route handlers.
    DATABASE_URL: process.env.VERCEL ? z.url() : z.url().optional(),
    // Private Vercel Blob store holding the FLAC files. Set by the Blob integration;
    // reads authenticate with the Vercel OIDC token (VERCEL_OIDC_TOKEN locally).
    // Required on Vercel, optional locally like DATABASE_URL.
    BLOB_STORE_ID: process.env.VERCEL ? z.string().min(1) : z.string().min(1).optional(),
    // Deployed API used by local dev servers that have no DATABASE_URL.
    API_UPSTREAM_URL: z.url().default("https://david-ai-audio-search.vercel.app"),
  },
  client: {
    // NEXT_PUBLIC_EXAMPLE_URL: z.url(),
  },
  experimental__runtimeEnv: {
    // NEXT_PUBLIC_EXAMPLE_URL: process.env.NEXT_PUBLIC_EXAMPLE_URL,
  },
  // Set SKIP_ENV_VALIDATION=1 to bypass validation (e.g. Docker image builds).
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
