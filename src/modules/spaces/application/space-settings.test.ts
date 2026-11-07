import { spaceColor } from "../domain/space";
import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { codeOf, memoryTm, noSpaceLocks, noStoredPeriods, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetSpace } from "./get-space";
import { createListSpacePeriods, type StoredPeriodSource } from "./list-space-periods";
import { createSpaceAccess } from "./space-access";
import { createUpdateSpaceSettings } from "./update-space-settings";

/** "Household" with OWNER Ana and, unless left out, MEMBER Juan. */
const householdOf = (withJuan = true) => {
  const store = new InMemorySpaceStore();
  store.seed(
    householdSpace([memberOf("Ana", "OWNER", 0), ...(withJuan ? [memberOf("Juan", "MEMBER", 1)] : [])]),
  );
  return store;
};
const asAna = { spaceId: "space-household", userId: "u-ana" };
const d = (iso: string) => iso as LocalDate;

const setup = (
  options: { hasMoneyRecords?: boolean; storedPeriods?: StoredPeriodSource; now?: string } = {},
) => {
  const spaces = householdOf();
  const access = createSpaceAccess(spaces);
  return {
    spaces,
    get: createGetSpace(access),
    update: createUpdateSpaceSettings({
      spaces,
      spaceLocks: noSpaceLocks,
      access,
      usage: { hasMoneyRecords: async () => options.hasMoneyRecords ?? false },
      tm: memoryTm,
    }),
    periods: createListSpacePeriods({
      access,
      storedPeriods: options.storedPeriods ?? noStoredPeriods,
      clock: new FixedClock(new Date(options.now ?? "2026-10-28T15:00:00Z")),
      timeZone: "America/Bogota",
    }),
  };
};

describe("UpdateSpaceSettings (HU-E1-03)", () => {
  it("switches to a monthly cut-off on the 25th", async () => {
    const { update, periods } = setup();
    const updated = unwrap(
      await update({ ...asAna, changes: { periodPolicy: { kind: "MONTHLY", day: 25 } } }),
    );
    expect(updated.periodPolicy).toEqual({ kind: "MONTHLY", day: 25 });
    expect(unwrap(await periods({ ...asAna, from: d("2026-10-24"), count: 1 }))).toEqual([
      { start: "2026-09-25", end: "2026-10-24", label: "2026-10" },
    ]);
  });

  it("switches to semi-monthly periods on the 5th and 20th", async () => {
    const { update, periods } = setup();
    unwrap(
      await update({ ...asAna, changes: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 } } }),
    );
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-03"), count: 1 }))).toEqual([
      { start: "2026-10-20", end: "2026-11-04", label: "2026-10 H2" },
    ]);
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-25"), count: 1 }))).toEqual([
      { start: "2026-11-20", end: "2026-12-04", label: "2026-11 H2" },
    ]);
  });

  it.each<PeriodPolicy>([
    { kind: "MONTHLY", day: 0 },
    { kind: "MONTHLY", day: 32 },
    { kind: "SEMI_MONTHLY", day1: 20, day2: 5 },
  ])("rejects %o with InvalidPeriodPolicy and keeps MONTHLY(1)", async (periodPolicy) => {
    const { update, spaces } = setup();
    expect(codeOf(await update({ ...asAna, changes: { periodPolicy } }))).toBe("InvalidPeriodPolicy");
    expect(spaces.spaces[0]?.periodPolicy).toEqual({ kind: "MONTHLY", day: 1 });
  });

  it("does not move a period that already has a plan", async () => {
    const plan: StoredPeriod = { start: d("2026-11-01"), end: d("2026-11-30"), label: "2026-11" };
    const { update, periods } = setup({ storedPeriods: async () => [plan] });
    unwrap(await update({ ...asAna, changes: { periodPolicy: { kind: "MONTHLY", day: 25 } } }));
    expect(unwrap(await periods({ ...asAna, from: d("2026-11-01"), count: 3 }))).toEqual([
      plan,
      { start: "2026-12-01", end: "2026-12-24", label: "2026-12" },
      { start: "2026-12-25", end: "2027-01-24", label: "2027-01" },
    ]);
  });

  it("forbids members without admin rights", async () => {
    const { update } = setup();
    const result = await update({ spaceId: "space-household", userId: "u-juan", changes: { name: "Casa" } });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("locks the currency once the space holds money records", async () => {
    const { update } = setup({ hasMoneyRecords: true });
    expect(codeOf(await update({ ...asAna, changes: { currency: "USD" } }))).toBe("SpaceCurrencyLocked");
    expect(codeOf(await update({ ...asAna, changes: { currency: "COP", name: "Casa" } }))).toBe("ok");
  });

  it("holds the space row before it reads the membership or the money records (issue #245)", async () => {
    const events: string[] = [];
    const spaces = householdOf(false);
    const access = createSpaceAccess(spaces);
    const update = createUpdateSpaceSettings({
      spaces,
      spaceLocks: {
        lockForLifecycle: async (spaceId) => {
          events.push(`lock ${spaceId}`);
        },
      },
      access: async (spaceId, userId, options) => {
        events.push(`access ${spaceId}`);
        return access(spaceId, userId, options);
      },
      usage: {
        hasMoneyRecords: async (spaceId) => {
          events.push(`usage ${spaceId}`);
          return false;
        },
      },
      tm: memoryTm,
    });
    unwrap(await update({ ...asAna, changes: { currency: "USD" } }));
    expect(events).toEqual(["lock space-household", "access space-household", "usage space-household"]);
  });

  it("changes name and currency of a space without money records", async () => {
    const { update, get } = setup();
    unwrap(await update({ ...asAna, changes: { name: "  Casa ", currency: "USD" } }));
    expect(unwrap(await get(asAna))).toEqual({
      id: "space-household",
      name: "Casa",
      kind: "SHARED",
      currency: "USD",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
      color: spaceColor("space-household", null),
    });
  });

  it("stores the color a manager picks and shows it from then on (ruling P306)", async () => {
    const { update, get } = setup();
    const before = unwrap(await get(asAna)).color;
    const next = before === "PLUM" ? "TEAL" : "PLUM";
    expect(unwrap(await update({ ...asAna, changes: { color: next } })).color).toBe(next);
    expect(unwrap(await get(asAna)).color).toBe(next);
    expect(unwrap(await update({ ...asAna, changes: { name: "Casa" } })).color).toBe(next);
  });

  it("refuses a color outside the palette, and a member who does not manage the space (ruling P306)", async () => {
    const { update, get } = setup();
    const before = unwrap(await get(asAna)).color;
    expect(codeOf(await update({ ...asAna, changes: { color: "PINK" } }))).toBe("InvalidSpaceColor");
    const asJuan = { spaceId: "space-household", userId: "u-juan" };
    expect(codeOf(await update({ ...asJuan, changes: { color: "PLUM" } }))).toBe("InsufficientRole");
    expect(unwrap(await get(asAna)).color).toBe(before);
  });

  it("rejects blank names and unknown currencies", async () => {
    const { update } = setup();
    expect(codeOf(await update({ ...asAna, changes: { name: "   " } }))).toBe("InvalidSpaceName");
    expect(codeOf(await update({ ...asAna, changes: { currency: "XYZ" } }))).toBe("UnknownCurrency");
  });

  it("hides spaces the user does not belong to", async () => {
    const { update, get } = setup();
    const asLuis = { spaceId: "space-household", userId: "u-luis" };
    expect(codeOf(await update({ ...asLuis, changes: { name: "Casa" } }))).toBe("SpaceNotFound");
    expect(codeOf(await get(asLuis))).toBe("SpaceNotFound");
  });
});

describe("ListSpacePeriods", () => {
  it("starts from today in the space time zone, even just after UTC midnight", async () => {
    const { periods } = setup({ now: "2026-11-01T04:30:00Z" });
    expect(unwrap(await periods({ ...asAna, count: 2 }))).toEqual([
      { start: "2026-10-01", end: "2026-10-31", label: "2026-10" },
      { start: "2026-11-01", end: "2026-11-30", label: "2026-11" },
    ]);
  });
});
