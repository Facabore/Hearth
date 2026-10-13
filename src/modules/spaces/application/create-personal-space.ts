import {
  domainError,
  err,
  ok,
  type Clock,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { createPersonalSpace, type Space } from "../domain/space";
import type { SpaceRepository } from "./space-repository";

/** Reacts to a new space inside its transaction, e.g. seeding default categories (HU-E3-01). */
export type SpaceCreatedListener = (
  space: Space,
  context: { readonly locale: string },
) => Promise<Result<void>>;

export interface CreatePersonalSpaceDeps {
  readonly spaces: SpaceRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
  readonly onCreated: SpaceCreatedListener;
}

export type CreatePersonalSpace = (owner: {
  userId: string;
  name: string;
  locale: string;
}) => Promise<Result<Space>>;

export const createCreatePersonalSpace =
  (deps: CreatePersonalSpaceDeps): CreatePersonalSpace =>
  (owner) =>
    deps.tm.run(async () => {
      if (await deps.spaces.hasPersonalSpace(owner.userId))
        return err(domainError("PersonalSpaceAlreadyExists"));
      const space = createPersonalSpace({
        id: deps.ids.next<"Space">(),
        memberId: deps.ids.next<"SpaceMember">(),
        ownerUserId: owner.userId,
        ownerName: owner.name,
        now: deps.clock.now(),
      });
      await deps.spaces.add(space);
      const reacted = await deps.onCreated(space, { locale: owner.locale });
      if (!reacted.ok) return reacted;
      return ok(space);
    });
