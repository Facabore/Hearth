import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { PendingBanner } from "./pending-banner";

describe("the Movimientos banner of what waits for confirmation (HU-E9-09, P270)", () => {
  it.each([
    [["Energía"], "Energía"],
    [["Internet", "Energía"], "Internet y Energía"],
    [["Internet", "Energía", "Agua", "Gas"], "Internet, Energía y 2 más"],
  ])("names what waits: %j reads %s", (names, line) => {
    renderWithIntl(<PendingBanner spaceId="sp-household" count={names.length} names={names} />);
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Revisar" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/pending-occurrences",
    );
  });

  it("draws board E9-09 01: the count on one 15 px line, what waits under it in muted 13 px", () => {
    renderWithIntl(<PendingBanner spaceId="sp-household" count={2} names={["Internet", "Energía"]} />);
    expect(screen.getByText("2 movimientos por confirmar")).toHaveClass("text-[15px]", "font-semibold");
    expect(screen.getByText("Internet y Energía")).toHaveClass("text-[13px]", "text-muted");
    expect(screen.getByRole("link", { name: "Revisar" })).toHaveClass("min-h-11", "text-[15px]");
  });

  it("names them in English with its own words", () => {
    renderWithIntl(
      <PendingBanner spaceId="sp-household" count={3} names={["Internet", "Energía", "Agua"]} />,
      {
        locale: "en",
      },
    );
    expect(screen.getByText("Internet, Energía and 1 more")).toBeInTheDocument();
  });

  it("leaves the line out while the names have not arrived", () => {
    renderWithIntl(<PendingBanner spaceId="sp-household" count={2} names={[]} />);
    expect(screen.getByText("2 movimientos por confirmar")).toBeInTheDocument();
    expect(screen.queryByText(/ y /)).toBeNull();
  });
});
