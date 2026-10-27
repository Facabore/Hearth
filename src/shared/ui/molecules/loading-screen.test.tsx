import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { LoadingScreen } from "./loading-screen";

/** Everything a person could tab to or press inside `root`. */
const controls = (root: Element) =>
  Array.from(root.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"));

describe("the loading screen (#196)", () => {
  it("is a busy region named in the person's language, with nothing to press", async () => {
    const { container } = renderWithIntl(<LoadingScreen />);
    const region = screen.getByRole("region", { name: "Cargando…" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(controls(container)).toEqual([]);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("keeps the screen's own header and its way back, the only control on the screen", async () => {
    const { container } = renderWithIntl(<LoadingScreen header={{ backHref: "..", title: "Cuentas" }} />);
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveAttribute("href", "..");
    expect(screen.getByRole("heading", { level: 1, name: "Cuentas" })).toBeInTheDocument();
    expect(controls(container)).toEqual([back]);
    expect(screen.getByRole("region", { name: "Cargando…" })).toContainElement(back);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("titles a header whose real title waits on the data with the loading label", () => {
    renderWithIntl(<LoadingScreen header={{ backHref: "../../balances" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Cargando…" })).toBeInTheDocument();
  });

  it.each(["list", "form", "cards"] as const)(
    "hides the %s placeholder from assistive technology and sizes it with the row tokens",
    (shape) => {
      const { container } = renderWithIntl(<LoadingScreen shape={shape} />);
      const placeholder = container.querySelector("[aria-hidden='true']");
      expect(placeholder).not.toBeNull();
      expect(placeholder!.children.length).toBeGreaterThan(0);
      expect(placeholder!.innerHTML).toMatch(/h-\(--row(-lg)?\)|h-32/);
    },
  );

  it("speaks English with the English catalog", () => {
    renderWithIntl(<LoadingScreen header={{ backHref: "/", title: "Settings" }} />, { locale: "en" });
    expect(screen.getByRole("region", { name: "Loading…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
  });
});
