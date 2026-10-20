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
    expect(within(card).getByRole("link", { name: "Ir a Cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
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
