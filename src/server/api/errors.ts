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
