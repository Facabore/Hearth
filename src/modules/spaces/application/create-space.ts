import { map, ok, type Clock, type IdGenerator, type Result, type TransactionManager } from "@/shared/kernel";
import { createSharedSpace, type Space } from "../domain/space";
import type { CreatePersonalSpace, SpaceCreatedListener } from "./create-personal-space";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

export interface CreateSpaceDeps {
  readonly spaces: SpaceRepository;
  readonly createPersonalSpace: CreatePersonalSpace;
  readonly onCreated: SpaceCreatedListener;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}

interface Creator {
  readonly userId: string;
  readonly userName: string;
  readonly locale: string;
}

export type CreateSpaceInput =
  | (Creator & { readonly kind: "PERSONAL" })
  | (Creator & { readonly kind: "SHARED"; readonly name: string; readonly currency: string });

export type CreateSpace = (input: CreateSpaceInput) => Promise<Result<SpaceSummary>>;

/** The creator always holds OWNER in a space they just created. */
const ownedSummary = (space: Space): SpaceSummary => ({
  id: space.id,
  name: space.name,
  kind: space.kind,
  currency: space.currency,
  periodPolicy: space.periodPolicy,
  role: "OWNER",
});

export const createCreateSpace =
  (deps: CreateSpaceDeps): CreateSpace =>
  async (input) => {
    // HU-E1-02: personal spaces come with sign-up; asking for another one answers PersonalSpaceAlreadyExists.
    if (input.kind === "PERSONAL") {
      return map(
        await deps.createPersonalSpace({ userId: input.userId, name: input.userName, locale: input.locale }),
        ownedSummary,
      );
    }
    return deps.tm.run(async () => {
      const space = createSharedSpace({
        id: deps.ids.next<"Space">(),
        memberId: deps.ids.next<"SpaceMember">(),
        ownerUserId: input.userId,
        ownerName: input.userName,
        name: input.name,
        currency: input.currency,
        now: deps.clock.now(),
      });
      if (!space.ok) return space;
      await deps.spaces.add(space.value);
      // HU-E3-01: default categories in the creator's locale, in the same transaction as the space.
      const reacted = await deps.onCreated(space.value, { locale: input.locale });
      if (!reacted.ok) return reacted;
      return ok(ownedSummary(space.value));
    });
  };
