import { describe, expect, it } from "vitest";
import { Money, type LocalDate } from "@/shared/kernel";
import { existingTargetsOf, planCategoryGroups, unusedSeeded } from "./category-groups";
import type { HearthCategory, HearthCategoryGroup } from "./mapping-proposals";
import type { SourceCategory, SourceMovement } from "./source-snapshot";

const category = (
  over: Partial<SourceCategory> & Pick<SourceCategory, "sourceId" | "name">,
): SourceCategory => ({
  icon: null,
  kind: "EXPENSE",
  parentSourceId: null,
  deleted: false,
  order: 0,
  ...over,
});

const spentOn = (categorySourceId: string): SourceMovement => ({
  sourceKey: `m-${categorySourceId}`,
  kind: "EXPENSE",
  date: "2025-01-10" as LocalDate,
  occurredAt: null,
  accountSourceId: "a-bank",
  toAccountSourceId: null,
  categorySourceId,
  amount: (Money.ofMinor(1000n, "COP") as { value: Money }).value,
  originalAmount: null,
  toAmount: null,
  note: null,
});

const group = (over: Partial<HearthCategoryGroup> & Pick<HearthCategoryGroup, "id" | "name">) => ({
  key: null,
  archived: false,
  ...over,
});
const hearthCategory = (
  over: Partial<HearthCategory> & Pick<HearthCategory, "id" | "name" | "groupId">,
): HearthCategory => ({ parentCategoryId: null, key: null, archived: false, ...over });

const NO_LINKS = { groups: new Map<string, string>(), categories: new Map<string, string>() };
const EMPTY = { groups: [], categories: [] };

/** The plan as names: each group with its categories, and whether each is new or reused. */
const shape = (plan: ReturnType<typeof planCategoryGroups>) =>
  plan.map((g) => ({
    group: `${g.target.kind}:${g.name}`,
    categories: g.categories.map((c) => `${c.target.kind}:${c.name}`),
  }));

describe("planCategoryGroups (P337)", () => {
  const snapshot = {
    categories: [
      category({ sourceId: "c-salary", name: "Salary", kind: "INCOME", order: 0, icon: "💰" }),
      category({ sourceId: "c-transport", name: "Transport", order: 1 }),
      category({ sourceId: "c-food", name: "Food", order: 0, icon: "🍔" }),
      category({ sourceId: "c-dinner", name: "Dinner", parentSourceId: "c-food", order: 1 }),
      category({ sourceId: "c-lunch", name: "Lunch", parentSourceId: "c-food", order: 0 }),
      category({ sourceId: "c-bus", name: "Bus", parentSourceId: "c-transport", order: 0, icon: "🚌" }),
      category({ sourceId: "c-pets", name: "Pets", order: 2 }),
    ],
    movements: [spentOn("c-lunch")],
  };

  it("makes each top-level category a group of its subcategories, in Money Manager's order, expenses first", () => {
    expect(shape(planCategoryGroups(snapshot, EMPTY, NO_LINKS))).toEqual([
      { group: "new:Food", categories: ["new:Lunch", "new:Dinner"] },
      { group: "new:Transport", categories: ["new:Bus"] },
      { group: "new:Pets", categories: ["new:Pets"] },
      { group: "new:Salary", categories: ["new:Salary"] },
    ]);
  });

  it("gives a subcategory without an emoji its parent's, and a lone category its own", () => {
    const plan = planCategoryGroups(snapshot, EMPTY, NO_LINKS);
    const icons = Object.fromEntries(plan.flatMap((g) => g.categories).map((c) => [c.name, c.icon]));
    expect(icons).toMatchObject({ Lunch: "🍔", Bus: "🚌", Salary: "💰", Pets: null });
  });

  it("keeps a category of the group's own name when a movement uses the top-level category directly", () => {
    const plan = planCategoryGroups({ ...snapshot, movements: [spentOn("c-food")] }, EMPTY, NO_LINKS);
    expect(shape(plan)[0]).toEqual({
      group: "new:Food",
      categories: ["new:Food", "new:Lunch", "new:Dinner"],
    });
  });

  it("reuses a group of the same name ignoring case, archived ones too, and a category of the same name in it", () => {
    const hearth = {
      groups: [group({ id: "g-food", name: "FOOD" }), group({ id: "g-pets", name: "pets", archived: true })],
      categories: [hearthCategory({ id: "h-lunch", name: "lunch", groupId: "g-food" })],
    };
    const plan = planCategoryGroups(snapshot, hearth, NO_LINKS);
    expect(plan[0]!.target).toEqual({ kind: "existing", groupId: "g-food", archived: false });
    expect(plan[0]!.categories[0]!.target).toEqual({
      kind: "existing",
      categoryId: "h-lunch",
      archived: false,
    });
    expect(plan[0]!.categories[1]!.target).toEqual({ kind: "new", name: "Dinner" });
    expect(plan[2]!.target).toEqual({ kind: "existing", groupId: "g-pets", archived: true });
  });

  it("names what the plan lands on that Hearth holds, so Archivar never takes it", () => {
    const hearth = {
      groups: [group({ id: "g-food", name: "FOOD" })],
      categories: [hearthCategory({ id: "h-lunch", name: "lunch", groupId: "g-food" })],
    };
    expect(existingTargetsOf(planCategoryGroups(snapshot, hearth, NO_LINKS))).toEqual({
      groups: new Set(["g-food"]),
      categories: new Set(["h-lunch"]),
    });
  });

  it("goes to what an earlier import linked, before any name", () => {
    const hearth = {
      groups: [group({ id: "g-renamed", name: "Comida" })],
      categories: [hearthCategory({ id: "h-renamed", name: "Almuerzo", groupId: "g-renamed" })],
    };
    const links = {
      groups: new Map([["c-food", "g-renamed"]]),
      categories: new Map([["c-lunch", "h-renamed"]]),
    };
    const food = planCategoryGroups(snapshot, hearth, links)[0]!;
    expect(food.target).toMatchObject({ kind: "existing", groupId: "g-renamed" });
    expect(food.categories[0]!.target).toMatchObject({ kind: "existing", categoryId: "h-renamed" });
  });

  it("puts two top-level categories of one name (income and expense) in one group and one category", () => {
    const plan = planCategoryGroups(
      {
        categories: [
          category({ sourceId: "c-other-out", name: "Other", order: 0 }),
          category({ sourceId: "c-other-in", name: "other", kind: "INCOME", order: 0 }),
        ],
        movements: [],
      },
      EMPTY,
      NO_LINKS,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]!.sourceIds).toEqual(["c-other-out", "c-other-in"]);
    expect(plan[0]!.categories.map((c) => [c.sourceId, c.target])).toEqual([
      ["c-other-out", { kind: "new", name: "Other" }],
      ["c-other-in", { kind: "new", name: "Other" }],
    ]);
  });
});

describe("unusedSeeded (P337, Archivar las de Hearth que no uses)", () => {
  const hearth = {
    groups: [
      group({ id: "g-home", name: "Vivienda", key: "home" }),
      group({ id: "g-food", name: "Alimentación", key: "food" }),
      group({ id: "g-mine", name: "Mío" }),
      group({ id: "g-old", name: "Viejo", key: "old", archived: true }),
    ],
    categories: [
      hearthCategory({ id: "rent", name: "Arriendo", groupId: "g-home", key: "rent" }),
      hearthCategory({ id: "groceries", name: "Mercado", groupId: "g-food", key: "groceries" }),
      hearthCategory({ id: "snacks", name: "Mecato", groupId: "g-food", key: "snacks" }),
      hearthCategory({ id: "fruit", name: "Fruta", groupId: "g-food", parentCategoryId: "snacks" }),
      hearthCategory({ id: "eat-out", name: "Restaurantes", groupId: "g-food", key: "eat_out" }),
      hearthCategory({ id: "own", name: "Propia", groupId: "g-food" }),
      hearthCategory({ id: "mine", name: "Mía", groupId: "g-mine" }),
    ],
  };

  it("archives whole seeded groups nothing uses, and the unused seeded categories of the groups that stay", () => {
    const result = unusedSeeded(hearth, new Set(["groceries", "fruit"]), {
      groups: new Set(),
      categories: new Set(),
    });
    // Vivienda goes whole; in Alimentación, only Restaurantes: Mecato's subcategory is used, Propia is not seeded.
    expect(result).toEqual({ groups: ["g-home"], categories: ["eat-out"] });
  });

  it("never archives what the import lands on", () => {
    const result = unusedSeeded(hearth, new Set(), {
      groups: new Set(["g-home"]),
      categories: new Set(["eat-out"]),
    });
    expect(result).toEqual({ groups: [], categories: ["rent", "groceries", "snacks"] });
  });
});
