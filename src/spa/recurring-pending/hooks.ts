import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { ConfirmOutcome, PendingItem, SkipOutcome } from "@/modules/ledger/ui/screens";
import { findCategory } from "@/modules/categories/ui";
import { controlsFor, personalSpaceOf } from "@/modules/spaces/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import { outcomeOf } from "@/shared/ui/api/readers";
import { useApis } from "../api";
import { sharedSpace, type Viewer } from "../load";
import { accountsQuery, categoriesQuery, membersQuery } from "../reads";
import { recurrencesQuery } from "../recurring/queries";
import { pendingOccurrencesQuery, recurrenceKeys, type RecurrenceDto } from "./queries";

/** The occurrence's category icon and color, when the space still has its category. */
const categoryOf = (groups: Parameters<typeof findCategory>[0], categoryId: string | null) => {
  const found = categoryId === null ? null : findCategory(groups, categoryId);
  return found ? { category: { icon: found.category.icon, color: found.category.color } } : {};
};

/** "Por confirmar" as a query hook (P127 in the SPA): the items, named from the cache the loader filled. */
export const usePendingItems = (viewer: Viewer): { items: PendingItem[]; canAct: boolean } => {
  const { api } = useApis();
  const { space, spaces } = viewer;
  const canAct = controlsFor(space.role, space.kind).recordMoney;
  const shared = sharedSpace(space);
  const recurrences = useSuspenseQuery(recurrencesQuery(api, space.id)).data;
  const pending = useSuspenseQuery(pendingOccurrencesQuery(api, space.id)).data;
  const members = useQuery({ ...membersQuery(api, space.id), enabled: shared }).data ?? [];
  const accounts = useQuery(accountsQuery(api, space.id, "all")).data ?? [];
  // P270's cards carry the category's icon; a read that fails leaves the icon out, never the card.
  const groups = useQuery(categoriesQuery(api, space.id, "all")).data ?? [];
  const own = useQuery({
    ...accountsQuery(api, personalSpaceOf(spaces).id, "all"),
    enabled: canAct && shared,
  });
  const names = new Map<string, string>([
    ...members.map((m): [string, string] => [m.id, m.displayName]),
    ...[...accounts, ...(own.data ?? [])].map((a): [string, string] => [a.id, a.name]),
  ]);
  const byId = new Map(recurrences.map((r) => [r.id, r]));
  const items = pending.flatMap((occurrence): PendingItem[] => {
    const recurrence = byId.get(occurrence.recurrenceId);
    if (!recurrence) return [];
    const details = [recurrence.payerMemberId, recurrence.sourceAccountId].flatMap((id) => {
      const name = id === null ? undefined : names.get(id);
      return name === undefined ? [] : [name];
    });
    return [
      {
        id: occurrence.id,
        recurrenceId: recurrence.id,
        name: recurrence.description,
        type: recurrence.type,
        date: occurrence.date,
        suggested: occurrence.amount,
        details,
        ...categoryOf(groups, occurrence.categoryId),
      },
    ];
  });
  return { items, canAct };
};

/**
 * The two writes of "Por confirmar". A confirmation records the movement the record form would, so the ledger's own
 * plan for a recorded expense writes it into the cached pages and its detail and invalidates every total it changes
 * (ADR 0006: the transaction list and the home included); both writes then read the recurrences and the pending
 * occurrences again, which the shell's badge and the Movimientos banner count.
 */
export const usePendingWrites = (spaceId: string) => {
  const { api } = useApis();
  const queryClient = useQueryClient();
  const refreshRecurrences = () =>
    void queryClient.invalidateQueries({ queryKey: recurrenceKeys.space(spaceId) });

  const confirm = async (item: PendingItem, amount: MoneyDto, key: string): Promise<ConfirmOutcome> => {
    const result = await api.POST("/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/confirm", {
      params: { path: { spaceId, occurrenceId: item.id }, header: { "idempotency-key": key } },
      body: { amount },
    });
    const outcome = outcomeOf(result);
    if (outcome.kind !== "ok") return { ok: false, problem: problemFrom(result.error, result.response) };
    const { ledgerWrites } = await import("../ledger/writes");
    ledgerWrites(
      { method: "POST", path: "/api/v1/spaces/{spaceId}/expenses", params: { spaceId }, body: undefined },
      queryClient,
    )?.accepted(queryClient, outcome.data);
    refreshRecurrences();
    return { ok: true, transactionId: outcome.data.id };
  };

  const skip = async (item: PendingItem): Promise<SkipOutcome> => {
    const result = await api.POST("/api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/skip", {
      params: { path: { spaceId, occurrenceId: item.id } },
    });
    if (!result.response.ok) return { ok: false, problem: problemFrom(result.error, result.response) };
    // The toast names the recurrence's next date as the API gives it, never one computed here.
    const fresh = await api
      .GET("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}", {
        params: { path: { spaceId, recurrenceId: item.recurrenceId } },
      })
      .then(outcomeOf)
      .catch(() => null);
    const cached = queryClient
      .getQueryData<RecurrenceDto[]>(recurrenceKeys.list(spaceId))
      ?.find((r) => r.id === item.recurrenceId);
    refreshRecurrences();
    const next = fresh?.kind === "ok" ? fresh.data.nextOccurrence : (cached?.nextOccurrence ?? null);
    return { ok: true, next };
  };

  return { confirm, skip };
};
