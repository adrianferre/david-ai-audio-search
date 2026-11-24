import type { NextConfig } from "next";

// Importing env validates the env vars at dev/build time.
import { env } from "./src/env";

// Without database credentials (e.g. a fresh clone without Vercel access), the
// API is served by the deployed app instead of the local route handlers.
const proxyApi = !env.DATABASE_URL;
if (proxyApi) {
  console.info(`No DATABASE_URL: /api/* is proxied to ${env.API_UPSTREAM_URL}`);
}

const nextConfig: NextConfig = {
  async rewrites() {
    if (!proxyApi) return [];
    return {
      // beforeFiles runs before the filesystem routes, so it overrides src/app/api.
      beforeFiles: [
        { source: "/api/:path*", destination: `${env.API_UPSTREAM_URL}/api/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
