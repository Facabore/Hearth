import { describe, expect, it } from "vitest";
import type { SpaceSummary } from "@/modules/spaces/application";
import { FixedClock } from "@/shared/kernel";
import {
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import type { CategoriesDeps } from "./deps";
import { createListMyCategories } from "./list-my-categories";
import { createSeedDefaultCategories } from "./seed-default-categories";

const summary = (id: string, kind: SpaceSummary["kind"]): SpaceSummary => ({
  id,
  name: id,
  kind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  color: "GRAPHITE",
});

/**
 * Ana's personal space and a household she belongs to; `space-gone` is listed for her but no longer lets her in (the
 * per-space read refuses it), so it is left out.
 */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(
      membership(),
      membership({ spaceId: "space-household", memberId: "member-ana-h", spaceKind: "SHARED" }),
    ),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const seed = createSeedDefaultCategories(deps);
  for (const spaceId of ["space-ana", "space-household", "space-gone"])
    unwrap(await seed({ spaceId, locale: "es" }));
  const listed: string[] = [];
  const listMine = createListMyCategories({
    ...deps,
    counts: { usageCountsOf: async () => new Map() },
    spaces: {
      listForUser: async (userId) => {
        listed.push(userId);
        return [
          summary("space-ana", "PERSONAL"),
          summary("space-household", "SHARED"),
          summary("space-gone", "SHARED"),
        ];
      },
    },
  });
  return { categories, listMine, listed };
};

describe("ListMyCategories (#338)", () => {
  it("gives each of the viewer's spaces its category tree, as the space's own list does, and leaves out one that refuses", async () => {
    const { listMine, listed } = await setup();
    const mine = unwrap(await listMine({ userId: "u-ana", includeArchived: false }));
    expect(listed).toEqual(["u-ana"]);
    expect(mine.map((entry) => entry.spaceId)).toEqual(["space-ana", "space-household"]);
    expect(mine[0]!.groups.map((g) => g.name)).toContain("Vivienda");
    expect(mine[1]!.groups.every((g) => g.spaceId === "space-household")).toBe(true);
  });

  it("lists archived groups only when asked", async () => {
    const { categories, listMine } = await setup();
    const housing = categories.groups.find((g) => g.spaceId === "space-household" && g.name === "Vivienda")!;
    categories.groups = categories.groups.map((g) =>
      g.id === housing.id ? { ...g, archivedAt: new Date("2026-10-11T12:00:00Z") } : g,
    );
    const names = async (includeArchived: boolean) =>
      unwrap(await listMine({ userId: "u-ana", includeArchived }))[1]!.groups.map((g) => g.name);
    expect(await names(false)).not.toContain("Vivienda");
    expect(await names(true)).toContain("Vivienda");
  });
});
