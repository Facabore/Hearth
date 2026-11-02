import { queryOptions } from "@tanstack/react-query";
import { controlsFor, personalSpaceOf } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import { ensurer, sharedSpace, viewerOf, type Load } from "../load";
import { read } from "../read";
import { accountsQuery, LOADER_OWNED, membersQuery } from "../reads";
import { pendingOccurrencesQuery, recurrenceKeys, type RecurrenceDto } from "./queries";

/** HU-E4-11: the space's recurrences with their next and last occurrences, which any member reads. */
export const recurrencesQuery = (api: Api, spaceId: string) =>
  queryOptions<RecurrenceDto[]>({
    ...LOADER_OWNED,
    queryKey: recurrenceKeys.list(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/recurrences", { params: { path: { spaceId } } }))).items,
  });

/** Names only: a read that fails leaves its labels out, never the screen. */
const settled = (promise: Promise<unknown>): Promise<void> =>
  promise.then(
    () => undefined,
    () => undefined,
  );

/**
 * "Por confirmar" (ruling P270): the recurrences, which name each occurrence's payer and account, and, for a member
 * who records money, the pending occurrences themselves (the API lists them to no one else). A shared space's members
 * and the accounts name the payer and the account; neither ever fails the screen.
 */
export const loadPendingOccurrences = async (load: Load, spaceId: string): Promise<void> => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = await viewerOf(load, spaceId);
  if (!viewer) return;
  const records = controlsFor(viewer.space.role, viewer.space.kind).recordMoney;
  await Promise.all([
    ensure(recurrencesQuery(api, spaceId)),
    records ? ensure(pendingOccurrencesQuery(api, spaceId)) : undefined,
    sharedSpace(viewer.space) ? settled(ensure(membersQuery(api, spaceId))) : undefined,
    settled(ensure(accountsQuery(api, spaceId, "all"))),
    records && sharedSpace(viewer.space)
      ? settled(ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "all")))
      : undefined,
  ]);
};
