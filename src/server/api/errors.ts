import "server-only";

import type { ApiErrorBody } from "@/lib/api/v1/types";

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    error: { code, message, ...(details !== undefined && { details }) },
  };
  return Response.json(body, { status });
}

/**
 * 500 with the standard error body. Logs the cause server-side and keeps it
 * out of the response (it can carry connection or query details).
 */
export function internalError(error: unknown): Response {
  console.error("[api] Unhandled error:", error);
  return apiError(500, "internal_error", "Internal server error");
}
