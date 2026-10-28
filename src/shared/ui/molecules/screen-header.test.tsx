import { fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { writeTrail } from "../navigation/history";
import { ScreenHeader } from "./screen-header";

// The link's `prefetch` lands on the anchor, so a test can read what the router was asked to do.
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...props }: { prefetch?: boolean | null; children: ReactNode }) => (
    <a data-prefetch={prefetch === false ? "false" : "auto"} {...props}>
      {children}
    </a>
  ),
}));

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

  it("is a compact 48 px header with a 17 px semibold title (#171)", () => {
    const { container } = renderWithIntl(<ScreenHeader backHref="/" title="Ajustes" />);
    expect(container.querySelector("header")).toHaveClass("min-h-12");
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveClass("text-[17px]", "font-semibold");
    expect(title).not.toHaveClass("text-2xl");
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

describe("screen header: prefetch of the way back (#196)", () => {
  it("prefetches its parent route by default", () => {
    renderWithIntl(<ScreenHeader backHref="/spaces/sp-1" title="Cuentas" />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("data-prefetch", "auto");
  });

  it("does not when the screen asks, as one that draws the space's shell itself does", () => {
    renderWithIntl(<ScreenHeader backHref="/spaces/sp-1" title="Ajustes" prefetch={false} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("data-prefetch", "false");
  });
});

describe("screen header: Volver returns to where the person was", () => {
  const home = "/spaces/s1";
  const movements = "/spaces/s1/transactions";
  const accounts = "/spaces/s1/accounts";
  let go: ReturnType<typeof vi.spyOn>;

  /** The trail and the location of a person who is on its current entry. */
  const walked = (urls: string[], pos = urls.length - 1) => {
    writeTrail({ urls, pos });
    window.history.replaceState({}, "", urls[pos]);
  };
  const clickBack = (init: MouseEventInit = {}) => {
    renderWithIntl(<ScreenHeader backHref={home} title="Cuentas" />);
    return fireEvent.click(screen.getByRole("link", { name: "Volver" }), init);
  };

  beforeEach(() => {
    go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => go.mockRestore());

  it("goes back one step to the screen she came from instead of following the parent route", () => {
    walked([movements, accounts]);
    expect(clickBack()).toBe(false);
    expect(go).toHaveBeenCalledExactlyOnceWith(-1);
  });

  it("goes back past the entries of its own screen: a form replaced by the screen, a query that changed", () => {
    walked([movements, accounts, accounts]);
    expect(clickBack()).toBe(false);
    expect(go).toHaveBeenCalledExactlyOnceWith(-2);
  });

  it("goes back from Saldos' history through every period she stepped to, to Saldos", () => {
    const history = "/spaces/s1/members/m1/history";
    walked(["/spaces/s1/balances", history, `${history}?from=2026-09-01`, `${history}?from=2026-08-01`]);
    expect(clickBack()).toBe(false);
    expect(go).toHaveBeenCalledExactlyOnceWith(-3);
  });

  it("follows the parent route when nothing came before (a deep link, a new tab)", () => {
    walked([accounts]);
    expect(clickBack()).toBe(true);
    expect(go).not.toHaveBeenCalled();
  });

  it.each([
    ["a sign-in", "/sign-in?next=%2Fspaces%2Fs1%2Faccounts"],
    ["an invitation", "/invitations/tok"],
  ])("follows the parent route when the screen before is %s, which is not in the app", (_name, before) => {
    walked([before, accounts]);
    expect(clickBack()).toBe(true);
    expect(go).not.toHaveBeenCalled();
  });

  it("follows the parent route when the trail does not end on this screen", () => {
    writeTrail({ urls: [movements, "/settings"], pos: 1 });
    window.history.replaceState({}, "", accounts);
    expect(clickBack()).toBe(true);
    expect(go).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "leaves a modified click %j to the browser (a new tab)",
    (init) => {
      walked([movements, accounts]);
      expect(clickBack(init)).toBe(true);
      expect(go).not.toHaveBeenCalled();
    },
  );

  it("keeps the real link to the parent route for a keyboard or no-JS visitor", () => {
    walked([movements, accounts]);
    renderWithIntl(<ScreenHeader backHref={home} title="Cuentas" />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", home);
  });
});
