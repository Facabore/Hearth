import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Fund, HOUSEHOLD_MEMBERS } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadFund } from "./fund-container";
import { FundTracking } from "./fund-tracking";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const show = (fund = e7Fund(), members = HOUSEHOLD_MEMBERS) =>
  renderWithIntl(<FundTracking fund={fund} members={members} formats={BUILT_IN_FORMATS} />);
const card = (name: string) => normalized(screen.getByRole("listitem", { name }).textContent);

describe("fund tracking (HU-E9-10)", () => {
  it("shows Juan expected 720.000, actual 500.000 and difference −220.000", async () => {
    const { container } = show();
    const juan = card("Juan");
    expect(juan).toContain("Esperado$ 720.000");
    expect(juan).toContain("Aportado$ 500.000");
    expect(juan).toContain("Diferencia−$ 220.000");
    expect(juan).toContain("Le falta aportar");
    expect(card("Ana")).toContain("Al día");
    expect(screen.queryByText("Sin plan, nadie tiene un aporte esperado.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sums nothing itself: the summary is the API's totals (ruling P201)", () => {
    const totals = { expected: cop(7), actual: cop(8), difference: cop(9) };
    show(e7Fund({ totals }));
    const summary = normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent);
    expect(summary).toContain("Esperado$ 7");
    expect(summary).toContain("Aportado$ 8");
    expect(summary).toContain("Diferencia+$ 9");
  });

  it("calls a member who paid more than expected up to date, and reads the sign of their difference", () => {
    const members = [
      { memberId: "m-ana", expected: cop(480_000), actual: cop(530_000), difference: cop(50_000) },
      { memberId: "m-juan", expected: cop(0), actual: cop(0), difference: cop(0) },
    ];
    show(e7Fund({ members }));
    expect(card("Ana")).toContain("Diferencia+$ 50.000");
    expect(card("Ana")).toContain("Al día");
    expect(card("Juan")).toContain("Diferencia$ 0");
    expect(card("Juan")).toContain("Al día");
    expect(card("Juan")).not.toContain("Le falta aportar");
  });

  it("fills each member's bar with what they contributed of what was expected, and draws it for nobody's ears", () => {
    const { container } = show();
    expect(container.querySelector("[data-member='m-juan'] [data-bar]")).toHaveStyle({ width: "69%" });
    expect(container.querySelector("[data-member='m-ana'] [data-bar]")).toHaveStyle({ width: "100%" });
    for (const bar of container.querySelectorAll("[data-bar]")) {
      expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("writes an amount still owed in the owe ink, never in the owe color that fails AA at body size", () => {
    show();
    const difference = (name: string) =>
      screen.getByRole("listitem", { name }).querySelector("[data-field='difference']") as HTMLElement;
    expect(difference("Juan")).toHaveClass("text-owe-ink");
    expect(difference("Juan")).not.toHaveClass("text-owe");
    expect(difference("Ana")).not.toHaveClass("text-owe-ink");
    expect(
      screen.getByRole("region", { name: "Aportes al fondo" }).querySelector("[data-field='difference']"),
    ).toHaveClass("text-owe-ink");
  });

  it("says nobody has an expected contribution when the period has no plan, and still lists the members", () => {
    show(
      e7Fund({
        plan: null,
        members: [
          { memberId: "m-ana", expected: cop(0), actual: cop(100_000), difference: cop(100_000) },
          { memberId: "m-juan", expected: cop(0), actual: cop(0), difference: cop(0) },
        ],
        totals: { expected: cop(0), actual: cop(100_000), difference: cop(100_000) },
      }),
    );
    expect(screen.getByText("Sin plan, nadie tiene un aporte esperado.")).toBeInTheDocument();
    expect(card("Ana")).toContain("Aportado$ 100.000");
  });

  it("explains what expected means under the cards, and names a member who is gone", () => {
    show(e7Fund(), [HOUSEHOLD_MEMBERS[0]!]);
    expect(
      screen.getByText(
        "Esperado: lo asignado a cada uno en las líneas pagadas con el fondo. Cuentan los aportes fechados en el período.",
      ),
    ).toBeInTheDocument();
    expect(card("Miembro anterior")).toContain("Aportado$ 500.000");
  });

  it("loads the period's fund report and the space's members", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => jsonResponse(e7Fund()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    const result = await loadFund(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(result.ok && result.data.members).toHaveLength(2);
    expect(result.ok && result.data.fund.totals.difference).toEqual(cop(-220_000));
    const report = requests.find((r) => r.url.includes("fund-contributions"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
  });

  it("fails with the report's problem instead of showing half a screen", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => problemResponse(404, "SpaceNotFound"),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    const result = await loadFund(api, { spaceId: "sp-household", period: "2026-11", today: "2026-10-31" });
    expect(result.ok).toBe(false);
  });
});
