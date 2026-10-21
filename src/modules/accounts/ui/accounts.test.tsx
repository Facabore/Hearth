import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadAccounts } from "./accounts-container";
import { AccountsScreen } from "./accounts-screen";

vi.mock("next/headers", () => ({}));
// The rows' archive and restore buttons (Task 13) refresh through the router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const list = {
  items: [
    accountDto({
      id: "a-bank",
      name: "Bancolombia",
      type: "BANK",
      balance: cop(4_415_000),
      institution: "Bancolombia",
      lastFour: "1203",
      color: "STEEL",
      icon: "bank",
      includeInAvailable: true,
    }),
    accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET", balance: cop(500_000), icon: "wallet" }),
    accountDto({
      id: "a-visa",
      name: "Visa",
      type: "CREDIT_CARD",
      balance: cop(-350_000),
      icon: "card",
      includeInAvailable: false,
      terms: { ...accountDto().terms, creditLimit: cop(5_000_000), paymentDay: 15 },
      derived: { ...accountDto().derived, availableCredit: cop(4_650_000), nextPaymentDate: "2026-11-15" },
    }),
    accountDto({ id: "a-old", name: "Old wallet", type: "WALLET", archivedAt: "2026-10-01T12:00:00.000Z" }),
  ],
  totals: { available: cop(4_915_000), netWorth: cop(4_565_000) },
};
const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("accounts screen (HU-E9-03)", () => {
  it("wraps the totals instead of overflowing a narrow screen, and keeps each amount whole (S2)", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    const totals = screen.getByRole("region", { name: "Totales" });
    expect(totals).toHaveClass("flex-wrap");
    expect(screen.getByText("$ 4.915.000")).toHaveClass("whitespace-nowrap");
  });

  it("shows types, balances, card figures and the space's totals", async () => {
    const { container } = renderWithIntl(
      <AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />,
    );
    const totals = screen.getByRole("region", { name: "Totales" });
    expect(norm(totals.textContent)).toContain("Disponible$ 4.915.000");
    expect(norm(totals.textContent)).toContain("Patrimonio neto$ 4.565.000");
    const bank = screen.getByRole("listitem", { name: /Bancolombia/ });
    expect(norm(bank.textContent)).toContain("$ 4.415.000");
    expect(norm(bank.textContent)).toContain("Bancolombia ···1203");
    expect(bank.querySelector("[data-icon='bank'][data-color='STEEL']")).not.toBeNull();
    expect(norm(bank.textContent)).not.toContain("fuera del disponible");
    const visa = screen.getByRole("listitem", { name: /Visa/ });
    expect(norm(visa.textContent)).toContain("−$ 350.000");
    expect(norm(visa.textContent)).toContain("Disponible $ 4.650.000");
    expect(norm(visa.textContent)).toContain("Paga antes del 15/11/2026");
    expect(norm(visa.textContent)).toContain("fuera del disponible");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Bancos, billeteras y efectivo",
      "Tarjetas de crédito",
      "Archivadas",
    ]);
    const archived = screen.getByRole("region", { name: "Archivadas" });
    expect(within(archived).getByText("Old wallet")).toBeInTheDocument();
    expect(within(archived).getByRole("button", { name: "Restaurar Old wallet" })).toBeInTheDocument();
    expect(within(archived).queryByRole("button", { name: /^Archivar/ })).toBeNull();
    expect(within(bank).getByRole("button", { name: "Archivar Bancolombia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restaurar (?!Old)/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Faccounts",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("has a Volver link to the home of the space, and the add link after the title (S1)", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal");
    expect(screen.queryByRole("link", { name: "Volver a Inicio" })).toBeNull();
  });

  it("starts the creation flow with the accounts screen as the screen to return to", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Faccounts",
    );
  });

  it("carries the returnTo it was opened with, such as the home's first-account card", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-personal"
        list={list}
        formats={BUILT_IN_FORMATS}
        returnTo="/spaces/sp-personal"
      />,
    );
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal",
    );
  });

  it("ignores a returnTo that is not a same-origin path", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-personal"
        list={list}
        formats={BUILT_IN_FORMATS}
        returnTo="//evil.example"
      />,
    );
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Faccounts",
    );
  });

  it("loads every account, archived ones included, from the API", async () => {
    const { api, requests } = fakeApi({ "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(list) });
    expect(await loadAccounts(api, "sp-personal")).toEqual({ ok: true, data: list });
    expect(new URL(requests[0]!.url).searchParams.get("archived")).toBe("true");
  });
});
