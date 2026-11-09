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
/** Board E9-10 03 (ruling P272): `line` in `member`'s opened detail, as its gap and its one caption. */
const lineOf = (member: string, line: string, label = `${member} por rubro`) => {
  const item = within(screen.getByRole("list", { name: label })).getByRole("listitem", {
    name: new RegExp(`^${line}`),
  });
  return {
    item,
    gap: normalized(item.querySelector("[data-gap]")?.textContent ?? null).trim(),
    caption: normalized(item.querySelector("[data-caption]")?.textContent).trim(),
  };
};

describe("one row per member first (#213, ruling P262)", () => {
  it("shows each member's total gap in words, and no per-line figure until it is opened", async () => {
    const { container } = show();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Ana", "Juan"]);
    expect(totalOf("Ana")).toBe("Le sobran $ 312.000 sobre su parte");
    expect(totalOf("Juan")).toBe("Le faltan $ 482.000 de su parte");
    expect(screen.queryByRole("list", { name: /por rubro$/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts every member in one card, each with the initial of their name (board E9-10 03)", () => {
    const { container } = show();
    const card = container.querySelector("[data-members]")!;
    expect(card).toContainElement(memberSection("Ana"));
    expect(card).toContainElement(memberSection("Juan"));
    expect(card).toHaveClass("divide-y");
    const initial = (name: string) => memberSection(name).querySelector("[data-initial]");
    expect(initial("Ana")).toHaveTextContent("A");
    expect(initial("Ana")).toHaveAttribute("aria-hidden", "true");
    expect(initial("Juan")).toHaveTextContent("J");
    // The status sits under the name, and the link to the detail under the status.
    const heading = within(memberSection("Ana")).getByRole("heading", { level: 2 });
    const button = within(memberSection("Ana")).getByRole("button");
    expect(heading.nextElementSibling).toHaveAttribute("data-total");
    expect(heading.nextElementSibling!.nextElementSibling).toBe(button);
  });

  it("opens a member's per-line detail under their row on tap, and closes it again", async () => {
    const { container } = show();
    const button = screen.getByRole("button", { name: "Ver detalle por rubro de Juan" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    open("Juan");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAccessibleName("Ocultar detalle de Juan");
    expect(memberSection("Juan")).toContainElement(screen.getByRole("list", { name: "Juan por rubro" }));
    const home = lineOf("Juan", "Home");
    expect(home.gap).toBe("−$ 482.000 de menos");
    expect(home.caption).toBe("Asignado $ 882.000 · Aportó $ 400.000 · Consumió $ 780.000");
    // Ana's stays closed.
    expect(screen.queryByRole("list", { name: "Ana por rubro" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(button);
    expect(screen.queryByRole("list", { name: "Juan por rubro" })).toBeNull();
  });

  it("writes the total the API answers, never a sum of the lines (ruling P201)", () => {
    show(withTotal({ memberId: "m-ana", gap: cop(7), status: "OVER_CONTRIBUTED" }));
    expect(totalOf("Ana")).toBe("Le sobran $ 7 sobre su parte");
  });

  it("says a member is on target in words, without an arrow", () => {
    show(withTotal({ memberId: "m-ana", gap: cop(0), status: "ON_TARGET" }));
    expect(totalOf("Ana")).toBe("Al día con su parte");
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
    expect(ana).toHaveClass("text-accent");
    expect(ana).toHaveTextContent("Le sobran");
  });

  it("says when no line gives a member a gap, and when the API sends no totals", () => {
    show(withTotal({ memberId: "m-ana", gap: null, status: null }));
    expect(totalOf("Ana")).toBe("Sin diferencia que comparar");
    expect(totalOf("Juan")).toBe("Le faltan $ 482.000 de su parte");
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
    expect(totalOf("Ana")).toBe("Over their share by $ 312.000");
    expect(totalOf("Juan")).toBe("Short of their share by $ 482.000");
    open("Ana", "Show detail by line for");
    const home = lineOf("Ana", "Home", "Ana by line");
    expect(home.gap).toBe("+$ 312.000 over-contributed");
    expect(home.caption).toBe("Assigned $ 588.000 · Contributed $ 900.000 · Consumed $ 520.000");
    expect(lineOf("Ana", "Rent", "Ana by line").caption).toContain(
      "Contributions and gaps are tracked at the fund, not per line.",
    );
    expect(screen.getByRole("link", { name: "See the fund" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/fund?period=2026-11",
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("a member's per-line detail (HU-E9-10, board E9-10 03)", () => {
  it("shows Ana's Home with her gap at the right and one caption of her figures", () => {
    show();
    open("Ana");
    const home = lineOf("Ana", "Home");
    expect(home.gap).toBe("+$ 312.000 de más");
    expect(home.caption).toBe("Asignado $ 588.000 · Aportó $ 900.000 · Consumió $ 520.000");
  });

  it("writes TRACKED_AT_FUND_LEVEL inside Rent's own caption, with the link to the fund in that line", () => {
    show();
    open("Ana");
    const rent = lineOf("Ana", "Rent");
    expect(rent.gap).toBe("");
    expect(rent.caption).toBe(
      "Asignado $ 480.000 · Consumió $ 480.000 · Aportó y diferencia se siguen en el fondo, no por rubro.",
    );
    const link = within(rent.item).getByRole("link", { name: "Ver fondo" });
    expect(link).toHaveAttribute("href", "/spaces/sp-household/plan/fund?period=2026-11");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("shows only what a line without allocation consumed, with its reason", () => {
    show();
    open("Ana");
    expect(lineOf("Ana", "Free").caption).toBe(
      "Consumió $ 125.000 · Sin asignación por persona: solo se muestra lo consumido.",
    );
  });

  it("leaves a missing figure out of the caption and says why in words, never a lone dash", () => {
    show();
    open("Ana");
    const rent = lineOf("Ana", "Rent").item;
    expect(rent.textContent).not.toContain("—");
    expect(rent.querySelector(".sr-only")).toBeNull();
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
    expect(lineOf("Ana", "Home").caption).toBe("Asignado $ 1 · Consumió $ 2 · Sin dato");
  });

  it("writes a savings line's note inline in its caption", () => {
    show(
      withLine({
        funding: "SAVINGS",
        reason: null,
        members: [
          {
            memberId: "m-ana",
            assigned: cop(240_000),
            contributed: cop(0),
            consumed: null,
            gap: cop(-240_000),
            status: "UNDER_CONTRIBUTED",
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
    const home = lineOf("Ana", "Home");
    expect(home.gap).toBe("−$ 240.000 de menos");
    expect(home.caption).toBe(
      "Asignado $ 240.000 · Aportó $ 0 · Cuenta lo que llegó a las cuentas de ahorro del rubro; no tiene consumo.",
    );
  });

  it("writes no note under the lines: each reason lives in its own line", () => {
    show();
    open("Ana");
    const list = screen.getByRole("list", { name: "Ana por rubro" });
    expect(list.parentElement!.querySelectorAll(":scope > p")).toHaveLength(0);
    expect(screen.queryByText("Ana por rubro")).toBeNull();
    expect(screen.queryByText(/Cada uno paga|Según aportes/)).toBeNull();
  });

  it("gives every line's gap its sign and a word, so it never relies on color alone", () => {
    show();
    open("Ana");
    open("Juan");
    expect(lineOf("Ana", "Home").gap).toMatch(/^\+\$ .* de más$/);
    expect(lineOf("Juan", "Home").gap).toMatch(/^−\$ .* de menos$/);
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
    expect(screen.queryByRole("list", { name: "Sofi por rubro" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps a member with any figure in the period, with every line in their detail", () => {
    showWith(withSofi([null, null, 40_000, null]));
    expect(totalOf("Sofi")).toBe("Al día con su parte");
    open("Sofi");
    expect(lineOf("Sofi", "Free").caption).toContain("Consumió $ 40.000");
    expect(lineOf("Sofi", "Home").caption).toBe("Asignado $ 0 · Aportó $ 0 · Consumió $ 0");
  });
});
