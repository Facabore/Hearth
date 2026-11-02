import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  accountDto,
  cop,
  octoberExpense,
  octoberPage,
  rowContext,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { es } from "@/i18n/messages/full";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { TransactionDetail } from "./detail/transaction-detail";
import { TransactionList } from "./transaction-list";

// The filters navigate with the router.
const mocks = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
beforeEach(() => vi.clearAllMocks());

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const page = octoberPage;
const context = rowContext;
const expense = octoberExpense;

describe("transaction list (HU-E9-03)", () => {
  it("names the space under the title when it is a shared or direct one, so a move into it is no surprise (U7)", () => {
    renderWithIntl(
      <TransactionList
        spaceId="sp-direct"
        spaceName="Ana & Juan"
        page={page}
        context={context}
        today="2026-10-31"
        filter={{}}
      />,
    );
    const title = screen.getByRole("heading", { level: 1, name: "Movimientos" });
    expect(title.nextElementSibling).toHaveTextContent("Ana & Juan");
  });

  it("offers the space's recurring movements beside the title, in every space (P270)", () => {
    renderWithIntl(
      <TransactionList spaceId="sp-personal" page={page} context={context} today="2026-10-31" filter={{}} />,
    );
    const pill = screen.getByRole("link", { name: "Recurrentes" });
    expect(pill).toHaveAttribute("href", "/spaces/sp-personal/recurrences");
    // Board E9-09 01: a 44 px white pill with a border, its calendar icon and a 15 px label.
    expect(pill).toHaveClass("min-h-11", "rounded-full", "border", "bg-surface", "text-[15px]");
    expect(pill.querySelector("svg")).not.toBeNull();
  });

  it("shows no space name in a personal space, under a large page title (board B1 06)", () => {
    renderWithIntl(
      <TransactionList spaceId="sp-personal" page={page} context={context} today="2026-10-31" filter={{}} />,
    );
    const title = screen.getByRole("heading", { level: 1, name: "Movimientos" });
    expect(title.nextElementSibling).toBeNull();
    expect(title).toHaveClass("text-[26px]", "font-bold");
  });

  it("groups by day, newest first, with times, category paths and the period totals", async () => {
    const { container } = renderWithIntl(
      <TransactionList
        spaceId="sp-personal"
        page={page}
        context={context}
        today="2026-10-31"
        filter={{ period: "2026-10" }}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "25/10/2026",
      "12/10/2026",
      "5/10/2026",
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => within(r).getByText(/Dinner|Market|Salary/).textContent)).toEqual([
      "Salary",
      "Dinner",
      "Market",
      "Market",
    ]);
    expect(rows[1]).toHaveTextContent("20:45");
    expect(rows[2]).toHaveTextContent("Groceries › Vegetables");
    expect(rows[0]).not.toHaveTextContent(/\d{2}:\d{2}/);
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(norm(totals.textContent)).toContain("$ 245.000");
    expect(norm(totals.textContent)).toContain("$ 3.200.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a transfer between accounts without a category, and a record's own zone", () => {
    const transfer = transactionDto({
      id: "t-pay",
      type: "TRANSFER",
      description: "",
      amount: cop(200_000),
      date: "2026-10-25",
      occurredAt: "2026-10-25T15:00:00.000Z",
      timeZone: "America/Bogota",
      sourceAccountId: "a-bank",
      destinationAccountId: "a-visa",
    });
    const madrid = {
      ...expense("t-mad", "Tapas", 30_000, "2026-10-31", "2026-11-01T04:30:00.000Z", "c-dining"),
      timeZone: "Europe/Madrid",
    };
    renderWithIntl(
      <TransactionList
        spaceId="sp-personal"
        page={{ ...page, items: [madrid, transfer] }}
        context={context}
        today="2026-10-31"
        filter={{}}
      />,
    );
    const [mad, pay] = screen.getAllByRole("listitem");
    expect(mad).toHaveTextContent("05:30 · Madrid");
    expect(screen.getByRole("heading", { level: 2, name: "Hoy · 31/10/2026" })).toBeInTheDocument();
    expect(pay).toHaveTextContent("Bancolombia → Visa");
    expect(pay).toHaveTextContent("Transferencia");
    expect(pay).not.toHaveTextContent("Groceries");
  });
});

const other = { label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" };
const later = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const listOf = (props: Partial<ComponentProps<typeof TransactionList>> = {}) => (
  <TransactionList
    spaceId="sp-personal"
    page={page}
    context={context}
    today="2026-10-31"
    filter={{ period: "2026-10" }}
    {...props}
  />
);

describe("the period chip (board B1 06, ruling P277)", () => {
  const monthly = { kind: "MONTHLY", day: 1 } as const;
  const august = { label: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31" };
  const december = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };

  it("names the period on a chip, as the Plan names it (issue #178), instead of arrows", () => {
    renderWithIntl(listOf({ periodPolicy: monthly, previous: other, next: later }));
    const chip = screen.getByRole("button", { name: "octubre 2026" });
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip).toHaveClass("rounded-full", "bg-ink");
    expect(screen.queryByText("Período 2026-10")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Período anterior" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
  });

  it("names the period by its label without the space's policy (issue #178)", () => {
    renderWithIntl(listOf());
    expect(screen.getByRole("button", { name: "Período 2026-10" })).toBeInTheDocument();
  });

  it("opens the periods up to today and the next one, newest first, each keeping the filters", async () => {
    renderWithIntl(
      listOf({
        periodPolicy: monthly,
        previous: other,
        next: later,
        periods: [august, other, page.period, later, december],
        filter: { period: "2026-10", categoryId: "c-groceries" },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "octubre 2026" }));
    const sheet = await screen.findByRole("dialog", { name: "Elegir período" });
    const links = within(sheet).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "noviembre 2026",
      "octubre 2026",
      "septiembre 2026",
      "agosto 2026",
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
    expect(links[2]).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-09&category=c-groceries",
    );
  });

  it("still offers the neighbours before the periods are read, and none that does not exist", async () => {
    renderWithIntl(listOf({ previous: other }));
    await userEvent.click(screen.getByRole("button", { name: "Período 2026-10" }));
    const sheet = await screen.findByRole("dialog", { name: "Elegir período" });
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/spaces/sp-personal/transactions?period=2026-10",
      "/spaces/sp-personal/transactions?period=2026-09",
    ]);
  });
});

describe("the category filter (HU-E9-03, ruling P130)", () => {
  it("filters by the category chosen in the picker, keeping the period", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por categoría" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Restaurants" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-dining",
    );
  });

  it("filters by a subcategory when one is chosen", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por categoría" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Groceries" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-veg",
    );
  });

  it("shows the chosen category as a pressed chip that removes the filter and keeps the others", async () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", categoryId: "c-veg", search: "pan" } }));
    expect(screen.queryByRole("button", { name: "Categoría" })).toBeNull();
    const chip = screen.getByRole("button", { name: "Quitar el filtro Groceries › Vegetables" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("Groceries › Vegetables ✕");
    await userEvent.click(chip);
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&q=pan",
    );
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("removes the filter from a list that had no period in the address", async () => {
    renderWithIntl(listOf({ filter: { categoryId: "c-dining" } }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar el filtro Restaurants" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions");
  });
});

describe("the search (board B1 06, ruling P277)", () => {
  it("searches once the person pauses typing, keeping the other filters", async () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", categoryId: "c-groceries" } }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar" }), "mercado");
    await waitFor(() =>
      expect(mocks.router.replace).toHaveBeenLastCalledWith(
        "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&q=mercado",
      ),
    );
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("searches at once on Enter, without the spaces around the words", async () => {
    renderWithIntl(listOf());
    await userEvent.type(screen.getByRole("searchbox", { name: "Buscar" }), " taxi {Enter}");
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&q=taxi",
    );
  });

  it("keeps what the person typed after a search when that search's answer arrives late", async () => {
    const { rerender } = renderWithIntl(listOf({ filter: { period: "2026-10" } }));
    const field = screen.getByRole("searchbox", { name: "Buscar" });
    await userEvent.type(field, "din{Enter}");
    await userEvent.type(field, "n");
    // The list for "din" arrives while the field already holds "dinn".
    rerender(listOf({ filter: { period: "2026-10", search: "din" } }));
    expect(field).toHaveValue("dinn");
    await userEvent.type(field, "{Enter}");
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&q=dinn",
    );
  });

  it("offers its own clear button, a full target, which lists everything again and keeps the focus", async () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", search: "taxi" } }));
    const field = screen.getByRole("searchbox", { name: "Buscar" });
    const clear = screen.getByRole("button", { name: "Borrar la búsqueda" });
    expect(clear).toHaveClass("size-11");
    await userEvent.click(clear);
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
    expect(screen.queryByRole("button", { name: "Borrar la búsqueda" })).not.toBeInTheDocument();
  });

  it("shows an earlier search again when the person goes back to it", async () => {
    const { rerender } = renderWithIntl(listOf({ filter: { period: "2026-10" } }));
    const field = screen.getByRole("searchbox", { name: "Buscar" });
    await userEvent.type(field, "taxi{Enter}");
    rerender(listOf({ filter: { period: "2026-10", search: "taxi" } }));
    await userEvent.clear(field);
    await userEvent.type(field, "din{Enter}");
    rerender(listOf({ filter: { period: "2026-10", search: "din" } }));
    // Back, to the earlier search and then to the list without one.
    rerender(listOf({ filter: { period: "2026-10", search: "taxi" } }));
    expect(field).toHaveValue("taxi");
    rerender(listOf({ filter: { period: "2026-10" } }));
    expect(field).toHaveValue("");
  });

  it("shows the address's search in the field, and an emptied field lists everything again", async () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", search: "taxi" } }));
    const field = screen.getByRole("searchbox", { name: "Buscar" });
    expect(field).toHaveValue("taxi");
    await userEvent.clear(field);
    await userEvent.type(field, "{Enter}");
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
  });
});

describe("the account and type filters (board B1 06, ruling P277)", () => {
  const accounts = [
    accountDto({ id: "a-bank", name: "Bancolombia" }),
    accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" }),
  ];

  it("filters by the account chosen in its sheet, keeping the other filters", async () => {
    renderWithIntl(listOf({ accounts, filter: { period: "2026-10", categoryId: "c-groceries" } }));
    await userEvent.click(screen.getByRole("button", { name: "Cuenta" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por cuenta" });
    expect(
      within(within(sheet).getByRole("list"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Bancolombia", "Visa"]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Visa" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&acct=a-visa",
    );
  });

  it("shows the chosen account as a pressed chip that removes it", async () => {
    renderWithIntl(listOf({ accounts, filter: { period: "2026-10", accountId: "a-visa" } }));
    const chip = screen.getByRole("button", { name: "Quitar el filtro Visa" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
  });

  it("offers active accounts only, and no account filter in a space without one", async () => {
    const hidden = accountDto({ id: "a-gone", name: "Gone", archivedAt: "2026-01-01T00:00:00.000Z" });
    const { unmount } = renderWithIntl(listOf({ accounts: [...accounts, hidden] }));
    await userEvent.click(screen.getByRole("button", { name: "Cuenta" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por cuenta" });
    expect(within(sheet).queryByRole("button", { name: "Gone" })).toBeNull();
    unmount();
    renderWithIntl(listOf({ accounts: [] }));
    expect(screen.queryByRole("button", { name: "Cuenta" })).toBeNull();
  });

  it("filters by the type chosen in its sheet; a personal space has no payments between members", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Tipo" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtrar por tipo" });
    const options = within(sheet).getByRole("list");
    expect(
      within(options)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Gasto", "Ingreso", "Transferencia"]);
    await userEvent.click(within(options).getByRole("button", { name: "Ingreso" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&type=INCOME",
    );
  });

  it("offers payments between members in a shared space, and the chosen type removes itself", async () => {
    const shared = { ...context, memberNames: { "m-ana": "Ana", "m-juan": "Juan" } };
    const { unmount } = renderWithIntl(listOf({ context: shared }));
    await userEvent.click(screen.getByRole("button", { name: "Tipo" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Filtrar por tipo" })).getByRole("button", {
        name: "Pago entre miembros",
      }),
    ).toBeInTheDocument();
    unmount();
    renderWithIntl(listOf({ context: shared, filter: { period: "2026-10", type: "SETTLEMENT" } }));
    const chip = screen.getByRole("button", { name: "Quitar el filtro Pago entre miembros" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip);
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
  });
});

describe("the days and their totals (board B1 06, ruling P277)", () => {
  const sections = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.closest("section")!);
  const headerOf = (section: HTMLElement | undefined) => norm(section!.querySelector("header")!.textContent);

  it("heads each day with today's or yesterday's name and its date, and the day's total", async () => {
    const taxi = expense("t-taxi", "Taxi", 18_000, "2026-10-31", null, "c-dining");
    const { container } = renderWithIntl(listOf({ page: { ...page, items: [taxi, ...page.items] } }));
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "Hoy · 31/10/2026",
      "25/10/2026",
      "12/10/2026",
      "5/10/2026",
    ]);
    expect(headings[0]).toHaveClass("uppercase");
    expect(sections().map(headerOf)).toEqual([
      "Hoy · 31/10/2026Total del día−$ 18.000",
      "25/10/2026Total del día+$ 3.200.000",
      "12/10/2026Total del día−$ 160.000",
      "5/10/2026Total del día−$ 85.000",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("gives a day of transfers only no total", () => {
    const transfer = transactionDto({
      id: "t-pay",
      type: "TRANSFER",
      amount: cop(500_000),
      date: "2026-10-06",
      sourceAccountId: "a-bank",
      destinationAccountId: "a-visa",
    });
    renderWithIntl(listOf({ page: { ...page, items: [transfer] } }));
    expect(headerOf(sections()[0])).toBe("6/10/2026");
  });

  it("draws each row as a card of its own", () => {
    renderWithIntl(listOf());
    for (const row of screen.getAllByRole("listitem")) expect(row).toHaveClass("rounded-2xl", "bg-surface");
  });

  it("totals the last day only once no next page may hold more of it", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        jsonResponse({
          ...page,
          items: [expense("t-bread", "Bread", 5_000, "2026-10-05", null, "c-groceries")],
          nextCursor: null,
        }),
    });
    renderWithIntl(listOf({ page: { ...page, nextCursor: "cur-1" }, api }));
    expect(headerOf(sections().at(-1))).toBe("5/10/2026");
    expect(headerOf(sections()[1])).toBe("12/10/2026Total del día−$ 160.000");
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "25/10/2026",
      "12/10/2026",
      "5/10/2026",
    ]);
    expect(headerOf(sections().at(-1))).toBe("5/10/2026Total del día−$ 90.000");
  });
});

describe("saved with a warning in the list (HU-E9-06, ruling P170)", () => {
  const notice = { accountName: "Fondo Hogar", balance: cop(-500_000) };

  it("shows the fund's notice above the totals, and its dismiss link keeps the period and the category", () => {
    renderWithIntl(listOf({ notice, filter: { period: "2026-10", categoryId: "c-groceries" } }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Gasto guardado");
    expect(norm(status.textContent)).toContain("El saldo de Fondo Hogar quedó en −$ 500.000.");
    expect(screen.getByRole("link", { name: "Cerrar aviso" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries",
    );
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(status.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dismisses to the plain list when the address had no filter, and shows no notice without one", () => {
    const first = renderWithIntl(listOf({ notice, filter: {} }));
    expect(screen.getByRole("link", { name: "Cerrar aviso" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    first.unmount();
    renderWithIntl(listOf());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("the list's states (HU-E9-03, ruling P140)", () => {
  it("says so when the period has no transactions", () => {
    renderWithIntl(listOf({ page: { ...page, items: [], totals: { expenses: cop(0), income: cop(0) } } }));
    expect(screen.getByText("No hay movimientos en este período.")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
  });

  it("offers Load more only while the API has a next page", () => {
    const { unmount } = renderWithIntl(listOf());
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    unmount();
    renderWithIntl(listOf({ page: { ...page, nextCursor: "cur-1" } }));
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeInTheDocument();
  });

  it("gives a row one link to its detail and no other control: editing happens in the sheet (ruling P189)", () => {
    renderWithIntl(listOf());
    for (const row of screen.getAllByRole("listitem")) {
      expect(within(row).queryAllByRole("button")).toEqual([]);
      expect(within(row).getAllByRole("link")).toHaveLength(1);
    }
  });

  it("every row links to its detail with the list's filters kept (ruling P189)", () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", categoryId: "c-groceries", type: "EXPENSE" } }));
    const hrefs = screen
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("link").getAttribute("href"));
    expect(hrefs).toEqual(
      ["t-salary", "t-dinner", "t-market2", "t-market1"].map(
        (id) => `/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&type=EXPENSE&tx=${id}`,
      ),
    );
  });

  it("links a row of the plain list to ?tx= alone", () => {
    renderWithIntl(listOf({ filter: {} }));
    expect(within(screen.getAllByRole("listitem")[0]!).getByRole("link")).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?tx=t-salary",
    );
  });

  it("opens the detail sheet only when the page was given one, and closes it to the list's address", async () => {
    const detail: TransactionDetail = {
      tx: octoberPage.items[1]!,
      problem: null,
      members: [],
      viewer: { userId: "u-ana", role: "OWNER", memberId: null },
      ownAccountNames: {},
    };
    const { rerender } = renderWithIntl(listOf());
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(listOf({ detail }));
    expect(await screen.findByRole("dialog", { name: "Dinner" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    // The origin is the list's own address (period kept, tx gone): closing never re-shows a dismissed notice.
    expect(mocks.router.replace).toHaveBeenCalledWith("/spaces/sp-personal/transactions?period=2026-10", {
      scroll: false,
    });
  });

  it("reads the totals in the person's formats, whatever the language, the income with its plus sign", () => {
    renderWithIntl(
      listOf({ context: { ...context, formats: { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" } } }),
      { locale: "en" },
    );
    const totals = screen.getByRole("region", { name: "Period totals" });
    expect(norm(totals.textContent)).toBe("Expenses $ 245,000 · Income +$ 3,200,000");
  });

  it("reads the totals as plain text with bold figures and the income in green (board B1 06)", () => {
    renderWithIntl(listOf());
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(totals).not.toHaveClass("bg-surface");
    expect(within(totals).getByText("$ 245.000").tagName).toBe("STRONG");
    expect(within(totals).getByText("+$ 3.200.000")).toHaveClass("text-accent");
  });

  it("reads the totals for the chosen category, not the whole period's, and no sign on a zero income", () => {
    renderWithIntl(listOf({ page: { ...page, totals: { expenses: cop(185_000), income: cop(0) } } }));
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(norm(totals.textContent)).toBe("Gastos $ 185.000 · Ingresos $ 0");
    expect(within(totals).getByText("$ 0")).not.toHaveClass("text-accent");
  });
});

describe("Load more (HU-E9-03, ruling P130)", () => {
  const more = [
    expense("t-bread", "Bread", 5_000, "2026-10-05", "2026-10-05T12:00:00.000Z", "c-groceries"),
    expense("t-milk", "Milk", 4_000, "2026-10-04", "2026-10-04T12:00:00.000Z", "c-groceries"),
  ];
  const answer = (cursor: string | null, items: typeof more) => () =>
    jsonResponse({ ...page, items, nextCursor: cursor });
  const filter = { period: "2026-10", categoryId: "c-groceries" };
  const listWithMore = (api: Api, items = page.items) =>
    listOf({ api, filter, page: { ...page, items, nextCursor: "cur-1" } });
  const cursorsOf = (requests: Request[]) => requests.map((r) => new URL(r.url).searchParams.get("cursor"));

  it("links the rows it loads to their detail on the list's own address (ruling P189)", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(listWithMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    expect(screen.getByRole("link", { name: /Bread/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&tx=t-bread",
    );
    expect(screen.getByRole("link", { name: /Milk/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&tx=t-milk",
    );
  });

  it("asks for the next 50 with the same filters, and the cursor it was given", async () => {
    const { api, requests } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(
      listOf({
        api,
        filter: { ...filter, payerMemberId: "m-ana", accountId: "a-bank", type: "EXPENSE", search: "pan" },
        page: { ...page, nextCursor: "cur-1" },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    const query = new URL(requests[0]!.url).searchParams;
    expect(Object.fromEntries(query)).toEqual({
      cursor: "cur-1",
      period: "2026-10",
      categoryIds: "c-groceries",
      payerMemberId: "m-ana",
      accountId: "a-bank",
      type: "EXPENSE",
      search: "pan",
      limit: "50",
    });
  });

  it("keeps a day continued from the page above under its heading, and heads the new days", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(listWithMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "25/10/2026",
      "12/10/2026",
      "5/10/2026",
      "4/10/2026",
    ]);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("follows the cursor of each page until the API has no more", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        calls++ === 0 ? answer("cur-2", more.slice(0, 1))() : answer(null, more.slice(1))(),
    });
    renderWithIntl(listWithMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Milk");
    expect(cursorsOf(requests)).toEqual(["cur-1", "cur-2"]);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("disables the button while it loads, so a double click asks once", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": async () => {
        await gate;
        return answer(null, more)();
      },
    });
    renderWithIntl(listWithMore(api));
    const button = screen.getByRole("button", { name: "Cargar más" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    release();
    await screen.findByText("Bread");
    expect(requests).toHaveLength(1);
  });

  it("shows the problem's message and lets the person try again with the same cursor", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        calls++ === 0 ? problemResponse(409, "SpaceArchived") : answer(null, more)(),
    });
    renderWithIntl(listWithMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.SpaceArchived);
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cursorsOf(requests)).toEqual(["cur-1", "cur-1"]);
  });

  it("drops the rows it loaded when the filters change", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    const { rerender } = renderWithIntl(listWithMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    rerender(listOf({ api, filter: { ...filter, search: "mar" }, page: { ...page, nextCursor: "cur-9" } }));
    expect(screen.queryByText("Bread")).toBeNull();
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeEnabled();
  });
});

describe("Load more inside the list (HU-E9-03, ruling P130)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("goes through the browser client when the list is given none", async () => {
    const fetched = vi.fn<(request: Request) => Promise<Response>>(async () =>
      jsonResponse({
        ...page,
        items: [expense("t-bread", "Bread", 5_000, "2026-10-05", "2026-10-05T12:00:00.000Z", "c-groceries")],
        nextCursor: null,
      }),
    );
    vi.stubGlobal("fetch", fetched);
    renderWithIntl(
      listOf({
        page: { ...page, nextCursor: "cur-1" },
        filter: { period: "2026-10", categoryId: "c-groceries" },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    const query = new URL((fetched.mock.calls[0]![0] as Request).url).searchParams;
    expect([query.get("cursor"), query.get("period"), query.get("categoryIds")]).toEqual([
      "cur-1",
      "2026-10",
      "c-groceries",
    ]);
  });
});

describe("the payer filter (issue #148)", () => {
  const shared = { ...context, memberNames: { "m-ana": "Ana", "m-juan": "Juan" } };

  it("offers Todos and each member as links that keep the period and category", () => {
    renderWithIntl(listOf({ context: shared, filter: { period: "2026-10", categoryId: "c-groceries" } }));
    const payers = screen.getByRole("navigation", { name: "Pagó" });
    expect(within(payers).getByRole("link", { name: "Todos" })).toHaveAttribute("aria-current", "page");
    expect(within(payers).getByRole("link", { name: "Juan" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&payer=m-juan",
    );
  });

  it("marks the chosen member and keeps it in the period chip's links", async () => {
    renderWithIntl(
      listOf({ context: shared, next: later, filter: { period: "2026-10", payerMemberId: "m-juan" } }),
    );
    const payers = screen.getByRole("navigation", { name: "Pagó" });
    expect(within(payers).getByRole("link", { name: "Juan" })).toHaveAttribute("aria-current", "page");
    expect(within(payers).getByRole("link", { name: "Todos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10",
    );
    await userEvent.click(screen.getByRole("button", { name: "Período 2026-10" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Elegir período" })).getByRole("link", {
        name: "Período 2026-11",
      }),
    ).toHaveAttribute("href", "/spaces/sp-personal/transactions?period=2026-11&payer=m-juan");
  });

  it("offers none in a personal space", () => {
    renderWithIntl(listOf());
    expect(screen.queryByRole("navigation", { name: "Pagó" })).not.toBeInTheDocument();
  });

  describe("members no movement touched (#217, P263)", () => {
    const household = {
      ...context,
      memberNames: { "m-ana": "Ana", "m-juan": "Juan", "m-sofi": "Sofi", "m-pedro": "Pedro (invitado)" },
    };
    const payerNames = () =>
      within(screen.getByRole("navigation", { name: "Pagó" }))
        .getAllByRole("link")
        .map((link) => link.textContent);

    it("leaves them out of the filter, and the rows still name everyone", () => {
      renderWithIntl(listOf({ context: household, movedMemberIds: ["m-ana", "m-juan"] }));
      expect(payerNames()).toEqual(["Todos", "Ana", "Juan"]);
    });

    it("keeps the chosen member even when no movement touched them", () => {
      renderWithIntl(
        listOf({
          context: household,
          movedMemberIds: ["m-ana", "m-juan"],
          filter: { period: "2026-10", payerMemberId: "m-sofi" },
        }),
      );
      expect(payerNames()).toEqual(["Todos", "Ana", "Juan", "Sofi"]);
    });

    it("offers no filter when only one member has movements", () => {
      renderWithIntl(listOf({ context: household, movedMemberIds: ["m-ana"] }));
      expect(screen.queryByRole("navigation", { name: "Pagó" })).not.toBeInTheDocument();
    });

    it("offers every member when nobody says who moved", () => {
      renderWithIntl(listOf({ context: household }));
      expect(payerNames()).toEqual(["Todos", "Ana", "Juan", "Sofi", "Pedro (invitado)"]);
    });
  });
});
