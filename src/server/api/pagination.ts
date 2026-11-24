import "server-only";

import { z } from "zod";

import type { PaginatedResponse } from "@/lib/api/v1/types";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Offset pagination over an in-memory list. Pages past the end are empty. */
export function paginate<T, R = T>(
  items: readonly T[],
  { page, pageSize }: PaginationQuery,
  map: (item: T) => R = (item) => item as unknown as R,
): PaginatedResponse<R> {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    data: items.slice(start, start + pageSize).map(map),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNextPage,
      hasPreviousPage,
      nextPage: hasNextPage ? page + 1 : null,
      previousPage: hasPreviousPage ? page - 1 : null,
    },
  };
}
