import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, cop, octoberPage, rowContext } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { HomeSummary } from "./home-summary";

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("home (HU-E9-01)", () => {
  it("shows the period's spending and income, the accounts and the latest transactions", async () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 3) }}
        accounts={[
          accountDto({ name: "Bancolombia", balance: cop(4_455_000) }),
          accountDto({ id: "a-2", name: "Nequi", balance: cop(500_000) }),
        ]}
        context={rowContext}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(summary.textContent)).toContain("Gastado en octubre");
    expect(norm(summary.textContent)).toContain("$ 245.000");
    expect(norm(summary.textContent)).toContain("+$ 3.200.000");
    expect(norm(screen.getByRole("region", { name: "Cuentas" }).textContent)).toContain(
      "Bancolombia$ 4.455.000",
    );
    expect(within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem")).toHaveLength(
      3,
    );
    expect(screen.getByRole("link", { name: "Ver todas las cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.getByRole("link", { name: "Ver todos los movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("home without transactions (390 px review, S5)", () => {
  const empty = () =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-shared"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto({ name: "Fondo Hogar", balance: cop(0) })]}
        context={rowContext}
      />,
    );

  it("says there is nothing yet and how to record the first, instead of a bare heading", async () => {
    const { container } = empty();
    const recent = screen.getByRole("region", { name: "Recientes" });
    expect(
      within(recent).getByText("Aún no hay movimientos. Registra el primero con +."),
    ).toBeInTheDocument();
    expect(within(recent).queryAllByRole("listitem")).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no empty message once there is a transaction", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 1) }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(1) })]}
        context={rowContext}
      />,
    );
    expect(screen.queryByText(/Aún no hay movimientos/)).toBeNull();
  });
});

describe("home, narrow screens (S2)", () => {
  it("lets its single column shrink below its content, so a long name or amount never widens the page", () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 1) }}
        accounts={[accountDto({ name: "Cuenta de ahorros de la familia", balance: cop(4_455_000) })]}
        context={rowContext}
      />,
    );
    expect(container.firstElementChild).toHaveClass("grid-cols-1");
    expect(screen.getByRole("region", { name: "Cuentas" }).parentElement).toHaveClass("min-w-0");
    expect(screen.getByRole("region", { name: "Recientes" })).toHaveClass("min-w-0");
  });

  it("scales the period total down on a phone and lets any amount wrap, so a wide font never widens the page", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]}
        context={rowContext}
      />,
    );
    const amounts = [
      screen.getByRole("region", { name: "Resumen del período" }).querySelector("p.font-semibold"),
      screen.getByRole("region", { name: "Cuentas" }).querySelector("li span.font-semibold"),
    ];
    for (const amount of amounts) expect(amount).toHaveClass("[overflow-wrap:anywhere]");
    expect(amounts[0]?.className).toContain("clamp(");
  });
});

describe("home, first use (P148)", () => {
  const homeWith = (accounts: Parameters<typeof HomeSummary>[0]["accounts"]) => (
    <HomeSummary
      spaceId="sp-personal"
      policy={{ kind: "MONTHLY", day: 1 }}
      page={{ ...octoberPage, items: [] }}
      accounts={accounts}
      context={rowContext}
    />
  );

  it("offers to add the first account in place of the period summary while the space has none", async () => {
    const { container } = renderWithIntl(homeWith([]));
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Agrega tu primera cuenta" });
    expect(card).toHaveTextContent("Registra dónde tienes tu dinero para empezar a llevar tus cuentas.");
    // The card starts a flow: the accounts screen carries the home as the screen to return to after creating one.
    expect(within(card).getByRole("link", { name: "Ir a Cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts?returnTo=%2Fspaces%2Fsp-personal",
    );
    expect(screen.queryByRole("region", { name: "Resumen del período" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cuentas" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the period summary and no card once an account exists", () => {
    renderWithIntl(homeWith([accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]));
    expect(screen.getByRole("region", { name: "Resumen del período" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Agrega tu primera cuenta" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agrega tu primera cuenta")).not.toBeInTheDocument();
  });

  it("speaks English in the English catalog", () => {
    renderWithIntl(homeWith([]), { locale: "en" });
    const card = screen.getByRole("region", { name: "Add your first account" });
    expect(card).toHaveTextContent("Record where your money is to start tracking it.");
    expect(within(card).getByRole("link", { name: "Go to Accounts" })).toBeInTheDocument();
  });
});

describe("the home of a shared or direct space leads to its members (N10)", () => {
  const home = (
    kind: "PERSONAL" | "SHARED" | "DIRECT",
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null,
  ) =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-shared"
        kind={kind}
        role={role}
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[]}
        context={rowContext}
      />,
    );

  it("shows Miembros and Invitar to someone who may invite, and Invitar opens the invite sheet", async () => {
    const { container } = home("SHARED", "OWNER");
    expect(screen.getByRole("link", { name: "Miembros" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/members",
    );
    expect(screen.getByRole("link", { name: "Invitar" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/members?invite=1",
    );
    for (const name of ["Miembros", "Invitar"])
      expect(screen.getByRole("link", { name })).toHaveClass("min-h-11");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows only Miembros to someone who may not invite, and in a direct space", () => {
    for (const [kind, role] of [
      ["SHARED", "MEMBER"],
      ["SHARED", "VIEWER"],
      ["DIRECT", "OWNER"],
    ] as const) {
      const { unmount } = home(kind, role);
      expect(screen.getByRole("link", { name: "Miembros" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Invitar" })).toBeNull();
      unmount();
    }
  });

  it("shows neither in a personal space", () => {
    home("PERSONAL", "OWNER");
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Invitar" })).toBeNull();
  });
});
