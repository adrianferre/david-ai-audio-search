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
            // The catalog rarely changes, so cached responses stay valid.
            staleTime: 5 * 60 * 1000,
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
