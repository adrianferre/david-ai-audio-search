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

/** Offset of the first item of the requested page. */
export function pageOffset({ page, pageSize }: PaginationQuery): number {
  return (page - 1) * pageSize;
}

/**
 * Builds the response for one page of offset pagination. `items` is that page
 * (already sliced) and `total` the size of the whole list. Pages past the end are empty.
 */
export function toPaginatedResponse<T, R = T>(
  items: readonly T[],
  total: number,
  { page, pageSize }: PaginationQuery,
  map: (item: T) => R = (item) => item as unknown as R,
): PaginatedResponse<R> {
  const totalPages = Math.ceil(total / pageSize);
  const hasNextPage = page < totalPages;
  const hasPreviousPage = page > 1;

  return {
    data: items.map(map),
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
