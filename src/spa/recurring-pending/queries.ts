import { queryOptions } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";
import type { components } from "@/shared/ui/api/schema";
import { read } from "../read";

export type OccurrenceDto = components["schemas"]["Occurrence"];
export type RecurrenceDto = components["schemas"]["Recurrence"];

/**
 * HU-E9-09 (ruling P270): a space's recurrences and its pending occurrences, keyed by module and space first, so a
 * confirmation or a skip invalidates both at once.
 */
export const recurrenceKeys = {
  all: (spaceId: string) => ["recurrences", spaceId] as const,
  list: (spaceId: string) => ["recurrences", spaceId, "list"] as const,
  pending: (spaceId: string) => ["recurrences", spaceId, "pending"] as const,
};

/**
 * HU-E4-13: the space's pending occurrences, earliest first, for members who record money (a VIEWER is refused). The
 * shell's badge and the Movimientos banner select their count from this same read; the screen lists them.
 */
export const pendingOccurrencesQuery = (api: Api, spaceId: string) =>
  queryOptions<OccurrenceDto[]>({
    queryKey: recurrenceKeys.pending(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/pending-occurrences", { params: { path: { spaceId } } })))
        .items,
  });
