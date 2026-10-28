import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { AccountsScreen } from "./accounts-screen";

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
  it("still shows a wallet's Last 4 saved before the form stopped asking for it (#164)", () => {
    const wallet = accountDto({ id: "a-davi", name: "Daviplata", type: "WALLET", lastFour: "7788" });
    renderWithIntl(
      <AccountsScreen spaceId="sp-personal" list={{ ...list, items: [wallet] }} formats={BUILT_IN_FORMATS} />,
    );
    expect(norm(screen.getByRole("listitem", { name: /Daviplata/ }).textContent)).toContain("···7788");
  });

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
      "Ocultas",
    ]);
    const archived = screen.getByRole("region", { name: "Ocultas" });
    expect(within(archived).getByText("Old wallet")).toBeInTheDocument();
    expect(within(archived).getByRole("button", { name: "Mostrar Old wallet" })).toBeInTheDocument();
    expect(within(archived).queryByRole("button", { name: /^Ocultar/ })).toBeNull();
    expect(within(bank).getByRole("button", { name: "Ocultar Bancolombia" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mostrar (?!Old)/ })).toBeNull();
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
});

describe("accounts screen: the add button and the empty states (U4, U1)", () => {
  const empty = { items: [], totals: { available: cop(0), netWorth: cop(0) } };
  const fund = accountDto({
    id: "a-fund",
    name: "Fondo Hogar",
    type: "SHARED_FUND",
    balance: cop(0),
    icon: "users",
  });

  it("labels the add button with visible text, a full target, and returns to this screen", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    const add = screen.getByRole("link", { name: "Nueva cuenta" });
    expect(add).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Faccounts",
    );
    expect(add).toHaveTextContent("Nueva cuenta");
    expect(add).toHaveClass("min-h-11");
  });

  it("with no accounts explains it and offers Nueva cuenta there, once, instead of empty totals", async () => {
    const { container } = renderWithIntl(
      <AccountsScreen spaceId="sp-personal" list={empty} formats={BUILT_IN_FORMATS} />,
    );
    const emptyState = screen.getByRole("region", { name: "Aún no tienes cuentas" });
    expect(within(emptyState).getByText(/Agrega dónde tienes tu dinero/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nueva cuenta" })).toHaveLength(1);
    expect(within(emptyState).getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Faccounts",
    );
    expect(screen.queryByRole("region", { name: "Totales" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the starter accounts in a personal space's empty state (issue 169)", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={empty} formats={BUILT_IN_FORMATS} />);
    const emptyState = screen.getByRole("region", { name: "Aún no tienes cuentas" });
    // The md button is 48 px tall, above the 44 px target.
    expect(within(emptyState).getByRole("button", { name: "Crear cuentas base" })).toHaveClass("h-12");
    expect(
      within(emptyState).getByText(
        "Efectivo, cuenta bancaria, billetera digital, tarjeta de crédito y ahorros, en cero.",
      ),
    ).toBeInTheDocument();
  });

  it("with only archived accounts says none is active, offers the starter accounts and keeps the archived ones", async () => {
    const old = accountDto({
      id: "a-old",
      name: "Efectivo",
      type: "CASH",
      archivedAt: "2026-10-01T12:00:00.000Z",
    });
    const { container } = renderWithIntl(
      <AccountsScreen
        spaceId="sp-personal"
        list={{ items: [old], totals: empty.totals }}
        formats={BUILT_IN_FORMATS}
      />,
    );
    const emptyState = screen.getByRole("region", { name: "No tienes cuentas activas" });
    expect(within(emptyState).getByRole("button", { name: "Crear cuentas base" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nueva cuenta" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Totales" })).toBeNull();
    const archived = screen.getByRole("region", { name: "Ocultas" });
    expect(within(archived).getByRole("listitem", { name: /Efectivo/ })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers no starter accounts once the personal space has an active account", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    expect(screen.queryByRole("button", { name: "Crear cuentas base" })).toBeNull();
  });

  it("keeps a returnTo it was opened with, in the empty state too", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-personal"
        list={empty}
        formats={BUILT_IN_FORMATS}
        returnTo="/spaces/sp-personal"
      />,
    );
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal",
    );
  });

  it("in a shared space explains the funds, and lets an OWNER or ADMIN create the first one", async () => {
    const { container } = renderWithIntl(
      <AccountsScreen
        spaceId="sp-household"
        kind="SHARED"
        role="OWNER"
        list={empty}
        formats={BUILT_IN_FORMATS}
      />,
    );
    const note = "Cada persona paga desde sus cuentas personales; aquí solo viven los fondos del espacio.";
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.queryByText(/Agrega dónde tienes tu dinero/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear cuentas base" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Crear un fondo" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Crear un fondo" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/accounts/new?returnTo=%2Fspaces%2Fsp-household%2Faccounts",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers a member who may not create funds the explanation and no action", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-household"
        kind="SHARED"
        role="MEMBER"
        list={empty}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByText(/aquí solo viven los fondos del espacio/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Crear un fondo|Nueva cuenta|Nuevo fondo/ })).toBeNull();
  });

  it("with funds keeps the explanation and calls the add button Nuevo fondo", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-household"
        kind="SHARED"
        role="ADMIN"
        list={{ items: [fund], totals: empty.totals }}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByText(/aquí solo viven los fondos del espacio/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo fondo" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/accounts/new?returnTo=%2Fspaces%2Fsp-household%2Faccounts",
    );
    expect(screen.queryByRole("link", { name: "Nueva cuenta" })).toBeNull();
  });

  it("opens an active account's edit screen from its row, never a hidden one's (issue 169)", () => {
    renderWithIntl(<AccountsScreen spaceId="sp-personal" list={list} formats={BUILT_IN_FORMATS} />);
    const bank = screen.getByRole("listitem", { name: /Bancolombia/ });
    expect(within(bank).getByRole("link", { name: /^Bancolombia.*Editar$/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/a-bank/edit",
    );
    const hidden = screen.getByRole("region", { name: "Ocultas" });
    expect(within(hidden).queryByRole("link")).toBeNull();
  });

  it("lets an ADMIN edit a fund, and a MEMBER who may not manage funds only see it (issue 169)", () => {
    const shared = (role: "ADMIN" | "MEMBER") =>
      renderWithIntl(
        <AccountsScreen
          spaceId="sp-household"
          kind="SHARED"
          role={role}
          list={{ items: [fund], totals: empty.totals }}
          formats={BUILT_IN_FORMATS}
        />,
      );
    const admin = shared("ADMIN");
    expect(screen.getByRole("link", { name: /Editar$/ })).toHaveAttribute(
      "href",
      `/spaces/sp-household/accounts/${fund.id}/edit`,
    );
    admin.unmount();
    shared("MEMBER");
    expect(screen.queryByRole("link", { name: /Editar$/ })).toBeNull();
  });

  it("in a direct space says each person pays from their own accounts and offers nothing to create", () => {
    renderWithIntl(
      <AccountsScreen
        spaceId="sp-direct"
        kind="DIRECT"
        role="OWNER"
        list={empty}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByText(/cada una paga desde sus cuentas personales/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Crear un fondo|Nueva cuenta|Nuevo fondo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear cuentas base" })).toBeNull();
  });
});
