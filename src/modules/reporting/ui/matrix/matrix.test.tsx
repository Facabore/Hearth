import { screen, within } from "@testing-library/react";
import { notFound } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, meDto, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Matrix, HOUSEHOLD_MEMBERS, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { MemberMatrixDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { UI_ICONS } from "@/shared/ui/icons/ui-icons";
import { loadMatrix, MemberMatrixContainer } from "./matrix-container";
import { MemberMatrix } from "./member-matrix";

const server = vi.hoisted(() => ({ api: undefined as unknown, spaces: [] as unknown[] }));

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto({ timezone: "America/Bogota" }),
  getSpaces: async () => server.spaces,
  serverApi: async () => server.api,
}));

const cellsOf = (table: string, member: string) =>
  within(
    within(screen.getByRole("table", { name: table })).getByRole("row", { name: new RegExp(`^${member}`) }),
  )
    .getAllByRole("cell")
    .map((c) => normalized(c.textContent).trim());
const show = (matrix: MemberMatrixDto = e7Matrix(), locale: "es" | "en" = "es") =>
  renderWithIntl(
    <MemberMatrix
      space={householdDto()}
      matrix={matrix}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
    />,
    { locale },
  );

/** One line of `e7Matrix()` replaced, so a test changes only what it is about. */
const withLine = (line: Partial<MemberMatrixDto["lines"][number]>, at = 1): MemberMatrixDto => {
  const matrix = e7Matrix();
  matrix.lines[at] = { ...matrix.lines[at]!, ...line };
  return matrix;
};

describe("member matrix (HU-E9-10)", () => {
  it("shows Ana's Home row with its over-contributed gap, and Juan's under-contributed one", async () => {
    const { container } = show();
    expect(cellsOf("Home por miembro", "Ana")).toEqual([
      "$ 588.000",
      "$ 900.000",
      "$ 520.000",
      "+$ 312.000 de más",
    ]);
    expect(cellsOf("Home por miembro", "Juan")).toEqual([
      "$ 882.000",
      "$ 400.000",
      "$ 780.000",
      "−$ 482.000 de menos",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads TRACKED_AT_FUND_LEVEL in Rent's contributed and gap cells, and under its table", () => {
    show();
    const reason = "Aportó y diferencia se siguen en el fondo, no por línea.";
    const [assigned, contributed, consumed, gap] = cellsOf("Rent por miembro", "Ana");
    expect([assigned, consumed]).toEqual(["$ 480.000", "$ 480.000"]);
    expect(contributed).toContain(reason);
    expect(gap).toContain(reason);
    expect(screen.getAllByText(reason, { selector: "p" })).toHaveLength(1);
  });

  it("links a line tracked at fund level to the fund view of the same period", () => {
    const { container } = show();
    expect(screen.getByRole("link", { name: "Ver fondo" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/fund?period=2026-11",
    );
    // Only that line has the link, and it sits inside the line's own section.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container.querySelector("[data-line='l-rent']")).toContainElement(
      screen.getByRole("link", { name: "Ver fondo" }),
    );
  });

  it("names the link in English", () => {
    show(e7Matrix(), "en");
    expect(screen.getByRole("link", { name: "See the fund" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan/fund?period=2026-11",
    );
  });

  it("shows only what a line without allocation consumed, with its reason", () => {
    show();
    const [assigned, , consumed] = cellsOf("Free por miembro", "Ana");
    expect(consumed).toBe("$ 125.000");
    expect(assigned).toContain("Sin asignación por persona: solo se muestra lo consumido.");
  });

  it("loads the period's matrix and the space's members", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    const result = await loadMatrix(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(result.ok && result.data.members).toHaveLength(2);
    const report = requests.find((r) => r.url.includes("member-matrix"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
  });

  it("has no members view in the personal space, and asks for nothing", async () => {
    server.spaces = [spaceDto(), householdDto()];
    const { api, requests } = fakeApi({});
    server.api = api;
    vi.mocked(notFound).mockImplementationOnce(() => {
      throw new Error("not found");
    });
    await expect(MemberMatrixContainer({ spaceId: "sp-personal" })).rejects.toThrow("not found");
    expect(requests).toEqual([]);
  });
});

describe("member matrix details (ruling P217)", () => {
  it("opens today's period when none is asked for", async () => {
    const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [november] }),
    });
    const result = await loadMatrix(api, { spaceId: "sp-household", today: "2026-11-05" });
    expect(result.ok && result.data.matrix.period.label).toBe("2026-11");
    const report = requests.find((r) => r.url.includes("member-matrix"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
  });

  it("stops at the first failed read and hands its problem over", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () =>
        jsonResponse({ code: "Forbidden", status: 403, title: "No", requestId: "r1" }, 403),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    const result = await loadMatrix(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(result.ok).toBe(false);
  });

  it("shows each figure as the API answered it, never a gap of its own", () => {
    const matrix = withLine({
      members: [
        {
          memberId: "m-ana",
          assigned: cop(588_000),
          contributed: cop(900_000),
          consumed: cop(520_000),
          gap: cop(7),
          status: "ON_TARGET",
        },
      ],
    });
    show(matrix);
    expect(cellsOf("Home por miembro", "Ana")).toEqual([
      "$ 588.000",
      "$ 900.000",
      "$ 520.000",
      "+$ 7 al día",
    ]);
  });

  it("writes a null figure as a dash for the eye and its reason for a screen reader", () => {
    const { container } = show();
    const row = within(screen.getByRole("table", { name: "Rent por miembro" })).getByRole("row", {
      name: /^Ana/,
    });
    const contributed = within(row).getAllByRole("cell")[1]!;
    const dash = contributed.querySelector("[aria-hidden='true']");
    expect(dash).toHaveTextContent("—");
    expect(contributed.querySelector(".sr-only")).toHaveTextContent(
      "Aportó y diferencia se siguen en el fondo, no por línea.",
    );
    // A figure that is set shows no dash.
    expect(container.querySelector("[data-line='l-home'] [aria-hidden='true']:not(svg)")).toBeNull();
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
        ],
      }),
    );
    expect(cellsOf("Home por miembro", "Ana")).toEqual(["$ 1", "—Sin dato", "$ 2", "—Sin dato"]);
  });

  it("explains an invalid allocation under the table and in the cell", () => {
    show(
      withLine({
        reason: "INVALID_ALLOCATION",
        members: [
          {
            memberId: "m-ana",
            assigned: null,
            contributed: cop(1),
            consumed: cop(2),
            gap: null,
            status: null,
          },
        ],
      }),
    );
    const reason = "La asignación de esta línea no cuadra: nadie tiene un monto asignado.";
    expect(cellsOf("Home por miembro", "Ana")[0]).toContain(reason);
    expect(screen.getAllByText(reason, { selector: "p" })).toHaveLength(1);
  });

  it("explains that a savings line has no consumption, in the cell and under the table", () => {
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
        ],
      }),
    );
    const note = "Cuenta lo que llegó a las cuentas de ahorro de la línea; no tiene consumo.";
    expect(cellsOf("Home por miembro", "Ana")[2]).toContain(note);
    expect(screen.getAllByText(note, { selector: "p" })).toHaveLength(1);
  });

  it("keeps a savings line's note for its consumed cell even when the line also has a reason", () => {
    show(
      withLine({
        funding: "SAVINGS",
        reason: "NOT_ALLOCATED",
        members: [
          { memberId: "m-ana", assigned: null, contributed: null, consumed: null, gap: null, status: null },
        ],
      }),
    );
    const [assigned, , consumed] = cellsOf("Home por miembro", "Ana");
    expect(assigned).toContain("Sin asignación por persona");
    expect(consumed).toContain("no tiene consumo");
    expect(consumed).not.toContain("Sin asignación por persona");
    const home = screen.getByRole("region", { name: "Home" });
    expect(within(home).getAllByText(/no tiene consumo/, { selector: "p" })).toHaveLength(1);
    expect(within(home).getAllByText(/Sin asignación por persona/, { selector: "p" })).toHaveLength(1);
  });

  it("writes no note under a line that has neither a reason nor a savings fund", () => {
    const { container } = show();
    const home = container.querySelector<HTMLElement>("[data-line='l-home']")!;
    expect(home.querySelectorAll("p")).toHaveLength(1);
    expect(within(home).getByText("Directo · Según capacidad")).toBeInTheDocument();
  });

  it("gives every status a badge, so the gap never relies on color alone", () => {
    show(
      withLine({
        members: [
          {
            memberId: "m-ana",
            assigned: cop(10),
            contributed: cop(10),
            consumed: cop(3),
            gap: cop(0),
            status: "ON_TARGET",
          },
          {
            memberId: "m-juan",
            assigned: cop(10),
            contributed: cop(4),
            consumed: cop(3),
            gap: cop(-6),
            status: "UNDER_CONTRIBUTED",
          },
        ],
      }),
    );
    const table = screen.getByRole("table", { name: "Home por miembro" });
    const tone = (text: string) =>
      within(table).getByText(text).closest("[data-tone]")?.getAttribute("data-tone");
    expect(tone("al día")).toBe("neutral");
    expect(tone("de menos")).toBe("owe");
    expect(cellsOf("Home por miembro", "Juan")[3]).toBe("−$ 6 de menos");
  });

  it("marks an over-contribution with the accent tone and an up arrow, an under one with a down arrow", () => {
    show();
    const table = screen.getByRole("table", { name: "Home por miembro" });
    const over = within(table).getByText("de más").closest("[data-tone]")!;
    const under = within(table).getByText("de menos").closest("[data-tone]")!;
    expect(over).toHaveAttribute("data-tone", "accent");
    expect(over.querySelector("svg[aria-hidden='true'] path")).toHaveAttribute("d", UI_ICONS.arrowUp);
    expect(under.querySelector("svg[aria-hidden='true'] path")).toHaveAttribute("d", UI_ICONS.arrowDown);
  });

  it("gives an on-target gap a plain badge without an arrow", () => {
    show(
      withLine({
        members: [
          {
            memberId: "m-ana",
            assigned: cop(10),
            contributed: cop(10),
            consumed: cop(3),
            gap: cop(0),
            status: "ON_TARGET",
          },
        ],
      }),
    );
    const badge = screen.getByText("al día").closest("[data-tone]")!;
    expect(badge.querySelector("svg")).toBeNull();
  });

  it("names a member who left the space as a former member", () => {
    show(
      withLine({
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
      }),
    );
    const row = within(screen.getByRole("table", { name: "Home por miembro" })).getAllByRole("row")[1]!;
    expect(within(row).getByRole("rowheader")).toHaveTextContent("Miembro anterior");
  });

  it("labels the columns and gives each line a section named by its heading", () => {
    show();
    const home = screen.getByRole("region", { name: "Home" });
    expect(within(home).getByRole("heading", { level: 2, name: "Home" })).toBeInTheDocument();
    const table = within(home).getByRole("table", { name: "Home por miembro" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Miembro", "Asignado", "Aportó", "Consumió", "Diferencia"]);
    expect(within(home).getByText("Directo · Según capacidad")).toBeInTheDocument();
    expect(within(home).getByText("Home por miembro", { selector: "caption" })).toBeVisible();
  });

  it("scrolls the table inside a named, focusable region instead of the page", () => {
    show();
    const scroller = screen.getByRole("region", { name: "Home por miembro" });
    expect(scroller).toHaveAttribute("tabindex", "0");
    expect(scroller).toHaveClass("overflow-x-auto");
    expect(within(scroller).getByRole("table")).toBeInTheDocument();
  });

  it("says a period without a plan has nothing to compare", async () => {
    const { container } = show({ ...e7Matrix(), plan: null, lines: [] });
    expect(
      screen.getByText("Este período no tiene plan: no hay asignaciones que comparar."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads in English with the same figures", async () => {
    const { container } = show(e7Matrix(), "en");
    expect(cellsOf("Home by member", "Ana")).toEqual([
      "$ 588.000",
      "$ 900.000",
      "$ 520.000",
      "+$ 312.000 over-contributed",
    ]);
    expect(cellsOf("Rent by member", "Juan")[2]).toBe("$ 720.000");
    expect(
      screen.getAllByText("Contributions and gaps are tracked at the fund, not per line.", { selector: "p" }),
    ).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });
});
