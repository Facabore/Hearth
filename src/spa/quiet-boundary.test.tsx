import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuietBoundary } from "./quiet-boundary";

const Broken = (): never => {
  throw new Error("the backdrop's chunk did not load");
};

describe("QuietBoundary (P300)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws nothing in place of a decoration that fails, and leaves the screen beside it working", () => {
    // React reports a caught render error on the console; the boundary is what keeps it from going further.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <main>
        <QuietBoundary>
          <Broken />
        </QuietBoundary>
        <label>
          Monto
          <input defaultValue="55.000" />
        </label>
      </main>,
    );
    expect(screen.getByLabelText("Monto")).toHaveValue("55.000");
    expect(screen.getByRole("main").childElementCount).toBe(1);
  });

  it("draws its children when they render", () => {
    render(
      <QuietBoundary>
        <p>Inicio</p>
      </QuietBoundary>,
    );
    expect(screen.getByText("Inicio")).toBeInTheDocument();
  });
});
