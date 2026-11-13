import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  activityItemDto,
  categoryDto,
  cop,
  groupDto,
  octoberPage,
  rowContext,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { es } from "@/i18n/messages/full";
import type { ActivityItemDto, MyTransactionPageDto } from "@/shared/ui/api/dto";
import { EverySpaceList } from "./every-space-list";

// The filters navigate with the router.
const mocks = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
beforeEach(() => vi.clearAllMocks());

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const list = es.ledger.list;

const PERSONAL = { id: "sp-personal", name: "Personal", kind: "PERSONAL", color: "PINE" } as const;
const HOGAR = { id: "sp-hogar", name: "Hogar", kind: "SHARED", color: "SKY" } as const;
const VIAJE = { id: "sp-viaje", name: "Viaje", kind: "DIRECT", color: "CORAL" } as const;

/** A personal movement as the API lists it beside the others: her own, recorded by her. */
const own = (tx: ActivityItemDto["transaction"]): ActivityItemDto =>
  activityItemDto({
    space: PERSONAL,
    transaction: tx,
    recordedBy: { name: null, you: true },
    you: { memberIds: [], share: null, paid: null },
  });

const hogarMarket = activityItemDto({
  space: HOGAR,
  transaction: transactionDto({
    id: "t-hogar",
    description: "Mercado del mes",
    amount: cop(180_000),
    date: "2026-10-12",
    categoryId: "c-hogar-market",
  }),
  you: { memberIds: ["m-ana"], share: cop(90_000), paid: null },
});

const page: MyTransactionPageDto = {
  period: octoberPage.period,
  totals: { share: cop(335_000), income: cop(3_200_000) },
  items: [own(octoberPage.items[0]!), hogarMarket, own(octoberPage.items[1]!)],
  nextCursor: null,
};

const hogarGroups = [
  groupDto({
    id: "g-hogar",
    name: "Casa",
    categories: [categoryDto({ id: "c-hogar-market", groupId: "g-hogar", name: "Mercado" })],
  }),
];

const spaces = [
  {
    ...PERSONAL,
    groups: rowContext.groups,
    accounts: [accountDto({ id: "a-bank", name: "Bancolombia" }), accountDto({ id: "a-visa", name: "Visa" })],
  },
  { ...HOGAR, groups: hogarGroups, accounts: [accountDto({ id: "a-fund", name: "Fondo Hogar" })] },
  { ...VIAJE, groups: [], accounts: [] },
];

const everySpace = (props: Partial<ComponentProps<typeof EverySpaceList>> = {}) => (
  <EverySpaceList
    spaceId="sp-personal"
    page={page}
    context={rowContext}
    today="2026-10-31"
    filter={{ period: "2026-10" }}
    spaces={spaces}
    periodPolicy={{ kind: "MONTHLY", day: 1 }}
    {...props}
  />
);

/** Ruling P324: every filter waits behind one Filtros button; its sheet opens each filter's own. */
const openFilters = async () => {
  await userEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  return screen.findByRole("dialog", { name: list.filters });
};
const openFilter = async (name: string | RegExp) =>
  userEvent.click(within(await openFilters()).getByRole("button", { name }));

describe("the personal Movimientos across every space (ruling P319, #294)", () => {
  it("says it gathers every space under the summary, and offers the recurring movements from the filters", async () => {
    renderWithIntl(everySpace());
    expect(screen.getByRole("heading", { level: 1, name: list.title })).toHaveClass("sr-only");
    expect(screen.getByText("Todos tus espacios, con tu parte de cada movimiento")).toHaveClass("text-muted");
    expect(within(await openFilters()).getByRole("link", { name: "Recurrentes" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/recurrences",
    );
  });

  it("reads the period and the person's share on the summary line, and draws each day without a card (P324)", () => {
    renderWithIntl(everySpace());
    expect(norm(screen.getByRole("region", { name: list.totals }).parentElement!.textContent)).toBe(
      "octubre 2026 · Tu parte $ 335.000 · Ingresos +$ 3.200.000",
    );
    for (const day of screen.getAllByRole("list")) {
      expect(day).toHaveClass("divide-y");
      expect(day).not.toHaveClass("rounded-2xl");
      expect(day).not.toHaveClass("bg-surface");
    }
  });

  it("shows another space's movement with its space chip and the person's part, opening it in its space", () => {
    renderWithIntl(everySpace());
    const row = screen.getByRole("link", { name: /Mercado del mes/ });
    expect(row).toHaveAttribute("href", "/spaces/sp-hogar?tx=t-hogar");
    expect(within(row).getByText("Hogar")).toHaveAttribute("data-space-chip");
    // Ruling P324: the day is the list's label and the amount is her part, so the line reads "Hogar · tu parte".
    expect(norm(row.textContent)).toBe("Mercado del mesHogar · tu parte−$ 90.000");
  });

  it("shows a personal movement as the personal list does, opening its sheet over the list", () => {
    renderWithIntl(everySpace());
    const row = screen.getByRole("link", { name: /Salary/ });
    expect(row).toHaveAttribute("href", "/spaces/sp-personal/transactions?period=2026-10&tx=t-salary");
    expect(row.querySelector("[data-space-chip]")).toBeNull();
    // Under its day, as today's rows.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "25/10/2026",
      "12/10/2026",
    ]);
  });

  it("reads the person's share and her income where the list's totals were", () => {
    renderWithIntl(everySpace());
    expect(norm(screen.getByRole("region", { name: list.totals }).textContent)).toBe(
      "Tu parte $ 335.000 · Ingresos +$ 3.200.000",
    );
  });

  it("offers every space in a sheet, and choosing one narrows the list by replacing the entry", async () => {
    renderWithIntl(everySpace());
    // No payer row: Pagó belongs to one shared space's list.
    const filters = await openFilters();
    expect(within(filters).queryByRole("navigation", { name: list.paidBy })).toBeNull();
    await userEvent.click(within(filters).getByRole("button", { name: "Espacio Todos los espacios" }));
    const sheet = await screen.findByRole("dialog", { name: "Ver movimientos de" });
    const rows = within(within(sheet).getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => norm(row.textContent))).toEqual([
      "Todos los espacios",
      "Personalsolo tú",
      "Hogar",
      "Viaje",
    ]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(within(rows[2]!).getByText("Hogar")).toHaveAttribute("data-space-chip");
    await userEvent.click(rows[2]!);
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&space=sp-hogar",
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("shows the chosen space as a pressed chip that lists every space again", async () => {
    renderWithIntl(everySpace({ filter: { period: "2026-10", spaceId: "sp-hogar" } }));
    expect(screen.getByRole("button", { name: "Filtros · 1" })).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Quitar el filtro Hogar" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
  });

  it("puts the filters in the board's order: period, space, category, account, type", async () => {
    renderWithIntl(everySpace());
    const rows = within(within(await openFilters()).getByRole("list")).getAllByRole("button");
    expect(rows.map((row) => norm(row.textContent))).toEqual([
      "Período octubre 2026",
      "Espacio Todos los espacios",
      `${list.filterCategory} `,
      `${list.filterAccount} `,
      `${list.filterType} `,
    ]);
  });

  it("groups the categories by space while more than one is shown (P308)", async () => {
    renderWithIntl(everySpace());
    await openFilter(list.filterCategory);
    const sheet = await screen.findByRole("dialog", { name: list.filterTitle });
    expect(within(sheet).getByRole("heading", { name: "Categorías de Personal" })).toBeInTheDocument();
    const hogar = within(sheet).getByRole("region", { name: "Categorías de Hogar" });
    await userEvent.click(within(hogar).getByRole("button", { name: "Mercado" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-hogar-market",
    );
  });

  it("names a category chosen from another space on its chip", () => {
    renderWithIntl(everySpace({ filter: { period: "2026-10", categoryId: "c-hogar-market" } }));
    expect(screen.getByRole("button", { name: "Quitar el filtro Mercado" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers only the chosen space's categories, ungrouped", async () => {
    renderWithIntl(everySpace({ filter: { period: "2026-10", spaceId: "sp-hogar" } }));
    await openFilter(list.filterCategory);
    const sheet = await screen.findByRole("dialog", { name: list.filterTitle });
    expect(within(sheet).queryByRole("heading", { name: /^Categorías de/ })).toBeNull();
    expect(within(sheet).getByRole("radio", { name: /Mercado/ })).toBeInTheDocument();
    expect(within(sheet).queryByRole("radio", { name: /Restaurants/ })).toBeNull();
  });

  it("lists the accounts of every space shown in Cuenta", async () => {
    const { unmount } = renderWithIntl(everySpace());
    await openFilter(list.filterAccount);
    const sheet = await screen.findByRole("dialog", { name: list.accountTitle });
    expect(
      within(within(sheet).getByRole("list"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Bancolombia", "Visa", "Fondo Hogar"]);
    unmount();
    renderWithIntl(everySpace({ filter: { period: "2026-10", spaceId: "sp-hogar" } }));
    await openFilter(list.filterAccount);
    const one = await screen.findByRole("dialog", { name: list.accountTitle });
    expect(
      within(within(one).getByRole("list"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Fondo Hogar"]);
  });

  it("offers payments between members, which the other spaces hold", async () => {
    renderWithIntl(everySpace());
    await openFilter(list.filterType);
    const sheet = await screen.findByRole("dialog", { name: list.typeTitle });
    expect(within(sheet).getByRole("button", { name: "Pago entre miembros" })).toBeInTheDocument();
  });

  it("asks the personal endpoint for the next 50 with the same filter and the cursor it was given", async () => {
    const next = {
      ...page,
      items: [
        activityItemDto({
          space: HOGAR,
          transaction: transactionDto({ id: "t-gas", description: "Gas", date: "2026-10-02" }),
        }),
      ],
      nextCursor: null,
    };
    const { api, requests } = fakeApi({ "GET /api/v1/me/transactions": () => jsonResponse(next) });
    renderWithIntl(
      everySpace({
        api,
        page: { ...page, nextCursor: "cur-1" },
        filter: {
          period: "2026-10",
          spaceId: "sp-hogar",
          categoryId: "c-hogar-market",
          accountId: "a-fund",
          type: "EXPENSE",
          search: "gas",
        },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: list.loadMore }));
    expect(await screen.findByRole("link", { name: /Gas/ })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-gas",
    );
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/me/transactions");
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({
      cursor: "cur-1",
      period: "2026-10",
      spaceId: "sp-hogar",
      categoryIds: "c-hogar-market",
      accountId: "a-fund",
      type: "EXPENSE",
      search: "gas",
      limit: "50",
    });
    expect(screen.queryByRole("button", { name: list.loadMore })).toBeNull();
  });
});
