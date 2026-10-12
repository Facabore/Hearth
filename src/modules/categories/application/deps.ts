import type { SpaceAccess } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { CategoryRepository } from "./category-repository";

export interface CategoriesDeps {
  readonly categories: CategoryRepository;
  readonly access: SpaceAccess;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
