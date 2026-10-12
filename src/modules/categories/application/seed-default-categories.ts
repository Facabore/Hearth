import { ok, type Result } from "@/shared/kernel";
import { seedTree } from "../domain/default-catalog";
import type { CategoriesDeps } from "./deps";

export type SeedDefaultCategories = (input: { spaceId: string; locale: string }) => Promise<Result<void>>;

/** HU-E3-01: reacts to a new space (no endpoint); seeding a space that has categories does nothing. */
export const createSeedDefaultCategories =
  (deps: Pick<CategoriesDeps, "categories" | "ids" | "clock" | "tm">): SeedDefaultCategories =>
  (input) =>
    deps.tm.run(async () => {
      if (await deps.categories.hasAny(input.spaceId)) return ok(undefined);
      const tree = seedTree({
        spaceId: input.spaceId,
        locale: input.locale,
        now: deps.clock.now(),
        ids: deps.ids,
      });
      await deps.categories.addGroups(tree.groups);
      await deps.categories.addCategories(tree.categories);
      return ok(undefined);
    });
