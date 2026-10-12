import { map, type Result } from "@/shared/kernel";
import { toSpaceSummary, type SpaceAccess } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type GetSpace = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceSummary>>;

export const createGetSpace =
  (access: SpaceAccess): GetSpace =>
  async ({ spaceId, userId }) =>
    map(await access(spaceId, userId), toSpaceSummary);
