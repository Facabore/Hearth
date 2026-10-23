import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ErrorScreen } from "./error-screen";
import { NotFoundScreen } from "./not-found-screen";

describe("the not-found screen (N1)", () => {
  it("says the page is missing, in the person's language, and offers the way out", async () => {
    const { container } = renderWithIntl(<NotFoundScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Esta página no existe" })).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "Ir al inicio" });
    expect(home).toHaveAttribute("href", "/");
    expect(home.className).toContain("h-14");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("speaks English with the English catalog", () => {
    renderWithIntl(<NotFoundScreen />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "This page does not exist" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the start page" })).toHaveAttribute("href", "/");
  });
});

describe("the error screen (N2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps Reintentar, quotes the reference and adds the way out", async () => {
    const onRetry = vi.fn();
    const { container } = renderWithIntl(<ErrorScreen digest="d-123" onRetry={onRetry} />);
    expect(screen.getByRole("heading", { level: 1, name: "Algo salió mal" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("d-123");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a lost connection and retries by reloading the page when nothing else is given", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const { container } = renderWithIntl(<ErrorScreen variant="connection" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "No pudimos conectar con Hearth" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
