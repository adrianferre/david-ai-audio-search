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
    // EXAMPLE_API_KEY: z.string().min(1),
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
