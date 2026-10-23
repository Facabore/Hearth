import { describe, expect, it } from "vitest";
import { sequentialIds } from "../../../../tests/support/fakes";
import { DEFAULT_CATALOG, seedTree } from "./default-catalog";
import type { CategoryStyle } from "./category-style";

const tree = (locale: string) =>
  seedTree({ spaceId: "space-ana", locale, now: new Date("2026-10-12T12:00:00Z"), ids: sequentialIds() });
const namesIn = (t: ReturnType<typeof tree>, groupName: string) => {
  const group = t.groups.find((g) => g.name === groupName);
  return t.categories.filter((c) => c.groupId === group?.id).map((c) => c.name);
};

describe("default category catalog (HU-E3-01)", () => {
  it("seeds the Spanish tree for locale es", () => {
    const t = tree("es");
    expect(namesIn(t, "Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
    expect(namesIn(t, "Ingresos")).toEqual(["Salario", "Otros ingresos"]);
  });

  it("seeds English names for English locales", () => {
    expect(namesIn(tree("en-US"), "Housing")).toEqual(["Rent", "Utilities", "Maintenance"]);
  });

  it("falls back to Spanish for other locales", () => {
    expect(namesIn(tree("fr"), "Housing")).toEqual(namesIn(tree("es-CO"), "Housing"));
  });

  it("gives every seeded category a unique, stable catalog key", () => {
    const t = tree("es");
    const keys = t.categories.map((c) => c.key);
    expect(t.groups).toHaveLength(DEFAULT_CATALOG.length);
    expect(t.categories).toHaveLength(13);
    expect(new Set(keys).size).toBe(keys.length);
    expect(t.categories.find((c) => c.key === "groceries")?.name).toBe("Mercado");
    expect(tree("en").categories.find((c) => c.key === "groceries")?.name).toBe("Groceries");
  });

  it("puts every seeded row in the given space, unarchived", () => {
    const t = tree("es");
    expect([...t.groups, ...t.categories].every((row) => row.spaceId === "space-ana")).toBe(true);
    expect([...t.groups, ...t.categories].every((row) => row.archivedAt === null)).toBe(true);
  });
});

describe("default styles (HU-E3-05)", () => {
  const iconName = (style: CategoryStyle | null): string | null => {
    if (style === null) return null;
    return style.icon.kind === "SYMBOL" ? style.icon.name : style.icon.value;
  };

  it("seeds a symbol and a palette color for every group, and a symbol for every category by catalog key", () => {
    const t = tree("en");
    expect(t.groups.map((g) => [g.name, iconName(g.style), g.style.color])).toEqual([
      ["Housing", "home", "INDIGO"],
      ["Food", "apple", "SAND"],
      ["Transport", "car", "STEEL"],
      ["Health", "heart", "ROSE"],
      ["Leisure", "ticket", "PLUM"],
      ["Income", "coins", "PINE"],
    ]);
    expect(t.categories.map((c) => [c.key, iconName(c.style)])).toEqual([
      ["rent", "key"],
      ["utilities", "bulb"],
      ["maintenance", "wrench"],
      ["groceries", "cart"],
      ["restaurants", "fork"],
      ["fuel", "fuel"],
      ["public_transport", "bus"],
      ["medical", "cross"],
      ["pharmacy", "pill"],
      ["entertainment", "tv"],
      ["travel", "plane"],
      ["salary", "briefcase"],
      ["other_income", "gift"],
    ]);
  });

  it("gives every seeded category the color of its group", () => {
    const t = tree("es");
    const groupColor = (groupId: string) => t.groups.find((g) => g.id === groupId)?.style.color;
    expect(t.categories.every((c) => c.style?.color === groupColor(c.groupId))).toBe(true);
  });
});

describe("group catalog keys (HU-E3-05, HU-E7-06)", () => {
  const KEYS = ["housing", "food", "transport", "health", "leisure", "income"];

  it("gives each seeded group its catalog key, the same in every language", () => {
    expect(DEFAULT_CATALOG.map((entry) => entry.key)).toEqual(KEYS);
    expect(tree("es").groups.map((g) => g.key)).toEqual(KEYS);
    expect(tree("en").groups.map((g) => g.key)).toEqual(KEYS);
  });
});
