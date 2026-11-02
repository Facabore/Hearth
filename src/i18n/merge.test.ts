import { describe, expect, it } from "vitest";
import { mergeMessages } from "./merge";
import coreEn from "./messages/en.json" with { type: "json" };
import coreEs from "./messages/es.json" with { type: "json" };
import { en, es } from "./messages/full";
import planEs from "./messages/areas/plan.es.json" with { type: "json" };

type Catalog = { readonly [key: string]: string | Catalog };
const keys = (catalog: Catalog, prefix = ""): string[] =>
  Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );

describe("the catalog's core and areas as one (ruling P276)", () => {
  it("merges a namespace whose keys live in several files, and leaves each file as it was", () => {
    const core = { members: { you: "{name} (tú)" }, common: { save: "Guardar" } };
    const area = { members: { created: "Creó el espacio", roleSheet: { label: "Rol" } } };
    expect(mergeMessages(core, area)).toEqual({
      members: { you: "{name} (tú)", created: "Creó el espacio", roleSheet: { label: "Rol" } },
      common: { save: "Guardar" },
    });
    expect(core).toEqual({ members: { you: "{name} (tú)" }, common: { save: "Guardar" } });
    expect(area.members).not.toHaveProperty("you");
  });

  it("holds every key of the core and of each area in the whole catalog of each language", () => {
    const whole = keys(es as Catalog);
    for (const key of [...keys(coreEs as Catalog), ...keys(planEs as Catalog)]) expect(whole).toContain(key);
    expect(keys(en as Catalog).sort()).toEqual([...whole].sort());
    expect(keys(coreEn as Catalog).sort()).toEqual(keys(coreEs as Catalog).sort());
  });
});
