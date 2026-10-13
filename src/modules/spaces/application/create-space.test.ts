import { describe, expect, it } from "vitest";
import { createSeedDefaultCategories } from "@/modules/categories/application";
import { domainError, err, FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { createCreatePersonalSpace, type SpaceCreatedListener } from "./create-personal-space";
import { createCreateSpace } from "./create-space";

const clock = new FixedClock(new Date("2026-10-13T12:00:00Z"));
const ana = { userId: "u-ana", userName: "Ana", locale: "es" };

const setup = (onCreated?: SpaceCreatedListener) => {
  const spaces = new InMemorySpaceStore();
  const categories = new InMemoryCategories();
  const ids = sequentialIds("id");
  const seed = createSeedDefaultCategories({ categories, ids, clock, tm: memoryTm });
  const listener: SpaceCreatedListener =
    onCreated ?? ((space, { locale }) => seed({ spaceId: space.id, locale }));
  const createPersonalSpace = createCreatePersonalSpace({
    spaces,
    ids,
    clock,
    tm: memoryTm,
    onCreated: listener,
  });
  return {
    spaces,
    categories,
    createPersonalSpace,
    create: createCreateSpace({ spaces, createPersonalSpace, onCreated: listener, ids, clock, tm: memoryTm }),
  };
};

/** Category names of the group called `group` in the space, in seed order. */
const groupNamed = (categories: InMemoryCategories, spaceId: string, group: string) => {
  const found = categories.groups.find((g) => g.spaceId === spaceId && g.name === group);
  return found ? categories.categories.filter((c) => c.groupId === found.id).map((c) => c.name) : undefined;
};

describe("CreateSpace (HU-E1-04)", () => {
  it("creates Household as a SHARED space with Ana as its only OWNER and seeds default categories", async () => {
    const { create, spaces, categories } = setup();
    const summary = unwrap(await create({ ...ana, kind: "SHARED", name: "Household", currency: "COP" }));
    expect(summary).toEqual({
      id: "id-1",
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    expect(spaces.members("id-1")).toEqual([
      expect.objectContaining({
        id: "id-2",
        kind: "USER",
        userId: "u-ana",
        displayName: "Ana",
        role: "OWNER",
      }),
    ]);
    expect(groupNamed(categories, "id-1", "Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
    expect(await spaces.listForUser("u-ana")).toEqual([summary]);
  });

  it("seeds English names for a creator whose locale is en (HU-E3-01)", async () => {
    const { create, categories } = setup();
    const flat = unwrap(
      await create({
        userId: "u-juan",
        userName: "Juan",
        locale: "en",
        kind: "SHARED",
        name: "Flat",
        currency: "COP",
      }),
    );
    expect(groupNamed(categories, flat.id, "Housing")).toEqual(["Rent", "Utilities", "Maintenance"]);
  });

  it("requires a name", async () => {
    const { create, spaces } = setup();
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "  ", currency: "COP" }))).toBe(
      "InvalidSpaceName",
    );
    expect(spaces.spaces).toEqual([]);
  });

  it("rejects an unsupported currency", async () => {
    const { create, spaces } = setup();
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "Household", currency: "XYZ" }))).toBe(
      "UnknownCurrency",
    );
    expect(spaces.spaces).toEqual([]);
  });

  it("refuses another personal space (HU-E1-02)", async () => {
    const { create, createPersonalSpace } = setup();
    unwrap(await createPersonalSpace({ userId: "u-ana", name: "Ana", locale: "es" }));
    expect(codeOf(await create({ ...ana, kind: "PERSONAL" }))).toBe("PersonalSpaceAlreadyExists");
  });

  it("returns the seeding error, so the caller's transaction rolls back", async () => {
    const { create } = setup(async () => err(domainError("SeedFailed")));
    expect(codeOf(await create({ ...ana, kind: "SHARED", name: "Household", currency: "COP" }))).toBe(
      "SeedFailed",
    );
  });
});
