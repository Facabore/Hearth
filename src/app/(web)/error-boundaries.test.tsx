import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../tests/support/ui/render";
import AppError from "./(app)/error";
import OpenError from "./(open)/error";
import PublicError from "./(public)/error";

describe.each([
  ["(app)", AppError],
  ["(public)", PublicError],
  ["(open)", OpenError],
])("the error boundary of %s (N2)", (_group, Boundary) => {
  it("offers Reintentar, which resets the boundary, and a way to the start page", async () => {
    const reset = vi.fn();
    renderWithIntl(<Boundary error={Object.assign(new Error("boom"), { digest: "dig-9" })} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("alert")).toHaveTextContent("dig-9");
  });
});
