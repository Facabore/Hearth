import type { SpaceAccess, SpaceMemberRepository, StoredPeriodSource } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type {
  AccountReader,
  AuditLog,
  CategoryReader,
  ClosedPeriodGuard,
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
  readonly categories: CategoryReader;
  readonly closedPeriods: ClosedPeriodGuard;
  readonly storedPeriods: StoredPeriodSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** The space timezone; v1 uses the deployment timezone (APP_TIMEZONE). */
  readonly timeZone: string;
  readonly tm: TransactionManager;
}
