import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e7Matrix, HOUSEHOLD_MEMBERS, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { MemberMatrixDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { UI_ICONS } from "@/shared/ui/icons/ui-icons";
import { MemberMatrix } from "./member-matrix";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

type Matrix = MemberMatrixDto;
type Line = Matrix["lines"][number];
type Total = NonNullable<Matrix["members"]>[number];

/** `e7Matrix()` with the totals the API answers for it: Ana +312,000 and Juan −482,000 COP over Home (P262). */
const withTotals = (matrix: Matrix = e7Matrix()): Matrix => ({
  ...matrix,
  members: [
    { memberId: "m-ana", gap: cop(312_000), status: "OVER_CONTRIBUTED" },
    { memberId: "m-juan", gap: cop(-482_000), status: "UNDER_CONTRIBUTED" },
  ],
});
/** One line of the matrix replaced, so a test changes only what it is about. */
const withLine = (line: Partial<Line>, at = 1): Matrix => {
  const matrix = withTotals();
  matrix.lines[at] = { ...matrix.lines[at]!, ...line };
  return matrix;
};
const withTotal = (total: Total, matrix: Matrix = withTotals()): Matrix => ({
  ...matrix,
  members: matrix.members!.map((m) => (m.memberId === total.memberId ? total : m)),
});

const show = (matrix: Matrix = withTotals(), locale: "es" | "en" = "es") =>
  renderWithIntl(
    <MemberMatrix
      space={householdDto()}
      matrix={matrix}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
    />,
    { locale },
  );
const memberSection = (name: string) => screen.getByRole("region", { name });
const totalOf = (name: string) => normalized(memberSection(name).querySelector("h2 + p")!.textContent).trim();
const open = (member: string, label = "Ver detalle por rubro de") =>
  fireEvent.click(screen.getByRole("button", { name: `${label} ${member}` }));
/** The figures of `line` in `member`'s detail, opened first. */
const cellsOf = (member: string, line: string, caption = `${member} por rubro`) =>
  within(
    within(screen.getByRole("table", { name: caption })).getByRole("row", { name: new RegExp(`^${line}`) }),
  )
    .getAllByRole("cell")
    .map((c) => normalized(c.textContent).trim());

describe("one row per member first (#213, ruling P262)", () => {
  it("shows each member's total gap in words, and no per-line figure until it is opened", async () => {
    const { container } = show();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Ana", "Juan"]);
    expect(totalOf("Ana")).toBe("Le sobran $ 312.000");
    expect(totalOf("Juan")).toBe("Le faltan $ 482.000");
    expect(screen.queryByRole("table")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("opens a member's per-line detail under their row on tap, and closes it again", async () => {
    const { container } = show();
    const button = screen.getByRole("button", { name: "Ver detalle por rubro de Juan" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    open("Juan");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Ocultar detalle de Juan");
    expect(memberSection("Juan")).toContainElement(screen.getByRole("table", { name: "Juan por rubro" }));
    expect(cellsOf("Juan", "Home")).toEqual(["$ 882.000", "$ 400.000", "$ 780.000", "−$ 482.000 de menos"]);
    // Ana's stays closed.
    expect(screen.queryByRole("table", { name: "Ana por rubro" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(button);
    expect(screen.queryByRole("table", { name: "Juan por rubro" })).toBeNull();
  });

  it("writes the total the API answers, never a sum of the lines (ruling P201)", () => {
    show(withTotal({ memberId: "m-ana", gap: cop(7), status: "OVER_CONTRIBUTED" }));
    expect(totalOf("Ana")).toBe("Le sobran $ 7");
  });

  it("says a member is on target in words, without an arrow", () => {
    show(withTotal({ memberId: "m-ana", gap: cop(0), status: "ON_TARGET" }));
    expect(totalOf("Ana")).toBe("Al día");
    expect(memberSection("Ana").querySelector("h2 + p svg")).toBeNull();
  });

  it("gives the direction in words and an arrow, never by color alone", () => {
    show();
    const ana = memberSection("Ana").querySelector("h2 + p")!;
    const juan = memberSection("Juan").querySelector("h2 + p")!;
    expect(ana.querySelector("svg[aria-hidden='true'] path")).toHaveAttribute("d", UI_ICONS.arrowUp);
    expect(juan.querySelector("svg[aria-hidden='true'] path")).toHaveAttribute("d", UI_ICONS.arrowDown);
    expect(juan).toHaveClass("text-owe-ink");
    expect(juan).toHaveTextContent("Le faltan");
  });

  it("says when no line gives a member a gap, and when the API sends no totals", () => {
    show(withTotal({ memberId: "m-ana", gap: null, status: null }));
    expect(totalOf("Ana")).toBe("Sin diferencia que comparar");
    expect(totalOf("Juan")).toBe("Le faltan $ 482.000");
    document.body.innerHTML = "";
    show({ ...e7Matrix(), members: undefined });
    expect(totalOf("Ana")).toBe("Sin diferencia que comparar");
  });

  it("names a member who left the space as a former member", () => {
    const matrix = withLine({
      members: [
        {
          memberId: "m-gone",
          assigned: cop(1),
          contributed: cop(1),
          consumed: cop(1),
          gap: cop(0),
          status: null,
        },
      ],
    });
    show({ ...matrix, lines: [matrix.lines[1]!] });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Miembro anterior");
  });

  it("reads in English with the same figures", async () => {
    const { container } = show(withTotals(), "en");
    expect(totalOf("Ana")).toBe("Over by $ 312.000");
    expect(totalOf("Juan")).toBe("Short by $ 482.000");
    open("Ana", "Show detail by line for");
    expect(cellsOf("Ana", "Home", "Ana by line")).toEqual([
      "$ 588.000",
      "$ 900.000",
      "$ 520.000",
      "+$ 312.000 over-contributed",
    ]);
    expect(
      within(memberSection("Ana")).getAllByText(
        "Contributions and gaps are tracked at the fund, not per line.",
        {
          selector: "p",
        },
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("link", { name: "See the fund" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/fund?period=2026-11",
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("a member's per-line detail (HU-E9-10)", () => {
  it("shows Ana's Home figures with her over-contributed gap", () => {
    show();
    open("Ana");
    expect(cellsOf("Ana", "Home")).toEqual(["$ 588.000", "$ 900.000", "$ 520.000", "+$ 312.000 de más"]);
  });

  it("reads TRACKED_AT_FUND_LEVEL in Rent's contributed and gap cells, and once under the table", () => {
    show();
    open("Ana");
    const reason = "Aportó y diferencia se siguen en el fondo, no por rubro.";
    const [assigned, contributed, consumed, gap] = cellsOf("Ana", "Rent");
    expect([assigned, consumed]).toEqual(["$ 480.000", "$ 480.000"]);
    expect(contributed).toContain(reason);
    expect(gap).toContain(reason);
    expect(within(memberSection("Ana")).getAllByText(reason, { selector: "p" })).toHaveLength(1);
  });

  it("links a member's detail with a fund-level line to the fund view of the same period", () => {
    show();
    open("Ana");
    const link = screen.getByRole("link", { name: "Ver fondo" });
    expect(link).toHaveAttribute("href", "/spaces/sp-household/plan/fund?period=2026-11");
    expect(memberSection("Ana")).toContainElement(link);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows only what a line without allocation consumed, with its reason", () => {
    show();
    open("Ana");
    const [assigned, , consumed] = cellsOf("Ana", "Free");
    expect(consumed).toBe("$ 125.000");
    expect(assigned).toContain("Sin asignación por persona: solo se muestra lo consumido.");
  });

  it("writes a null figure as a dash for the eye and its reason for a screen reader", () => {
    show();
    open("Ana");
    const row = within(screen.getByRole("table", { name: "Ana por rubro" })).getByRole("row", {
      name: /^Rent/,
    });
    const contributed = within(row).getAllByRole("cell")[1]!;
    expect(contributed.querySelector("[aria-hidden='true']")).toHaveTextContent("—");
    expect(contributed.querySelector(".sr-only")).toHaveTextContent(
      "Aportó y diferencia se siguen en el fondo, no por rubro.",
    );
    const home = within(screen.getByRole("table", { name: "Ana por rubro" })).getByRole("row", {
      name: /^Home/,
    });
    expect(home.querySelector("[aria-hidden='true']:not(svg)")).toBeNull();
  });

  it("says 'Sin dato' for a missing figure whose line gives no reason", () => {
    show(
      withLine({
        reason: null,
        members: [
          {
            memberId: "m-ana",
            assigned: cop(1),
            contributed: null,
            consumed: cop(2),
            gap: null,
            status: null,
          },
          {
            memberId: "m-juan",
            assigned: cop(1),
            contributed: cop(1),
            consumed: cop(2),
            gap: cop(0),
            status: null,
          },
        ],
      }),
    );
    open("Ana");
    expect(cellsOf("Ana", "Home")).toEqual(["$ 1", "—Sin dato", "$ 2", "—Sin dato"]);
  });

  it("explains a savings line's missing consumption in the cell and once under the table", () => {
    show(
      withLine({
        funding: "SAVINGS",
        reason: null,
        members: [
          {
            memberId: "m-ana",
            assigned: cop(600_000),
            contributed: cop(600_000),
            consumed: null,
            gap: cop(0),
            status: "ON_TARGET",
          },
          {
            memberId: "m-juan",
            assigned: cop(1),
            contributed: cop(1),
            consumed: null,
            gap: cop(0),
            status: null,
          },
        ],
      }),
    );
    open("Ana");
    const note = "Cuenta lo que llegó a las cuentas de ahorro del rubro; no tiene consumo.";
    expect(cellsOf("Ana", "Home")[2]).toContain(note);
    expect(within(memberSection("Ana")).getAllByText(note, { selector: "p" })).toHaveLength(1);
  });

  it("writes no note when no line has a reason nor a savings fund", () => {
    const matrix = withTotals();
    show({ ...matrix, lines: [matrix.lines[1]!] });
    open("Ana");
    const detail = screen.getByRole("table", { name: "Ana por rubro" }).closest("[hidden], div[id]")!;
    expect(detail.querySelectorAll("p")).toHaveLength(0);
  });

  it("gives every line's gap a badge, so it never relies on color alone", () => {
    show();
    open("Ana");
    open("Juan");
    const tone = (table: string, text: string) =>
      within(screen.getByRole("table", { name: table }))
        .getByText(text)
        .closest("[data-tone]")
        ?.getAttribute("data-tone");
    expect(tone("Ana por rubro", "de más")).toBe("accent");
    expect(tone("Juan por rubro", "de menos")).toBe("owe");
  });

  it("labels the columns, names each line with how it is paid, and scrolls inside a focusable region", () => {
    show();
    open("Ana");
    const table = screen.getByRole("table", { name: "Ana por rubro" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Rubro", "Asignado", "Aportó", "Consumió", "Diferencia"]);
    expect(within(table).getByRole("rowheader", { name: /^Home/ })).toHaveTextContent(
      "HomeCada uno paga · Según aportes",
    );
    const scroller = screen.getByRole("region", { name: "Ana por rubro" });
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveClass("relative", "overflow-x-auto");
  });

  it("says a period without a plan has nothing to compare", async () => {
    const { container } = show({ ...e7Matrix(), plan: null, lines: [], members: [] });
    expect(
      screen.getByText("Este período no tiene plan: no hay asignaciones que comparar."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("members with nothing in the period (#213, #217)", () => {
  const SOFI = { id: "m-sofi", displayName: "Sofi" };
  const withSofi = (free: readonly (number | null)[] = [null, null, 0, null]): Matrix => {
    const matrix = withTotals();
    const money = (pesos: number | null | undefined) =>
      pesos === null || pesos === undefined ? null : cop(pesos);
    return {
      ...matrix,
      members: [...matrix.members!, { memberId: SOFI.id, gap: cop(0), status: "ON_TARGET" }],
      lines: matrix.lines.map((line) => ({
        ...line,
        members: [
          ...line.members,
          line.lineId === "l-free"
            ? {
                memberId: SOFI.id,
                assigned: money(free[0]),
                contributed: money(free[1]),
                consumed: money(free[2]),
                gap: money(free[3]),
                status: null,
              }
            : {
                memberId: SOFI.id,
                assigned: cop(0),
                contributed: line.reason === null ? cop(0) : null,
                consumed: cop(0),
                gap: line.reason === null ? cop(0) : null,
                status: line.reason === null ? ("ON_TARGET" as const) : null,
              },
        ],
      })),
    };
  };
  const showWith = (matrix: Matrix) =>
    renderWithIntl(
      <MemberMatrix
        space={householdDto()}
        matrix={matrix}
        members={[...HOUSEHOLD_MEMBERS, SOFI]}
        formats={BUILT_IN_FORMATS}
      />,
    );

  it("leaves out a member whose every figure in the period is zero", async () => {
    const { container } = showWith(withSofi());
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Ana", "Juan"]);
    open("Ana");
    expect(screen.queryByRole("table", { name: "Sofi por rubro" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps a member with any figure in the period, with every line in their detail", () => {
    showWith(withSofi([null, null, 40_000, null]));
    expect(totalOf("Sofi")).toBe("Al día");
    open("Sofi");
    expect(cellsOf("Sofi", "Free")[2]).toBe("$ 40.000");
    expect(cellsOf("Sofi", "Home").slice(0, 3)).toEqual(["$ 0", "$ 0", "$ 0"]);
  });
});
