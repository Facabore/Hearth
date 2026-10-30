import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, cop, octoberPage, rowContext } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { FirstSteps, firstStepsOf, type FirstStepsDone } from "./first-steps";
import { HomeSummary } from "./home-summary";

const mocks = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

const NONE: FirstStepsDone = { balances: false, expense: false, share: false };
const KEY = "hearth.firstSteps.u-ana";

const card = () => screen.queryByRole("region", { name: "Tus primeros pasos" });
const step = (name: RegExp) =>
  within(card()!)
    .getAllByRole("listitem")
    .find((item) => name.test(item.textContent ?? ""))!;

const space = (kind: SpaceDto["kind"], id = `sp-${kind}`): SpaceDto => ({
  id,
  name: kind,
  kind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: kind === "PERSONAL" ? null : "OWNER",
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("a new person's first steps (#220, F14)", () => {
  it("offers the three steps, each linking to where it is done, and returns to the home", async () => {
    const { container } = renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={NONE} />);
    const links = within(card()!).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["¿Cuánto tienes hoy en tus cuentas?", "/spaces/sp-1/accounts?returnTo=%2Fspaces%2Fsp-1"],
      ["Registra tu primer gasto", "/spaces/sp-1/new?returnTo=%2Fspaces%2Fsp-1"],
      ["Comparte con tu hogar", "/spaces/new?from=sp-1&returnTo=%2Fspaces%2Fsp-1"],
    ]);
    expect(within(card()!).queryByText("Hecho")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    ["balances", /cuentas/],
    ["expense", /gasto/],
    ["share", /hogar/],
  ] as const)("shows the %s step as done, with no link, while the others stay open", (key, name) => {
    renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={{ ...NONE, [key]: true }} />);
    expect(within(step(name)).getByText("Hecho")).toBeInTheDocument();
    expect(within(step(name)).queryByRole("link")).toBeNull();
    expect(within(card()!).getAllByRole("link")).toHaveLength(2);
    expect(within(card()!).getAllByText("Hecho")).toHaveLength(1);
  });

  it("goes away once all three are done, and stays away for that person", () => {
    const { unmount } = renderWithIntl(
      <FirstSteps spaceId="sp-1" personId="u-ana" done={{ balances: true, expense: true, share: true }} />,
    );
    expect(card()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
    unmount();
    renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={NONE} />);
    expect(card()).toBeNull();
  });

  it("goes away when dismissed, and stays dismissed for that person only", async () => {
    const { unmount } = renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={NONE} />);
    await userEvent.click(screen.getByRole("button", { name: "Ocultar los primeros pasos" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(KEY)).toBe("1");
    unmount();
    const { unmount: again } = renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={NONE} />);
    expect(card()).toBeNull();
    again();
    renderWithIntl(<FirstSteps spaceId="sp-2" personId="u-juan" done={NONE} />);
    expect(card()).not.toBeNull();
  });

  it("shows the card when the storage is blocked, and dismissing it still hides it on this visit", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={NONE} />);
    expect(card()).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ocultar los primeros pasos" }));
    expect(card()).toBeNull();
  });

  it("reads in English too", () => {
    renderWithIntl(<FirstSteps spaceId="sp-1" personId="u-ana" done={{ ...NONE, expense: true }} />, {
      locale: "en",
    });
    const region = screen.getByRole("region", { name: "Your first steps" });
    expect(within(region).getByText("Done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide the first steps" })).toBeInTheDocument();
  });
});

describe("which first steps are done (#220)", () => {
  const empty = { ...octoberPage, items: [] };
  const personal = [space("PERSONAL")];

  it("counts none for a new person: starter accounts at zero, no movement, no shared space", () => {
    expect(firstStepsOf({ accounts: [accountDto()], page: empty, spaces: personal })).toEqual(NONE);
  });

  it("counts the balances once an account opens with money", () => {
    const accounts = [accountDto(), accountDto({ id: "a-2", openingBalance: cop(500), balance: cop(500) })];
    expect(firstStepsOf({ accounts, page: empty, spaces: personal })).toEqual({ ...NONE, balances: true });
  });

  it("counts the balances and the first movement once an account moved, even in an earlier period", () => {
    const accounts = [accountDto({ balance: cop(-12_000) })];
    expect(firstStepsOf({ accounts, page: empty, spaces: personal })).toEqual({
      ...NONE,
      balances: true,
      expense: true,
    });
  });

  it("counts the first movement once the period has one", () => {
    expect(firstStepsOf({ accounts: [accountDto()], page: octoberPage, spaces: personal })).toEqual({
      ...NONE,
      expense: true,
    });
  });

  it("counts sharing once the person is in a shared space, not for a direct split alone", () => {
    const page = empty;
    const accounts = [accountDto()];
    expect(firstStepsOf({ accounts, page, spaces: [...personal, space("DIRECT")] }).share).toBe(false);
    expect(firstStepsOf({ accounts, page, spaces: [...personal, space("SHARED")] }).share).toBe(true);
  });
});

describe("the first steps on the home (#220)", () => {
  it("sit under the period's figure, so it stays the first thing on the home", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto()]}
        context={rowContext}
        firstSteps={{ personId: "u-ana", done: NONE }}
      />,
    );
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(summary.compareDocumentPosition(card()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card()!.compareDocumentPosition(screen.getByRole("region", { name: "Cuentas" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("is not on the home when the container offers none", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto()]}
        context={rowContext}
      />,
    );
    expect(card()).toBeNull();
  });
});
