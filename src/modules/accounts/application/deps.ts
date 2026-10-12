import type { SpaceAccess } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { AccountMovements } from "./account-movements";
import type { AccountRepository } from "./account-repository";

export interface AccountsDeps {
  readonly accounts: AccountRepository;
  readonly access: SpaceAccess;
  readonly movements: AccountMovements;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
