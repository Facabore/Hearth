import { queryOptions } from "@tanstack/react-query";
import type { ImportHistoryDto, ImportPreviewDto } from "@/modules/portability/ui";
import type { Api } from "@/shared/ui/api/client";
import { read } from "../read";
import { LOADER_OWNED } from "../reads";

/** D28: the personal space's imports, keyed under the space so a refresh of everything reaches them too. */
export const importKeys = {
  all: (spaceId: string) => ["imports", spaceId] as const,
  history: (spaceId: string) => ["imports", spaceId, "history"] as const,
  preview: (spaceId: string, importId: string) => ["imports", spaceId, importId, "preview"] as const,
  /** What this visit's confirm answered, for the done screen; only the confirm writes it. */
  result: (spaceId: string, importId: string) => ["imports", spaceId, importId, "result"] as const,
};

/** Past imports, newest first, with their counts and undo state. */
export const importHistoryQuery = (api: Api, spaceId: string) =>
  queryOptions<ImportHistoryDto>({
    ...LOADER_OWNED,
    queryKey: importKeys.history(spaceId),
    queryFn: () => read(api.GET("/api/v1/spaces/{spaceId}/imports", { params: { path: { spaceId } } })),
  });

/**
 * A draft's preview. The upload and every adjustment answer it and write it here; the API has no read of one draft,
 * so a visit that does not hold it (a reload, a link from the history) asks for it with an empty adjustment, which
 * changes nothing and answers the current preview (design §3.2). It never goes stale on its own.
 */
export const importPreviewQuery = (api: Api, spaceId: string, importId: string) =>
  queryOptions<ImportPreviewDto>({
    ...LOADER_OWNED,
    staleTime: Infinity,
    queryKey: importKeys.preview(spaceId, importId),
    queryFn: () =>
      read(
        api.PATCH("/api/v1/spaces/{spaceId}/imports/{importId}", {
          params: { path: { spaceId, importId } },
          body: {},
        }),
      ),
  });
