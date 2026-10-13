import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { SpaceAccess } from "./space-access";
import type { SpaceMemberRepository } from "./space-member-repository";

export interface MembersDeps {
  readonly access: SpaceAccess;
  readonly members: SpaceMemberRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
