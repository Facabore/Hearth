import { ok, type Result } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "./space-repository";

export type ListMySpaces = (userId: string) => Promise<Result<SpaceSummary[]>>;

export const createListMySpaces =
  (spaces: SpaceRepository): ListMySpaces =>
  async (userId) =>
    ok(await spaces.listForUser(userId));
