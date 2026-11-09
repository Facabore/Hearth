import { cleanup, screen, within } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { level: 2, name: "noviembre 2026" })).toBeInTheDocument();
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
    expect(within(tabs).getByRole("link", { name: "Rubros" })).toHaveAttribute("aria-current", "page");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is a stacked screen titled Plan whose way back is the space's Configuración (ruling P311)", () => {
    renderWithIntl(
      <DashboardFrame
        space={householdDto()}
        view="groups"
        period={{ ...NOVEMBER }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={null}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/settings",
    );
    expect(screen.getByRole("heading", { level: 2, name: "noviembre 2026" })).toBeInTheDocument();
  });

  it.each([
    ["SHARED", householdDto(), ["Rubros", "Por grupo", "Miembros", "Fondo", "Tendencia"]],
    ["PERSONAL", spaceDto(), ["Rubros", "Por grupo", "Tendencia", "Próximos"]],
  ] as const)(
    "lists a %s space's views in the one order every space shares (decision U3, rulings P266 and P267)",
    (_kind, space, chips) => {
      renderWithIntl(
        <DashboardFrame
          space={space}
          view="groups"
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={null}
        >
          <p>Contenido</p>
        </DashboardFrame>,
      );
      const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
      expect(
        within(tabs)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(chips);
    },
  );

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

  it("lists the personal space's views in U3's order, without Mi consumo, its own stacked screen (ruling P267)", async () => {
    const { container } = renderWithIntl(
      <DashboardFrame
        space={spaceDto()}
        view="lines"
        period={{ ...NOVEMBER }}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
        plan={null}
      >
        <p>Contenido</p>
      </DashboardFrame>,
    );
    const tabs = within(screen.getByRole("navigation", { name: "Vistas del plan" })).getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Rubros", "Por grupo", "Tendencia", "Próximos"]);
    expect(tabs[0]).toHaveAttribute("href", "/spaces/sp-personal/plan?period=2026-11");
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Mi consumo" })).toBeNull();
    // Rubros is where a period without a plan is planned (NoPlan), so the frame offers no second way.
    expect(screen.queryByRole("link", { name: "Planear este período" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  describe("as the E9-10 boards draw it (ruling P272)", () => {
    const frame = (view: "lines" | "members" | "fund" | "groups" | "trend", space = householdDto()) =>
      renderWithIntl(
        <DashboardFrame
          space={space}
          view={view}
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={{ id: "p-nov", status: "ACTIVE" }}
        >
          <p>Contenido</p>
        </DashboardFrame>,
      );
    const subtitle = (container: HTMLElement) =>
      container.querySelector("[data-frame-subtitle]")?.textContent ?? null;

    it("puts Rubros' status beside the period and Editar plan above it, with no line naming the space", () => {
      const { container } = frame("lines");
      const heading = screen.getByRole("heading", { level: 2, name: "noviembre 2026" });
      expect(heading.parentElement).toContainElement(screen.getByText("Activo"));
      const edit = screen.getByRole("link", { name: "Editar plan" });
      expect(edit.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText("Household")).toBeNull();
      expect(subtitle(container)).toBeNull();
    });

    it.each([
      ["members", "Household · plan activo"],
      ["fund", "Household"],
      ["groups", "Household"],
      ["trend", "Household · contra el período anterior"],
    ] as const)(
      "writes the %s view's context under the period, without the status or the planner link",
      (view, text) => {
        const { container } = frame(view);
        expect(subtitle(container)).toBe(text);
        expect(screen.queryByText("Activo")).toBeNull();
        expect(screen.queryByRole("link", { name: /plan$/ })).toBeNull();
      },
    );

    it("names the fund the Fondo view tracks after the space, as board E9-10 04 does (#240)", () => {
      const fund = (fundNames: readonly string[]) =>
        renderWithIntl(
          <DashboardFrame
            space={householdDto({ name: "Hogar" })}
            view="fund"
            period={{ ...NOVEMBER }}
            previous={null}
            next={null}
            formats={BUILT_IN_FORMATS}
            plan={{ id: "p-nov", status: "ACTIVE" }}
            fundNames={fundNames}
          >
            <p>Contenido</p>
          </DashboardFrame>,
        );
      expect(subtitle(fund(["Fondo Hogar"]).container)).toBe("Hogar · Fondo Hogar");
      cleanup();
      expect(subtitle(fund(["Fondo Hogar", "Paseo"]).container)).toBe("Hogar · Fondo Hogar y Paseo");
      cleanup();
      // A space without a fund account, or an older API, keeps the space alone.
      expect(subtitle(fund([]).container)).toBe("Hogar");
    });

    it("reads a shared space's line trend up to its period", () => {
      frame("trend");
      expect(screen.getByRole("heading", { level: 2, name: "Hasta noviembre 2026" })).toBeInTheDocument();
    });

    it("writes no context under the period in the personal space", () => {
      const { container } = frame("groups", spaceDto());
      expect(subtitle(container)).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "noviembre 2026" })).toBeInTheDocument();
    });

    it("fills the chosen tab with ink and outlines the others", () => {
      frame("members");
      const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
      expect(within(tabs).getByRole("link", { name: "Miembros" })).toHaveClass("bg-ink", "text-surface");
      expect(within(tabs).getByRole("link", { name: "Rubros" })).toHaveClass("border", "bg-surface");
      expect(within(tabs).getByRole("link", { name: "Rubros" })).not.toHaveClass("bg-ink");
    });

    it("says the same in English", () => {
      renderWithIntl(
        <DashboardFrame
          space={householdDto()}
          view="trend"
          period={{ ...NOVEMBER }}
          previous={null}
          next={null}
          formats={BUILT_IN_FORMATS}
          plan={null}
        >
          <p>Contenido</p>
        </DashboardFrame>,
        { locale: "en" },
      );
      expect(screen.getByRole("heading", { level: 2, name: "Up to November 2026" })).toBeInTheDocument();
      expect(screen.getByText("Household · against the previous period")).toBeInTheDocument();
    });
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
    expect(normalized(screen.getByRole("heading", { level: 2 }).textContent)).toBe("15/11/2026 – 14/12/2026");
  });
});
