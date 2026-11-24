"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/lib/api/v1/client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The catalog is fixed on the server, so a cached response never
            // goes stale. That keeps the catalog's loaded pages from all being
            // fetched again on a remount or reconnect.
            staleTime: Infinity,
            refetchOnWindowFocus: false,
            // Retrying a 429 only digs deeper into the rate limit.
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status === 429) &&
              failureCount < 3,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
