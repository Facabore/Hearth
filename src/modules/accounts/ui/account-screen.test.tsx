import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop, groupDto, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { AccountScreen, type AccountFigures } from "./account-screen";
import { AccountStatistics, wholePercent, type PaidGroup } from "./account-statistics";

const bancolombia = accountDto({ id: "a-bank", name: "Bancolombia", balance: cop(1_469_600) });
const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const figures: AccountFigures = {
  in: cop(3_200_000),
  out: cop(2_804_000),
  spent: cop(2_304_000),
  movedToOwnAccounts: cop(500_000),
};
const BASE = "/spaces/sp-personal/accounts/a-bank";

const renderScreen = (props: Partial<Parameters<typeof AccountScreen>[0]> = {}, body = <p>Rows</p>) =>
  renderWithIntl(
    <AccountScreen
      spaceId="sp-personal"
      account={bancolombia}
      editHref={`${BASE}/edit`}
      view="movements"
      movementsHref={BASE}
      statsHref={`${BASE}?view=stats`}
      period={november}
      policy={{ kind: "MONTHLY", day: 1 }}
      previousHref={`${BASE}?period=2026-10`}
      figures={figures}
      formats={BUILT_IN_FORMATS}
      {...props}
    >
      {body}
    </AccountScreen>,
  );

describe("an account's own screen (ruling P327, boards #315)", () => {
  it("names the account with a way back and Configurar, its balance today, the views, the period and what came in and went out", async () => {
    const { container } = renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Bancolombia" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.getByRole("link", { name: "Configurar" })).toHaveAttribute("href", `${BASE}/edit`);
    const balance = screen.getByRole("region", { name: "Saldo de hoy" });
    expect(normalized(balance.textContent)).toBe("Saldo de hoy$ 1.469.600");
    const views = screen.getByRole("navigation", { name: "Vistas de la cuenta" });
    expect(within(views).getByRole("link", { name: "Movimientos" })).toHaveAttribute("aria-current", "page");
    expect(within(views).getByRole("link", { name: "Estadísticas" })).toHaveAttribute(
      "href",
      `${BASE}?view=stats`,
    );
    expect(screen.getByText("noviembre 2026")).toBeVisible();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      `${BASE}?period=2026-10`,
    );
    // The current period has no step past it.
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
    expect(normalized(container.querySelector("[data-account-figures]")!.textContent)).toBe(
      "entró +$ 3.200.000 · salió −$ 2.804.000",
    );
    expect(screen.getByText("Rows")).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no Configurar to whoever may not manage the account", () => {
    renderScreen({ editHref: undefined });
    expect(screen.queryByRole("link", { name: "Configurar" })).toBeNull();
  });

  it("on Estadísticas says what it spent and what it moved to her accounts, and only what it spent when it moved nothing", () => {
    const { container, unmount } = renderScreen({ view: "stats" });
    const views = screen.getByRole("navigation", { name: "Vistas de la cuenta" });
    expect(within(views).getByRole("link", { name: "Estadísticas" })).toHaveAttribute("aria-current", "page");
    expect(normalized(container.querySelector("[data-account-figures]")!.textContent)).toBe(
      "gastó $ 2.304.000 · movió $ 500.000 a tus cuentas",
    );
    unmount();
    const fund = renderScreen({ view: "stats", figures: { ...figures, movedToOwnAccounts: cop(0) } });
    expect(normalized(fund.container.querySelector("[data-account-figures]")!.textContent)).toBe(
      "gastó $ 2.304.000",
    );
  });

  it("leaves the figures out when they could not be read, and keeps the movements", () => {
    const { container } = renderScreen({ figures: null });
    expect(container.querySelector("[data-account-figures]")).toBeNull();
    expect(screen.getByText("Rows")).toBeVisible();
  });
});

const paid: PaidGroup[] = [
  {
    id: "g-home",
    key: "housing",
    name: "Vivienda",
    total: cop(2_000_000),
    share: "86.81",
    movements: 1,
    categories: [{ name: "Arriendo" }],
  },
  {
    id: null,
    key: "utilities",
    name: "Servicios",
    total: cop(240_000),
    share: "10.42",
    movements: 1,
    categories: [{ name: "Luz, agua y gas" }],
  },
  {
    id: "g-food",
    key: "food",
    name: "Restaurantes",
    total: cop(64_000),
    share: "2.78",
    movements: 2,
    categories: [{ name: "Domicilios" }],
  },
];

describe("an account's statistics (ruling P327, board 'Cuenta · Estadísticas · #315')", () => {
  it("lists each group it paid with its whole share, its categories, how many expenses, the amount and a bar", async () => {
    const { container } = renderWithIntl(
      <AccountStatistics
        groups={paid}
        looks={[groupDto({ id: "g-home", name: "Vivienda" }), groupDto({ id: "g-x", key: "utilities" })]}
        formats={BUILT_IN_FORMATS}
      />,
    );
    const rows = within(screen.getByRole("list", { name: "En qué se gastó" })).getAllByRole("listitem");
    expect(rows.map((row) => normalized(row.textContent))).toEqual([
      "Vivienda87 % · Arriendo · 1 movimiento$ 2.000.000",
      "Servicios10 % · Luz, agua y gas · 1 movimiento$ 240.000",
      "Restaurantes3 % · Domicilios · 2 movimientos$ 64.000",
    ]);
    expect([...container.querySelectorAll<HTMLElement>("[data-bar]")].map((bar) => bar.style.width)).toEqual([
      "86.81%",
      "10.42%",
      "2.78%",
    ]);
    expect(screen.getByText("Las transferencias entre tus cuentas no cuentan como gasto.")).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says the account paid nothing in a period without expenses, and still notes transfers are no spending", () => {
    renderWithIntl(<AccountStatistics groups={[]} looks={[]} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByText("Esta cuenta no pagó gastos en este período.")).toBeVisible();
    expect(screen.getByText("Las transferencias entre tus cuentas no cuentan como gasto.")).toBeVisible();
  });

  it("rounds a share to a whole percent, half up", () => {
    expect(["86.81", "10.42", "2.50", "2.49", "0.00", "100.00"].map(wholePercent)).toEqual([
      "87",
      "10",
      "3",
      "2",
      "0",
      "100",
    ]);
  });
});
