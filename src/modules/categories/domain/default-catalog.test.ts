import { describe, expect, it } from "vitest";
import { sequentialIds } from "../../../../tests/support/fakes";
import { catalogLanguage, DEFAULT_CATALOG, seedTree } from "./default-catalog";

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
    expect(catalogLanguage("fr")).toBe("es");
    expect(catalogLanguage("EN")).toBe("en");
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
