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

  it("creates Ana's personal space when she has none, with her as OWNER and the default categories", async () => {
    const { create, spaces, categories } = setup();
    const summary = unwrap(await create({ ...ana, kind: "PERSONAL" }));
    expect(summary).toMatchObject({ kind: "PERSONAL", currency: "COP", role: "OWNER" });
    expect(spaces.members(summary.id)).toEqual([
      expect.objectContaining({ kind: "USER", userId: "u-ana", displayName: "Ana", role: "OWNER" }),
    ]);
    expect(groupNamed(categories, summary.id, "Vivienda")).toEqual([
      "Arriendo",
      "Servicios",
      "Mantenimiento",
    ]);
    expect(await spaces.listForUser("u-ana")).toEqual([summary]);
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

describe("CreateSpace with its budget period (#240, board Crear espacio compartido)", () => {
  const household = { ...ana, kind: "SHARED" as const, name: "Household", currency: "COP" };

  it("creates the space with the period policy asked for, monthly or twice a month", async () => {
    const { create, spaces } = setup();
    const monthly = unwrap(await create({ ...household, periodPolicy: { kind: "MONTHLY", day: 15 } }));
    expect(monthly.periodPolicy).toEqual({ kind: "MONTHLY", day: 15 });
    const twice = unwrap(
      await create({ ...household, name: "Trip", periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }),
    );
    expect(twice.periodPolicy).toEqual({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 });
    expect((await spaces.listForUser("u-ana")).map((s) => s.periodPolicy)).toEqual([
      { kind: "MONTHLY", day: 15 },
      { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
    ]);
  });

  it("keeps MONTHLY(1) when no period policy is asked for", async () => {
    const { create } = setup();
    expect(unwrap(await create(household)).periodPolicy).toEqual({ kind: "MONTHLY", day: 1 });
  });

  it("refuses a policy the settings would refuse, and creates nothing", async () => {
    const { create, spaces } = setup();
    for (const periodPolicy of [
      { kind: "MONTHLY", day: 0 },
      { kind: "MONTHLY", day: 32 },
      { kind: "SEMI_MONTHLY", day1: 16, day2: 1 },
      { kind: "SEMI_MONTHLY", day1: 10, day2: 10 },
    ] as const)
      expect(codeOf(await create({ ...household, periodPolicy }))).toBe("InvalidPeriodPolicy");
    expect(spaces.spaces).toEqual([]);
  });
});
