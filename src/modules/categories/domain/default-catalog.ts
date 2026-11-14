import type { IdGenerator } from "@/shared/kernel";
import { catalogLanguage } from "@/shared/kernel/catalog-language";
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

/**
 * HU-E3-01 default tree, grown by ruling P330 from 6 groups to 13. Keys are stable across spaces and renames (spec D11)
 * and never reused; names become user data. Migration 0032 gives existing spaces what this list added, and its test
 * checks that its lists repeat this one.
 */
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
      { key: "home_goods", names: { es: "Hogar y muebles", en: "Home and furniture" }, icon: "sofa" },
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
      { key: "delivery", names: { es: "Domicilios", en: "Delivery" }, icon: "bag" },
      { key: "snacks", names: { es: "Café y snacks", en: "Coffee and snacks" }, icon: "cup" },
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
      { key: "ride_hailing", names: { es: "Taxi y apps", en: "Taxis and ride apps" }, icon: "car" },
      { key: "parking", names: { es: "Parqueadero y peajes", en: "Parking and tolls" }, icon: "parking" },
      {
        key: "vehicle_maintenance",
        names: { es: "Mantenimiento del vehículo", en: "Vehicle maintenance" },
        icon: "wrench",
      },
    ],
  },
  {
    key: "subscriptions",
    names: { es: "Suscripciones", en: "Subscriptions" },
    icon: "tv",
    color: "TEAL",
    categories: [
      { key: "streaming", names: { es: "Streaming", en: "Streaming" }, icon: "tv" },
      { key: "music", names: { es: "Música", en: "Music" }, icon: "music" },
      { key: "software", names: { es: "Apps y software", en: "Apps and software" }, icon: "laptop" },
      { key: "mobile_plan", names: { es: "Plan de celular", en: "Phone plan" }, icon: "phone" },
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
      { key: "fitness", names: { es: "Gimnasio y deporte", en: "Gym and sports" }, icon: "gym" },
      { key: "dental", names: { es: "Odontología", en: "Dental care" }, icon: "tooth" },
    ],
  },
  {
    key: "personal_care",
    names: { es: "Cuidado personal", en: "Personal care" },
    icon: "scissors",
    color: "CORAL",
    categories: [
      { key: "beauty", names: { es: "Peluquería y belleza", en: "Hair and beauty" }, icon: "scissors" },
      { key: "clothing", names: { es: "Ropa y calzado", en: "Clothes and shoes" }, icon: "shirt" },
    ],
  },
  {
    key: "education",
    names: { es: "Educación", en: "Education" },
    icon: "graduation",
    color: "SKY",
    categories: [
      { key: "tuition", names: { es: "Cursos y matrículas", en: "Courses and tuition" }, icon: "graduation" },
      { key: "books", names: { es: "Libros y útiles", en: "Books and supplies" }, icon: "book" },
    ],
  },
  {
    key: "pets",
    names: { es: "Mascotas", en: "Pets" },
    icon: "paw",
    color: "AMBER",
    categories: [
      { key: "pet_care", names: { es: "Comida y cuidado", en: "Food and care" }, icon: "paw" },
      { key: "vet", names: { es: "Veterinario", en: "Vet" }, icon: "cross" },
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
      { key: "going_out", names: { es: "Salidas y bares", en: "Going out" }, icon: "wine" },
      { key: "games", names: { es: "Juegos", en: "Games" }, icon: "game" },
    ],
  },
  {
    key: "gifts",
    names: { es: "Regalos y donaciones", en: "Gifts and donations" },
    icon: "gift",
    color: "LAVENDER",
    categories: [
      { key: "gifts_given", names: { es: "Regalos", en: "Gifts" }, icon: "gift" },
      { key: "donations", names: { es: "Donaciones", en: "Donations" }, icon: "heart" },
    ],
  },
  {
    key: "finance",
    names: { es: "Finanzas", en: "Finance" },
    icon: "bank",
    color: "GRAPHITE",
    categories: [
      { key: "bank_fees", names: { es: "Comisiones bancarias", en: "Bank fees" }, icon: "bank" },
      { key: "interest", names: { es: "Intereses", en: "Interest" }, icon: "percent" },
      { key: "insurance", names: { es: "Seguros", en: "Insurance" }, icon: "shield" },
      { key: "taxes", names: { es: "Impuestos", en: "Taxes" }, icon: "receipt" },
    ],
  },
  {
    key: "other",
    names: { es: "Otros", en: "Other" },
    icon: "dots",
    color: "OLIVE",
    categories: [
      { key: "unexpected", names: { es: "Imprevistos", en: "Unexpected expenses" }, icon: "umbrella" },
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
      { key: "freelance", names: { es: "Freelance", en: "Freelance" }, icon: "laptop" },
      { key: "investment_income", names: { es: "Rendimientos", en: "Investment returns" }, icon: "chart" },
    ],
  },
];

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
  for (const [position, entry] of DEFAULT_CATALOG.entries()) {
    const group: CategoryGroup = {
      id: input.ids.next<"CategoryGroup">(),
      spaceId: input.spaceId,
      name: entry.names[language],
      key: entry.key,
      style: { icon: { kind: "SYMBOL", name: entry.icon }, color: entry.color },
      // Rulings P296, P330: the catalog's order (Vivienda, Alimentación, Transporte, Suscripciones, …, Ingresos).
      position,
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
