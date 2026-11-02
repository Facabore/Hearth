import { queryOptions, useQuery } from "@tanstack/react-query";
import { controlsFor } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import type { components } from "@/shared/ui/api/schema";
import { useApis } from "../api";
import { read } from "../read";
import { recurrenceKeys } from "../recurring/keys";

export type OccurrenceDto = components["schemas"]["Occurrence"];
export type RecurrenceDto = components["schemas"]["Recurrence"];
export { recurrenceKeys };

/**
 * HU-E4-13: the space's pending occurrences, earliest first, which every member reads (P271). The shell's badge and the
 * Movimientos banner select their count from this same read, for members who record money; the screen lists them.
 */
export const pendingOccurrencesQuery = (api: Api, spaceId: string) =>
  queryOptions<OccurrenceDto[]>({
    queryKey: recurrenceKeys.pending(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/pending-occurrences", { params: { path: { spaceId } } })))
        .items,
  });

/**
 * The count of the space's pending occurrences for someone who records money there (MEMBER and above), else 0: a
 * VIEWER is never asked for it. A read that fails shows no count; it never fails the screen around it.
 */
export const usePendingCount = (space: Pick<SpaceDto, "id" | "kind" | "role"> | null): number =>
  usePending(space).length;

/** What waits, by name, earliest first, for the Movimientos banner; the same read as the count, so no request more. */
export const usePendingNames = (space: Pick<SpaceDto, "id" | "kind" | "role"> | null): readonly string[] =>
  usePending(space).map((occurrence) => occurrence.description);

const NONE: readonly OccurrenceDto[] = [];

const usePending = (space: Pick<SpaceDto, "id" | "kind" | "role"> | null): readonly OccurrenceDto[] => {
  const { api } = useApis();
  const records = space !== null && controlsFor(space.role, space.kind).recordMoney;
  return useQuery({ ...pendingOccurrencesQuery(api, space?.id ?? ""), enabled: records }).data ?? NONE;
};
