import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { spaceDto } from "../../../../../tests/support/ui/dto";
import { e74Unified, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { MyConsumptionScreen } from "./my-consumption-screen";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const DECEMBER = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };

describe("Mi consumo, the stacked screen of decisions U10 and U4 (ruling P267)", () => {
  it("has a way back to the space's home, its period between its neighbours, and no Plan tabs", async () => {
    const { container } = renderWithIntl(
      <MyConsumptionScreen
        space={spaceDto()}
        view={e74Unified({ period: { ...NOVEMBER } })}
        previous={OCTOBER}
        next={DECEMBER}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal");
    expect(screen.getByRole("heading", { level: 1, name: "Mi consumo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /noviembre 2026/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/my-consumption?period=2026-10",
    );
    expect(screen.getByRole("link", { name: "Período siguiente" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/my-consumption?period=2026-12",
    );
    // It is not a Plan tab view any more, so it wears no tabs.
    expect(screen.queryByRole("navigation", { name: "Vistas del plan" })).toBeNull();
    expect(screen.getByRole("region", { name: "Lo que gastaste tú" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("leaves out a neighbour period that does not exist", () => {
    renderWithIntl(
      <MyConsumptionScreen
        space={spaceDto()}
        view={e74Unified()}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.queryByRole("link", { name: "Período anterior" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
  });

  it("reflows at 390 and 320 px: the screen shrinks with its column, and its title wraps instead of scrolling", () => {
    const { container } = renderWithIntl(
      <MyConsumptionScreen
        space={spaceDto()}
        view={e74Unified()}
        previous={null}
        next={null}
        formats={BUILT_IN_FORMATS}
      />,
    );
    // jsdom lays nothing out: the real-browser check at both widths is in tests/e2e/layout.spec.ts.
    expect(container.firstElementChild).toHaveClass("w-full", "min-w-0");
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveClass("size-12");
    expect(within(back.parentElement!).getByRole("heading", { level: 1 })).toHaveClass("min-w-0");
  });
});
