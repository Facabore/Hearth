import { queryOptions } from "@tanstack/react-query";
// A type only: the queries load with the loaders, the screens in their own chunk.
import type { RecurrenceDto } from "@/modules/ledger/ui/screens";
import type { Api } from "@/shared/ui/api/client";
import { read } from "../read";
import { LOADER_OWNED } from "../reads";
import { recurrenceKeys } from "./keys";

export { recurrenceKeys };

/** How many next dates a recurrence's detail shows (P270), as the form's preview does (P269). */
export const UPCOMING = 3;

/** The space's recurrences in the order they were defined, with their status and next occurrence. */
export const recurrencesQuery = (api: Api, spaceId: string) =>
  queryOptions<RecurrenceDto[]>({
    ...LOADER_OWNED,
    queryKey: recurrenceKeys.list(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/recurrences", { params: { path: { spaceId } } }))).items,
  });

/** One recurrence; one that is gone is not found (N1). */
export const recurrenceQuery = (api: Api, spaceId: string, recurrenceId: string) =>
  queryOptions<RecurrenceDto>({
    ...LOADER_OWNED,
    queryKey: recurrenceKeys.one(spaceId, recurrenceId),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}", {
          params: { path: { spaceId, recurrenceId } },
        }),
      ),
  });

/** HU-E4-11: the next dates a recurrence will record, from the API (none while paused or ended). */
export const upcomingQuery = (api: Api, spaceId: string, recurrenceId: string) =>
  queryOptions<string[]>({
    ...LOADER_OWNED,
    queryKey: recurrenceKeys.upcoming(spaceId, recurrenceId),
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/occurrences", {
            params: { path: { spaceId, recurrenceId }, query: { count: UPCOMING } },
          }),
        )
      ).dates,
  });
