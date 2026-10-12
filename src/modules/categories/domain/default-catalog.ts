import type { IdGenerator } from "@/shared/kernel";
import type { Category, CategoryGroup } from "./category";

interface Names {
  readonly es: string;
  readonly en: string;
}

interface CatalogGroup {
  readonly names: Names;
  readonly categories: readonly { readonly key: string; readonly names: Names }[];
}

/** HU-E3-01 default tree. Keys are stable across spaces and renames (spec D11); names become user data. */
export const DEFAULT_CATALOG: readonly CatalogGroup[] = [
  {
    names: { es: "Vivienda", en: "Housing" },
    categories: [
      { key: "rent", names: { es: "Arriendo", en: "Rent" } },
      { key: "utilities", names: { es: "Servicios", en: "Utilities" } },
      { key: "maintenance", names: { es: "Mantenimiento", en: "Maintenance" } },
    ],
  },
  {
    names: { es: "Alimentación", en: "Food" },
    categories: [
      { key: "groceries", names: { es: "Mercado", en: "Groceries" } },
      { key: "restaurants", names: { es: "Restaurantes", en: "Restaurants" } },
    ],
  },
  {
    names: { es: "Transporte", en: "Transport" },
    categories: [
      { key: "fuel", names: { es: "Combustible", en: "Fuel" } },
      { key: "public_transport", names: { es: "Transporte público", en: "Public transport" } },
    ],
  },
  {
    names: { es: "Salud", en: "Health" },
    categories: [
      { key: "medical", names: { es: "Médico", en: "Medical" } },
      { key: "pharmacy", names: { es: "Farmacia", en: "Pharmacy" } },
    ],
  },
  {
    names: { es: "Ocio", en: "Leisure" },
    categories: [
      { key: "entertainment", names: { es: "Entretenimiento", en: "Entertainment" } },
      { key: "travel", names: { es: "Viajes", en: "Travel" } },
    ],
  },
  {
    names: { es: "Ingresos", en: "Income" },
    categories: [
      { key: "salary", names: { es: "Salario", en: "Salary" } },
      { key: "other_income", names: { es: "Otros ingresos", en: "Other income" } },
    ],
  },
];

/** English for "en…" locales; Spanish otherwise (primary locale es-CO). */
export const catalogLanguage = (locale: string): keyof Names =>
  locale.toLowerCase().startsWith("en") ? "en" : "es";

/** The default tree for one space, named in the creator's language. */
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
      archivedAt: null,
      createdAt: input.now,
    };
    groups.push(group);
    for (const item of entry.categories) {
      categories.push({
        id: input.ids.next<"Category">(),
        spaceId: input.spaceId,
        groupId: group.id,
        name: item.names[language],
        key: item.key,
        archivedAt: null,
        createdAt: input.now,
      });
    }
  }
  return { groups, categories };
};
