import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { JoinedNotice } from "./joined-notice";

// Next's Link does not render its `replace` prop: a stand-in makes it visible to the test.
vi.mock("next/link", () => ({
  default: ({ replace, children, ...props }: { replace?: boolean; children: ReactNode }) => (
    <a data-replace={replace ? "true" : "false"} {...props}>
      {children}
    </a>
  ),
}));

describe("joined notice (U6): accepting an invitation is confirmed, not a silent jump", () => {
  it("says which space the person joined, as a status", async () => {
    const { container } = renderWithIntl(
      <JoinedNotice space="Household" dismissHref="/spaces/sp-household" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Te uniste a «Household»");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("dismisses by replacing the entry, with a full target", () => {
    renderWithIntl(<JoinedNotice space="Household" dismissHref="/spaces/sp-household" />);
    const dismiss = screen.getByRole("link", { name: "Cerrar aviso" });
    expect(dismiss).toHaveAttribute("href", "/spaces/sp-household");
    expect(dismiss).toHaveAttribute("data-replace", "true");
    expect(dismiss.className).toContain("size-11");
  });

  it("speaks English", () => {
    renderWithIntl(<JoinedNotice space="Household" dismissHref="/spaces/sp-household" />, { locale: "en" });
    expect(screen.getByRole("status")).toHaveTextContent("You joined “Household”");
  });

  it("lets a long unbroken name wrap instead of widening the screen", () => {
    renderWithIntl(<JoinedNotice space={"W".repeat(80)} dismissHref="/spaces/x" />);
    expect(screen.getByRole("status").querySelector("p")).toHaveClass("[overflow-wrap:anywhere]");
  });
});
