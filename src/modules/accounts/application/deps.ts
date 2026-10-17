import type { SpaceAccess } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager, UserTimeZones } from "@/shared/kernel";
import type { AccountMovements } from "./account-movements";
import type { AccountRepository } from "./account-repository";

export interface AccountsDeps {
  readonly accounts: AccountRepository;
  readonly access: SpaceAccess;
  readonly movements: AccountMovements;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** HU-E1-14: "today" for the next billing dates is the requester's local date (HU-E2-06). */
  readonly userTimeZones: UserTimeZones;
  readonly tm: TransactionManager;
}
