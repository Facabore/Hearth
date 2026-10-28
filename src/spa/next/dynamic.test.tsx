import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import dynamic from "./dynamic";

class Boundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <button type="button" onClick={() => this.setState({ failed: false })}>
        retry
      </button>
    ) : (
      this.props.children
    );
  }
}

describe("next/dynamic in the SPA", () => {
  it("loads the component again after its chunk failed to load once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loader = vi
      .fn<() => Promise<{ default: () => ReactNode }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: () => <p>sheet</p> });
    const Sheet = dynamic(loader);
    render(
      <Boundary>
        <Sheet />
      </Boundary>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "retry" }));
    expect(await screen.findByText("sheet")).toBeVisible();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
