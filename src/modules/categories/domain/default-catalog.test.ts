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
    expect(namesIn(t, "Vivienda")).toEqual(["Arriendo", "Servicios", "Mantenimiento", "Hogar y muebles"]);
    expect(namesIn(t, "Ingresos")).toEqual(["Salario", "Otros ingresos", "Freelance", "Rendimientos"]);
  });

  it("seeds English names for English locales", () => {
    expect(namesIn(tree("en-US"), "Housing")).toEqual([
      "Rent",
      "Utilities",
      "Maintenance",
      "Home and furniture",
    ]);
  });

  it("falls back to Spanish for other locales", () => {
    expect(namesIn(tree("fr"), "Housing")).toEqual(namesIn(tree("es-CO"), "Housing"));
  });

  it("gives every seeded category a unique, stable catalog key", () => {
    const t = tree("es");
    const keys = t.categories.map((c) => c.key);
    expect(t.groups).toHaveLength(DEFAULT_CATALOG.length);
    expect(t.categories).toHaveLength(42);
    expect(new Set(keys).size).toBe(keys.length);
    expect(t.categories.find((c) => c.key === "groceries")?.name).toBe("Mercado");
    expect(tree("en").categories.find((c) => c.key === "groceries")?.name).toBe("Groceries");
  });

  it("puts every seeded row in the given space, unarchived", () => {
    const t = tree("es");
    expect([...t.groups, ...t.categories].every((row) => row.spaceId === "space-ana")).toBe(true);
    expect([...t.groups, ...t.categories].every((row) => row.archivedAt === null)).toBe(true);
  });

  it("gives every seeded category the color of its group (HU-E3-05)", () => {
    const t = tree("es");
    const groupColor = (groupId: string) => t.groups.find((g) => g.id === groupId)?.style.color;
    expect(t.categories.every((c) => c.style?.color === groupColor(c.groupId))).toBe(true);
  });
});

type Entry = [key: string, es: string, en: string, icon: string];
type GroupEntry = [key: string, es: string, en: string, icon: string, color: string, categories: Entry[]];

/** Ruling P330: the whole catalog, in its order. */
const P330: GroupEntry[] = [
  [
    "housing",
    "Vivienda",
    "Housing",
    "home",
    "INDIGO",
    [
      ["rent", "Arriendo", "Rent", "key"],
      ["utilities", "Servicios", "Utilities", "bulb"],
      ["maintenance", "Mantenimiento", "Maintenance", "wrench"],
      ["home_goods", "Hogar y muebles", "Home and furniture", "sofa"],
    ],
  ],
  [
    "food",
    "Alimentación",
    "Food",
    "apple",
    "SAND",
    [
      ["groceries", "Mercado", "Groceries", "cart"],
      ["restaurants", "Restaurantes", "Restaurants", "fork"],
      ["delivery", "Domicilios", "Delivery", "bag"],
      ["snacks", "Café y snacks", "Coffee and snacks", "cup"],
    ],
  ],
  [
    "transport",
    "Transporte",
    "Transport",
    "car",
    "STEEL",
    [
      ["fuel", "Combustible", "Fuel", "fuel"],
      ["public_transport", "Transporte público", "Public transport", "bus"],
      ["ride_hailing", "Taxi y apps", "Taxis and ride apps", "car"],
      ["parking", "Parqueadero y peajes", "Parking and tolls", "parking"],
      ["vehicle_maintenance", "Mantenimiento del vehículo", "Vehicle maintenance", "wrench"],
    ],
  ],
  [
    "subscriptions",
    "Suscripciones",
    "Subscriptions",
    "tv",
    "TEAL",
    [
      ["streaming", "Streaming", "Streaming", "tv"],
      ["music", "Música", "Music", "music"],
      ["software", "Apps y software", "Apps and software", "laptop"],
      ["mobile_plan", "Plan de celular", "Phone plan", "phone"],
    ],
  ],
  [
    "health",
    "Salud",
    "Health",
    "heart",
    "ROSE",
    [
      ["medical", "Médico", "Medical", "cross"],
      ["pharmacy", "Farmacia", "Pharmacy", "pill"],
      ["fitness", "Gimnasio y deporte", "Gym and sports", "gym"],
      ["dental", "Odontología", "Dental care", "tooth"],
    ],
  ],
  [
    "personal_care",
    "Cuidado personal",
    "Personal care",
    "scissors",
    "CORAL",
    [
      ["beauty", "Peluquería y belleza", "Hair and beauty", "scissors"],
      ["clothing", "Ropa y calzado", "Clothes and shoes", "shirt"],
    ],
  ],
  [
    "education",
    "Educación",
    "Education",
    "graduation",
    "SKY",
    [
      ["tuition", "Cursos y matrículas", "Courses and tuition", "graduation"],
      ["books", "Libros y útiles", "Books and supplies", "book"],
    ],
  ],
  [
    "pets",
    "Mascotas",
    "Pets",
    "paw",
    "AMBER",
    [
      ["pet_care", "Comida y cuidado", "Food and care", "paw"],
      ["vet", "Veterinario", "Vet", "cross"],
    ],
  ],
  [
    "leisure",
    "Ocio",
    "Leisure",
    "ticket",
    "PLUM",
    [
      ["entertainment", "Entretenimiento", "Entertainment", "tv"],
      ["travel", "Viajes", "Travel", "plane"],
      ["going_out", "Salidas y bares", "Going out", "wine"],
      ["games", "Juegos", "Games", "game"],
    ],
  ],
  [
    "gifts",
    "Regalos y donaciones",
    "Gifts and donations",
    "gift",
    "LAVENDER",
    [
      ["gifts_given", "Regalos", "Gifts", "gift"],
      ["donations", "Donaciones", "Donations", "heart"],
    ],
  ],
  [
    "finance",
    "Finanzas",
    "Finance",
    "bank",
    "GRAPHITE",
    [
      ["bank_fees", "Comisiones bancarias", "Bank fees", "bank"],
      ["interest", "Intereses", "Interest", "percent"],
      ["insurance", "Seguros", "Insurance", "shield"],
      ["taxes", "Impuestos", "Taxes", "receipt"],
    ],
  ],
  [
    "other",
    "Otros",
    "Other",
    "dots",
    "OLIVE",
    [["unexpected", "Imprevistos", "Unexpected expenses", "umbrella"]],
  ],
  [
    "income",
    "Ingresos",
    "Income",
    "coins",
    "PINE",
    [
      ["salary", "Salario", "Salary", "briefcase"],
      ["other_income", "Otros ingresos", "Other income", "gift"],
      ["freelance", "Freelance", "Freelance", "laptop"],
      ["investment_income", "Rendimientos", "Investment returns", "chart"],
    ],
  ],
];

/** HU-E3-01 and HU-E3-05 as they shipped before P330. */
const BEFORE_P330: GroupEntry[] = [
  [
    "housing",
    "Vivienda",
    "Housing",
    "home",
    "INDIGO",
    [
      ["rent", "Arriendo", "Rent", "key"],
      ["utilities", "Servicios", "Utilities", "bulb"],
      ["maintenance", "Mantenimiento", "Maintenance", "wrench"],
    ],
  ],
  [
    "food",
    "Alimentación",
    "Food",
    "apple",
    "SAND",
    [
      ["groceries", "Mercado", "Groceries", "cart"],
      ["restaurants", "Restaurantes", "Restaurants", "fork"],
    ],
  ],
  [
    "transport",
    "Transporte",
    "Transport",
    "car",
    "STEEL",
    [
      ["fuel", "Combustible", "Fuel", "fuel"],
      ["public_transport", "Transporte público", "Public transport", "bus"],
    ],
  ],
  [
    "health",
    "Salud",
    "Health",
    "heart",
    "ROSE",
    [
      ["medical", "Médico", "Medical", "cross"],
      ["pharmacy", "Farmacia", "Pharmacy", "pill"],
    ],
  ],
  [
    "leisure",
    "Ocio",
    "Leisure",
    "ticket",
    "PLUM",
    [
      ["entertainment", "Entretenimiento", "Entertainment", "tv"],
      ["travel", "Viajes", "Travel", "plane"],
    ],
  ],
  [
    "income",
    "Ingresos",
    "Income",
    "coins",
    "PINE",
    [
      ["salary", "Salario", "Salary", "briefcase"],
      ["other_income", "Otros ingresos", "Other income", "gift"],
    ],
  ],
];

const iconName = (style: CategoryStyle | null): string | null => {
  if (style === null) return null;
  return style.icon.kind === "SYMBOL" ? style.icon.name : style.icon.value;
};

/** A seeded tree as [group key, name, icon, color, [category key, name, icon, color][]]. */
const shapeOf = (t: ReturnType<typeof tree>) =>
  t.groups.map((g) => [
    g.key,
    g.name,
    iconName(g.style),
    g.style.color,
    t.categories
      .filter((c) => c.groupId === g.id)
      .map((c) => [c.key, c.name, iconName(c.style), c.style?.color]),
  ]);
const expectedIn = (language: "es" | "en") =>
  P330.map(([key, es, en, icon, color, categories]) => [
    key,
    language === "es" ? es : en,
    icon,
    color,
    categories.map(([k, kes, ken, kicon]) => [k, language === "es" ? kes : ken, kicon, color]),
  ]);

describe("a fuller default catalog (P330)", () => {
  it("seeds P330's thirteen groups and their categories in order, with keys, icons and colors, in Spanish", () => {
    expect(shapeOf(tree("es"))).toEqual(expectedIn("es"));
  });

  it("seeds the same tree in English for an English locale", () => {
    expect(shapeOf(tree("en-US"))).toEqual(expectedIn("en"));
  });

  it("numbers the groups in the catalog's order, Vivienda first and Ingresos last (P296)", () => {
    expect(tree("es").groups.map((g) => [g.name, g.position])).toEqual(
      P330.map(([, es], position) => [es, position]),
    );
  });

  it("gives each seeded group its catalog key, the same in every language (HU-E3-05, HU-E7-06)", () => {
    const keys = P330.map(([key]) => key);
    expect(DEFAULT_CATALOG.map((entry) => entry.key)).toEqual(keys);
    expect(tree("es").groups.map((g) => g.key)).toEqual(keys);
    expect(tree("en").groups.map((g) => g.key)).toEqual(keys);
  });

  it("keeps every key unique across groups and categories, and every name unique among its siblings", () => {
    const keys = DEFAULT_CATALOG.flatMap((g) => [g.key, ...g.categories.map((c) => c.key)]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const language of ["es", "en"] as const) {
      const groups = DEFAULT_CATALOG.map((g) => g.names[language].toLowerCase());
      expect(new Set(groups).size).toBe(groups.length);
      for (const group of DEFAULT_CATALOG) {
        const names = group.categories.map((c) => c.names[language].toLowerCase());
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it("gives each group a color no other group of the catalog has", () => {
    const colors = DEFAULT_CATALOG.map((g) => g.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("keeps HU-E3-01's keys, names, icons and colors as they were (spec D11: never renamed)", () => {
    for (const [key, es, en, icon, color, categories] of BEFORE_P330) {
      const group = DEFAULT_CATALOG.find((g) => g.key === key);
      expect(group).toMatchObject({ names: { es, en }, icon, color });
      for (const [k, kes, ken, kicon] of categories) {
        expect(group?.categories.find((c) => c.key === k)).toEqual({
          key: k,
          names: { es: kes, en: ken },
          icon: kicon,
        });
      }
    }
  });
});
