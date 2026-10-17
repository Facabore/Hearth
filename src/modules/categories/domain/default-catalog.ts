import type { IdGenerator } from "@/shared/kernel";
import type { Category, CategoryGroup } from "./category";
import type { CategoryColor, CategorySymbol } from "./category-style";

interface Names {
  readonly es: string;
  readonly en: string;
}

interface CatalogGroup {
  /** HU-E3-05: the group's catalog key, stable across spaces, languages and renames (spec D11, like a category's). */
  readonly key: string;
  readonly names: Names;
  /** HU-E3-05: the group's default style; its categories take its color. */
  readonly icon: CategorySymbol;
  readonly color: CategoryColor;
  readonly categories: readonly {
    readonly key: string;
    readonly names: Names;
    readonly icon: CategorySymbol;
  }[];
}

/** HU-E3-01 default tree. Keys are stable across spaces and renames (spec D11); names become user data. */
export const DEFAULT_CATALOG: readonly CatalogGroup[] = [
  {
    key: "housing",
    names: { es: "Vivienda", en: "Housing" },
    icon: "home",
    color: "INDIGO",
    categories: [
      { key: "rent", names: { es: "Arriendo", en: "Rent" }, icon: "key" },
      { key: "utilities", names: { es: "Servicios", en: "Utilities" }, icon: "bulb" },
      { key: "maintenance", names: { es: "Mantenimiento", en: "Maintenance" }, icon: "wrench" },
    ],
  },
  {
    key: "food",
    names: { es: "Alimentación", en: "Food" },
    icon: "apple",
    color: "SAND",
    categories: [
      { key: "groceries", names: { es: "Mercado", en: "Groceries" }, icon: "cart" },
      { key: "restaurants", names: { es: "Restaurantes", en: "Restaurants" }, icon: "fork" },
    ],
  },
  {
    key: "transport",
    names: { es: "Transporte", en: "Transport" },
    icon: "car",
    color: "STEEL",
    categories: [
      { key: "fuel", names: { es: "Combustible", en: "Fuel" }, icon: "fuel" },
      { key: "public_transport", names: { es: "Transporte público", en: "Public transport" }, icon: "bus" },
    ],
  },
  {
    key: "health",
    names: { es: "Salud", en: "Health" },
    icon: "heart",
    color: "ROSE",
    categories: [
      { key: "medical", names: { es: "Médico", en: "Medical" }, icon: "cross" },
      { key: "pharmacy", names: { es: "Farmacia", en: "Pharmacy" }, icon: "pill" },
    ],
  },
  {
    key: "leisure",
    names: { es: "Ocio", en: "Leisure" },
    icon: "ticket",
    color: "PLUM",
    categories: [
      { key: "entertainment", names: { es: "Entretenimiento", en: "Entertainment" }, icon: "tv" },
      { key: "travel", names: { es: "Viajes", en: "Travel" }, icon: "plane" },
    ],
  },
  {
    key: "income",
    names: { es: "Ingresos", en: "Income" },
    icon: "coins",
    color: "PINE",
    categories: [
      { key: "salary", names: { es: "Salario", en: "Salary" }, icon: "briefcase" },
      { key: "other_income", names: { es: "Otros ingresos", en: "Other income" }, icon: "gift" },
    ],
  },
];

/** English for "en…" locales; Spanish otherwise (primary locale es-CO). */
export const catalogLanguage = (locale: string): keyof Names =>
  locale.toLowerCase().startsWith("en") ? "en" : "es";

/** The default tree for one space, named in the creator's language, keyed and styled by catalog key (HU-E3-05). */
export const seedTree = (input: {
  spaceId: string;
  locale: string;
  now: Date;
  ids: IdGenerator;
}): { groups: CategoryGroup[]; categories: Category[] } => {
  const language = catalogLanguage(input.locale);
  const groups: CategoryGroup[] = [];
  const categories: Category[] = [];
  for (const entry of DEFAULT_CATALOG) {
    const group: CategoryGroup = {
      id: input.ids.next<"CategoryGroup">(),
      spaceId: input.spaceId,
      name: entry.names[language],
      key: entry.key,
      style: { icon: { kind: "SYMBOL", name: entry.icon }, color: entry.color },
      archivedAt: null,
      createdAt: input.now,
    };
    groups.push(group);
    for (const item of entry.categories) {
      categories.push({
        id: input.ids.next<"Category">(),
        spaceId: input.spaceId,
        groupId: group.id,
        // HU-E3-04: the seed has no subcategories.
        parentCategoryId: null,
        name: item.names[language],
        key: item.key,
        // HU-E3-05: a seeded category takes its group's color.
        style: { icon: { kind: "SYMBOL", name: item.icon }, color: entry.color },
        archivedAt: null,
        createdAt: input.now,
      });
    }
  }
  return { groups, categories };
};
