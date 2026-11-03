import type { SpaceAccess, SpaceLocks } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager, UserTimeZones } from "@/shared/kernel";
import type { AccountMovements } from "./account-movements";
import type { AccountRepository } from "./account-repository";

export interface AccountsDeps {
  readonly accounts: AccountRepository;
  readonly access: SpaceAccess;
  /**
   * Issue #245: creating an account and editing one write an amount in the space currency, so they hold the space row
   * as money writes do (#89) and a currency change waits for them, or they for it.
   */
  readonly spaceLocks: Pick<SpaceLocks, "lockForMoneyWrite">;
  readonly movements: AccountMovements;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** HU-E1-14: "today" for the next billing dates is the requester's local date (HU-E2-06). */
  readonly userTimeZones: UserTimeZones;
  readonly tm: TransactionManager;
}
