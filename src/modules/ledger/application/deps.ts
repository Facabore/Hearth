import type { SpaceAccess, SpaceMemberRepository, StoredPeriodSource } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager, UserTimeZones } from "@/shared/kernel";
import type {
  AccountBalances,
  AccountReader,
  AuditLog,
  CategoryReader,
  ClosedPeriodGuard,
  DefaultSplitSource,
  TransactionQuery,
  TransactionRepository,
} from "./ports";

export interface LedgerDeps {
  readonly access: SpaceAccess;
  /** HU-E4-07: the current members in join order; payers and participants must be among them. */
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly transactions: TransactionRepository;
  readonly query: TransactionQuery;
  readonly audit: AuditLog;
  readonly accounts: AccountReader;
  /** HU-E4-10: the fund balance after a fund-paid expense. */
  readonly accountBalances: AccountBalances;
  readonly categories: CategoryReader;
  readonly closedPeriods: ClosedPeriodGuard;
  /** HU-E6-08: the default split of an expense recorded without one (BY_ALLOCATION or EQUAL). */
  readonly defaultSplits: DefaultSplitSource;
  readonly storedPeriods: StoredPeriodSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** The deployment time zone (APP_TIMEZONE), for space-level clocks only (HU-E1-14). */
  readonly timeZone: string;
  /** HU-E1-14, HU-E4-14: each user's own zone, for "today" and the time of what they record. */
  readonly userTimeZones: UserTimeZones;
  readonly tm: TransactionManager;
}
