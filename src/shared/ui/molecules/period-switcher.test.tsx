import { renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { IntlWrapper, renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "../format/formatters";
import { usePeriodText } from "./period-text";
import { PeriodSwitcher } from "./period-switcher";

describe("period text and switcher (HU-E9-10, ruling P205)", () => {
  it("names a calendar month by its month and any other period by its dates, in the person's format", () => {
    const { result } = renderHook(() => usePeriodText(), { wrapper: IntlWrapper("es") });
    const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
    expect(result.current(november, { kind: "MONTHLY", day: 1 }, BUILT_IN_FORMATS)).toBe("noviembre 2026");
    const half = { label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" };
    expect(result.current(half, { kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, BUILT_IN_FORMATS)).toBe(
      "1/11/2026 – 15/11/2026",
    );
  });

  it("shows the period as the heading between links to its neighbours", async () => {
    const { container } = renderWithIntl(
      <PeriodSwitcher title="noviembre 2026" previousHref="/p?period=2026-10" nextHref={null} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/p?period=2026-10",
    );
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("links both neighbours when both exist, in English too, and leaves no link for a missing one", () => {
    renderWithIntl(
      <PeriodSwitcher title="November 2026" previousHref="/p?period=2026-10" nextHref="/p?period=2026-12" />,
      {
        locale: "en",
      },
    );
    expect(screen.getByRole("link", { name: "Previous period" })).toHaveAttribute(
      "href",
      "/p?period=2026-10",
    );
    expect(screen.getByRole("link", { name: "Next period" })).toHaveAttribute("href", "/p?period=2026-12");
  });

  it("keeps the heading between two 44 px spacers when there is no neighbour", () => {
    const { container } = renderWithIntl(
      <PeriodSwitcher title="noviembre 2026" previousHref={null} nextHref={null} />,
    );
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(container.querySelectorAll("span.size-11")).toHaveLength(2);
  });
});
