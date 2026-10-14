import { map, type Result } from "@/shared/kernel";
import { authorizeSpaceAction, toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type GetSpace = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceSummary>>;

/** Any current member reads the space, also once it is archived (HU-E1-09). */
export const createGetSpace =
  (access: SpaceAccess): GetSpace =>
  async ({ spaceId, userId }) =>
    map(await authorizeSpaceAction(access, spaceId, userId, "space.read"), toSpaceSummary);
