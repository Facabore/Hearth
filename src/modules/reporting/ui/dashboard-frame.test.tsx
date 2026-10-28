import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { normalized, spaceDto } from "../../../../tests/support/ui/dto";
import { householdDto, NOVEMBER } from "../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { DashboardFrame } from "./dashboard-frame";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

describe("dashboard frame (HU-E9-10)", () => {
  it("frames the dashboard with the period, its neighbours, the plan's status, the planner link and the tabs", async () => {
    const { container } = renderWithIntl(
      <DashboardFrame
        space={householdDto()}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={{ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={{ id: "p-nov", status: "ACTIVE" }}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan?period=2026-10",
    );
    expect(screen.getByText("Activo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar plan" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov",
    );
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    expect(within(tabs).getByRole("link", { name: "Líneas" })).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    ["VIEWER", "Ver plan"],
    ["MEMBER", "Ver plan"],
    ["ADMIN", "Editar plan"],
    ["OWNER", "Editar plan"],
  ] as const)('offers a %s the link "%s" to the planner (ruling P207)', (role, label) => {
    renderWithIntl(
      <DashboardFrame
        space={householdDto({ role })}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={{ id: "p-nov", status: "DRAFT" }}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.getAllByRole("link", { name: /plan$/ }).map((link) => link.textContent)).toEqual([label]);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov",
    );
    expect(screen.getByText("Borrador")).toBeInTheDocument();
  });

  it("frames a period without a plan: no status, no planner link, the tabs and the next period", () => {
    renderWithIntl(
      <DashboardFrame
        space={householdDto()}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={null}
        next={{ label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" }}
        formats={BUILT_IN_FORMATS}
        plan={null}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.queryByRole("link", { name: /plan$/ })).toBeNull();
    expect(screen.queryByText("Activo")).toBeNull();
    expect(screen.getByRole("link", { name: "Período siguiente" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan?period=2026-12",
    );
    expect(screen.getByRole("navigation", { name: "Vistas del plan" })).toBeInTheDocument();
  });

  it("leads the manager of a personal space from My spending to planning a period without a plan (#167 sibling)", async () => {
    const { container } = renderWithIntl(
      <DashboardFrame
        space={spaceDto()}
        view="mine"
        period={{ ...NOVEMBER }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={null}
        offerPlanStart
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.getByRole("link", { name: "Planear este período" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan/lines?period=2026-11",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "never offers a %s to plan a period, since only managers can",
    (role) => {
      renderWithIntl(
        <DashboardFrame
          space={spaceDto({ role })}
          view="mine"
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={null}
          offerPlanStart
        >
          <p>Contenido</p>
        </DashboardFrame>,
      );
      expect(screen.queryByRole("link", { name: "Planear este período" })).toBeNull();
    },
  );

  it("offers no way to plan a period that already has a plan, nor on a view that does not ask for it", () => {
    renderWithIntl(
      <>
        <DashboardFrame
          space={spaceDto()}
          view="mine"
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={{ id: "p-nov", status: "ACTIVE" }}
          offerPlanStart
        >
          <p>Contenido</p>
        </DashboardFrame>
        <DashboardFrame
          space={spaceDto()}
          view="groups"
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={null}
        >
          <p>Contenido</p>
        </DashboardFrame>
      </>,
    );
    expect(screen.queryByRole("link", { name: "Planear este período" })).toBeNull();
    expect(screen.getByRole("link", { name: "Editar plan" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plans/p-nov",
    );
  });

  it("names the range of a period that is not a calendar month, in the person's date format", () => {
    renderWithIntl(
      <DashboardFrame
        space={householdDto({ periodPolicy: { kind: "MONTHLY", day: 15 } })}
        view="lines"
        period={{ label: "2026-11", startDate: "2026-11-15", endDate: "2026-12-14" }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={null}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(normalized(screen.getByRole("heading", { level: 1 }).textContent)).toBe("15/11/2026 – 14/12/2026");
  });
});
