import {
  authorizeSpaceAction,
  type MemberPlaceRepository,
  type SpaceAccess,
  type SpaceRepository,
  type StoredPeriodSource,
} from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  periodByLabel,
  resolvePeriod,
  todayIn,
  type Clock,
  type Period,
  type Result,
  type UserTimeZones,
} from "@/shared/kernel";
import type { TransactionType } from "../domain/transaction";
import { describeActivity, type ActivityDescriptionDeps } from "./activity-description";
import type { ActivityItem } from "./list-my-activity";
import { positionOf } from "./list-transactions";
import type {
  CategoryReader,
  TransactionPosition,
  TransactionsAcrossFilter,
  TransactionsAcrossQuery,
} from "./ports";

/**
 * Ruling P319 (#294): the personal Movimientos, every current space of the caller in one list. The period is the
 * caller's personal space's; `spaceId` narrows the list to one of the caller's current spaces.
 */
export interface MyTransactionsInput {
  readonly userId: string;
  /** A period label of the personal space, such as "2026-10" or "2026-11 H1"; the current period when absent. */
  readonly period?: string;
  /** One of the caller's current spaces; any other space answers SpaceNotFound. */
  readonly spaceId?: string;
  /** Category ids of any of the spaces listed; each also matches its subcategories (P48). */
  readonly categoryIds?: readonly string[];
  readonly accountId?: string;
  readonly type?: TransactionType;
  /** A piece of the description; blank means no search (P277). */
  readonly search?: string;
  readonly after: TransactionPosition | null;
  readonly limit: number;
}

export interface MyTransactionPage {
  /** The personal space's period listed. */
  readonly period: Period;
  /** The personal space's currency, the totals' (P37: spaces in another currency stay out of the sums). */
  readonly currency: string;
  /**
   * Over the whole filtered period: `share` is the caller's share of the expenses, `income` the incomes the caller
   * received.
   */
  readonly totals: { readonly share: bigint; readonly income: bigint };
  readonly items: readonly ActivityItem[];
  readonly nextPosition: TransactionPosition | null;
}

export type ListMyTransactions = (input: MyTransactionsInput) => Promise<Result<MyTransactionPage>>;

export interface MyTransactionsDeps extends ActivityDescriptionDeps {
  /** The caller's current spaces, archived ones left out. */
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  /** The caller's member rows, former ones and a claimed guest's included: what is theirs in each space. */
  readonly places: MemberPlaceRepository;
  readonly access: SpaceAccess;
  readonly storedPeriods: StoredPeriodSource;
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
  /** HU-E3-04, ruling P48: a category's filter also matches its subcategories, in each space. */
  readonly categoryTree: Pick<CategoryReader, "subcategoriesOf">;
  readonly query: TransactionsAcrossQuery;
}

/**
 * Ruling P319 (#294): the personal Movimientos. The live movements of every current space of the caller, personal one
 * included, within one period of the personal space, filtered as a space's list is (P277), in its order (P43), each
 * described as Inicio describes it (P306), with the caller's share and received incomes over the whole filtered period.
 */
export const createListMyTransactions =
  (deps: MyTransactionsDeps): ListMyTransactions =>
  async (input) => {
    const current = await deps.spaces.listForUser(input.userId);
    const personal = current.find((s) => s.kind === "PERSONAL");
    if (!personal) return err(domainError("SpaceNotFound"));
    const membership = await authorizeSpaceAction(deps.access, personal.id, input.userId, "space.read");
    if (!membership.ok) return membership;
    const home = membership.value;
    // Never a space the caller does not currently belong to: it answers as a space read does.
    const spaces = input.spaceId === undefined ? current : current.filter((s) => s.id === input.spaceId);
    if (spaces.length === 0) return err(domainError("SpaceNotFound"));
    const stored = await deps.storedPeriods(home.spaceId);
    const period =
      input.period === undefined
        ? ok(
            resolvePeriod(
              home.periodPolicy,
              stored,
              todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(input.userId)),
            ),
          )
        : periodByLabel(home.periodPolicy, stored, input.period);
    if (!period.ok) return period;
    // HU-E3-04, ruling P48: a category's filter also matches its subcategories, whichever space it belongs to.
    const categoryIds =
      input.categoryIds === undefined || input.categoryIds.length === 0
        ? input.categoryIds
        : [
            ...new Set([
              ...input.categoryIds,
              ...(
                await Promise.all(
                  spaces.map((s) => deps.categoryTree.subcategoriesOf(s.id, input.categoryIds!)),
                )
              ).flat(),
            ]),
          ];
    const filter: TransactionsAcrossFilter = {
      spaceIds: spaces.map((s) => s.id),
      from: period.value.start,
      to: period.value.end,
      categoryIds,
      type: input.type,
      accountId: input.accountId,
      search: input.search?.trim() || undefined,
    };
    // Ruling P37: a space in another currency is listed, but its movements stay out of the sums.
    const summed = new Set(spaces.filter((s) => s.currency === home.currency).map((s) => s.id));
    const places = await deps.places.placesOf(input.userId);
    const memberIds = places.filter((p) => summed.has(p.spaceId)).map((p) => p.memberId as string);
    // One extra row tells whether another page exists.
    const [rows, totals] = await Promise.all([
      deps.query.listAcross(filter, input.after, input.limit + 1),
      summed.size === 0
        ? { share: 0n, income: 0n }
        : deps.query.memberTotalsAcross({ ...filter, spaceIds: [...summed] }, memberIds),
    ]);
    const shown = rows.slice(0, input.limit);
    const last = shown.at(-1);
    return ok({
      period: period.value,
      currency: home.currency,
      totals,
      items: await describeActivity(deps, {
        userId: input.userId,
        spaces,
        places,
        transactions: shown,
      }),
      nextPosition: rows.length > input.limit && last ? positionOf(last) : null,
    });
  };
