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

  it("recovers every mounted instance together, with one load more, when their shared chunk failed once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const loader = vi
      .fn<() => Promise<{ default: (props: { readonly name: string }) => ReactNode }>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValue({ default: ({ name }) => <p>{name}</p> });
    const Row = dynamic(loader);
    render(
      <Boundary>
        <Row name="first" />
        <Row name="second" />
        <Row name="third" />
      </Boundary>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "retry" }));
    expect(await screen.findByText("first")).toBeVisible();
    expect(screen.getByText("second")).toBeVisible();
    expect(screen.getByText("third")).toBeVisible();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shows `loading` until the code is in, and takes a module that is the component itself", async () => {
    let arrive: (component: () => ReactNode) => void = () => undefined;
    const Sheet = dynamic(() => new Promise<() => ReactNode>((resolve) => (arrive = resolve)), {
      loading: () => <p>loading</p>,
    });
    render(<Sheet />);
    expect(screen.getByText("loading")).toBeVisible();
    arrive(() => <p>sheet</p>);
    expect(await screen.findByText("sheet")).toBeVisible();
    expect(screen.queryByText("loading")).toBeNull();
  });
});
