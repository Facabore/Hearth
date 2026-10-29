import { describe, expect, it } from "vitest";
import es from "./messages/es.json" with { type: "json" };

type Catalog = { [key: string]: string | Catalog };
const strings = (catalog: Catalog, prefix = ""): [string, string][] =>
  Object.entries(catalog).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : strings(value, `${prefix}${key}.`),
  );
const all = strings(es as Catalog);
const where = (pattern: RegExp) => all.filter(([, text]) => pattern.test(text)).map(([key]) => key);

/**
 * Decisions U1 and U2 (docs/design/batch2-ux-decisions.md, issue #210): the interface speaks the household's words. The
 * model keeps its own (`capacity`, `line`, `allocation`); the glossary maps one to the other.
 */
describe("the household vocabulary in Spanish (U1, U2)", () => {
  it("names a plan line a rubro and never a línea", () => {
    expect(where(/l[íi]nea/i)).toEqual([]);
    expect(es.budgeting.planner.lines).toBe("Rubros");
    expect(es.reports.view.lines).toBe("Rubros");
  });

  it("asks what each one puts in, never their capacity, and what is left to share out", () => {
    expect(where(/capacidad/i)).toEqual([]);
    expect(es.budgeting.capacity.title).toBe("Cuánto aporta cada uno");
    expect(es.budgeting.planner.unallocated).toBe("Por repartir {amount}");
    expect(es.budgeting.rule.PROPORTIONAL).toBe("Según aportes");
  });

  it("says where a line's money comes from and how it starts each period in plain words", () => {
    expect(es.budgeting.funding).toMatchObject({
      DIRECT: "Cada uno paga",
      SHARED_FUND: "Sale del fondo común",
      SAVINGS: "Va al ahorro",
    });
    expect(es.budgeting.rollover.RESET).toBe("Empieza de cero");
  });

  it("settles with one verb, Saldar, and its partial form Saldar otro monto", () => {
    expect(where(/liquidar|registrar pago/i)).toEqual([]);
    expect(es.balances.settle.action).toBe("Saldar");
    expect(es.balances.settle.title).toBe("Saldar");
    expect(es.balances.record).toBe("Saldar otro monto");
    expect(es.members.guest.settle).toBe("Saldar");
  });
});
