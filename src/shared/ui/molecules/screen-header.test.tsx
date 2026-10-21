import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ScreenHeader } from "./screen-header";

describe("screen header", () => {
  it("renders a real link named Volver to an explicit parent route, then the title and subtitle", async () => {
    const { container } = renderWithIntl(
      <ScreenHeader backHref="/spaces/sp-1" title="Miembros" subtitle="Hogar · COP" />,
    );
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveAttribute("href", "/spaces/sp-1");
    expect(back.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { level: 1, name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByText("Hogar · COP")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("gives the link a target of at least 44 x 44 px", () => {
    renderWithIntl(<ScreenHeader backHref="/" title="Ajustes" />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveClass("size-12");
  });

  it("lets one very long unbroken title wrap inside the screen instead of widening it", () => {
    renderWithIntl(<ScreenHeader backHref="/" title={"M".repeat(60)} />);
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
    // The title shrinks, never the way back: its target stays a full 48 px.
    expect(screen.getByRole("link", { name: "Volver" })).toHaveClass("shrink-0", "size-12");
  });

  it("names the link in the person's language and shows an action after the title", () => {
    renderWithIntl(<ScreenHeader backHref="/" title="Accounts" action={<a href="/new">Add</a>} />, {
      locale: "en",
    });
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Add" })).toBeInTheDocument();
  });
});
