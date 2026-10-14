import { ok, type Result } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

/** HU-E1-02, HU-E1-09: the user's spaces; archived ones too when asked for (the M1 `archived=true` convention). */
export type ListMySpaces = (
  userId: string,
  options?: { readonly includeArchived?: boolean },
) => Promise<Result<SpaceSummary[]>>;

export const createListMySpaces =
  (spaces: SpaceRepository): ListMySpaces =>
  async (userId, options = {}) =>
    ok(await spaces.listForUser(userId, options));
