import {
  authorizeSpaceAction,
  type SpaceAccess,
  type SpaceMemberRepository,
} from "@/modules/spaces/application";
import { domainError, err, localDate, ok, type LocalDate, type Result } from "@/shared/kernel";

/** HU-E5-04: one movement of a member's net balance and the running balance after it. */
export interface BalanceEntry {
  readonly transactionId: string;
  readonly type: "EXPENSE" | "SETTLEMENT";
  readonly date: LocalDate;
  readonly description: string;
  readonly change: bigint;
  readonly balance: bigint;
}

/** The ledger's history of one member's net (one SQL window function, D7); bound by the composition root. */
export interface BalanceHistorySource {
  memberHistory(
    spaceId: string,
    memberId: string,
    range: { readonly from: LocalDate | null; readonly to: LocalDate | null },
  ): Promise<{ readonly opening: bigint; readonly entries: readonly BalanceEntry[] }>;
}

export interface BalanceHistoryDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly history: BalanceHistorySource;
}

export interface MemberBalanceHistoryView {
  readonly spaceId: string;
  readonly memberId: string;
  readonly currency: string;
  readonly from: LocalDate | null;
  readonly to: LocalDate | null;
  /** The net as of the day before `from` (0 without `from`). */
  readonly opening: bigint;
  /** The net after the last entry, or the opening balance without entries. */
  readonly closing: bigint;
  readonly entries: readonly BalanceEntry[];
}

export type GetMemberBalanceHistory = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
  from: LocalDate | null;
  to: LocalDate | null;
}) => Promise<Result<MemberBalanceHistoryView>>;

/** The brand only says that someone parsed the date: an impossible or pre-1900 one must never reach the SQL cast. */
const checked = (date: LocalDate | null): Result<LocalDate | null> =>
  date === null ? ok(null) : localDate(date);

/**
 * HU-E5-04 GetMemberBalanceHistory: any member reads how the net of a current member of the space (guests included)
 * evolved, computed on read (D7); an id that is not a current member answers MemberNotFound (ruling P29). A period
 * that cannot be read (an invalid date, or `from` after `to`, which would give a wrong opening) is refused before
 * the ledger is asked.
 */
export const createGetMemberBalanceHistory =
  (deps: BalanceHistoryDeps): GetMemberBalanceHistory =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    const from = checked(input.from);
    if (!from.ok) return from;
    const to = checked(input.to);
    if (!to.ok) return to;
    if (from.value !== null && to.value !== null && from.value > to.value) {
      return err(domainError("ValidationFailed", { from: from.value, to: to.value }));
    }
    const members = await deps.members.listCurrent(space.spaceId);
    if (!members.some((m) => m.id === input.memberId)) return err(domainError("MemberNotFound"));
    const history = await deps.history.memberHistory(space.spaceId, input.memberId, {
      from: from.value,
      to: to.value,
    });
    return ok({
      spaceId: space.spaceId,
      memberId: input.memberId,
      currency: space.currency,
      from: from.value,
      to: to.value,
      opening: history.opening,
      closing: history.entries.at(-1)?.balance ?? history.opening,
      entries: history.entries,
    });
  };
