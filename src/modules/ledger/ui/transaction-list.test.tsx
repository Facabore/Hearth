import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  cop,
  octoberExpense,
  octoberPage,
  rowContext,
  spaceDto,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import es from "@/i18n/messages/es.json";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { TransactionDetail } from "./detail/transaction-detail";
import { LoadMore } from "./load-more";
import { TransactionList } from "./transaction-list";

// The container reads the person and the client from server.ts; the filters navigate with the router.
const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  getMe: vi.fn(),
  getSpaces: vi.fn(),
  serverApi: vi.fn(),
}));
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSpaces.mockResolvedValue([spaceDto()]);
});

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

  it("shows no space name in a personal space", () => {
    renderWithIntl(
      <TransactionList spaceId="sp-personal" page={page} context={context} today="2026-10-31" filter={{}} />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Movimientos" }).nextElementSibling).toBeNull();
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
    expect(screen.getByRole("heading", { level: 2, name: "Hoy" })).toBeInTheDocument();
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

describe("the period's name (issue #178)", () => {
  it("names a calendar month the way the Plan does", () => {
    renderWithIntl(listOf({ periodPolicy: { kind: "MONTHLY", day: 1 } }));
    expect(screen.getByText("octubre 2026")).toBeInTheDocument();
    expect(screen.queryByText("Período 2026-10")).not.toBeInTheDocument();
  });
});

describe("the period and the category filter (HU-E9-03, ruling P130)", () => {
  it("steps to the neighbouring periods and keeps the chosen category", () => {
    renderWithIntl(
      listOf({ previous: other, next: later, filter: { period: "2026-10", categoryId: "c-groceries" } }),
    );
    // Issue #178: without the space's period policy the list still names the period by its label.
    expect(screen.getByText("Período 2026-10")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-09&category=c-groceries",
    );
    expect(screen.getByRole("link", { name: "Período siguiente" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-11&category=c-groceries",
    );
  });

  it("offers no link towards a period that does not exist", () => {
    renderWithIntl(listOf());
    expect(screen.queryByRole("link", { name: "Período anterior" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Período siguiente" })).toBeNull();
  });

  it("filters by the category chosen in the picker, keeping the period", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const sheet = screen.getByRole("dialog", { name: "Filtrar por categoría" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Restaurants" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-dining",
    );
  });

  it("filters by a subcategory when one is chosen", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const sheet = screen.getByRole("dialog", { name: "Filtrar por categoría" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Groceries" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith(
      "/spaces/sp-personal/transactions?period=2026-10&category=c-veg",
    );
  });

  it("shows the chosen category as a pressed chip that removes the filter and keeps the period", async () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", categoryId: "c-veg" } }));
    expect(screen.queryByRole("button", { name: "Categoría" })).toBeNull();
    const chip = screen.getByRole("button", { name: "Quitar el filtro Groceries › Vegetables" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveTextContent("Groceries › Vegetables ✕");
    await userEvent.click(chip);
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("removes the filter from a list that had no period in the address", async () => {
    renderWithIntl(listOf({ filter: { categoryId: "c-dining" } }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar el filtro Restaurants" }));
    expect(mocks.router.replace).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions");
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

  it("every row links to its detail with the list's filter kept (ruling P189)", () => {
    renderWithIntl(listOf({ filter: { period: "2026-10", categoryId: "c-groceries" } }));
    const hrefs = screen
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("link").getAttribute("href"));
    expect(hrefs).toEqual(
      ["t-salary", "t-dinner", "t-market2", "t-market1"].map(
        (id) => `/spaces/sp-personal/transactions?period=2026-10&category=c-groceries&tx=${id}`,
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

  it("reads the totals in the person's formats, whatever the language", () => {
    renderWithIntl(
      listOf({ context: { ...context, formats: { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT" } } }),
      { locale: "en" },
    );
    const totals = screen.getByRole("region", { name: "Period totals" });
    expect(norm(totals.textContent)).toBe("Expenses $ 245,000 · Income $ 3,200,000");
  });

  it("reads the totals for the chosen category, not the whole period's", () => {
    renderWithIntl(listOf({ page: { ...page, totals: { expenses: cop(185_000), income: cop(0) } } }));
    const totals = screen.getByRole("region", { name: "Totales del período" });
    expect(norm(totals.textContent)).toBe("Gastos $ 185.000 · Ingresos $ 0");
  });
});

describe("Load more (HU-E9-03, ruling P130)", () => {
  const more = [
    expense("t-bread", "Bread", 5_000, "2026-10-05", "2026-10-05T12:00:00.000Z", "c-groceries"),
    expense("t-milk", "Milk", 4_000, "2026-10-04", "2026-10-04T12:00:00.000Z", "c-groceries"),
  ];
  const answer = (cursor: string | null, items: typeof more) => () =>
    jsonResponse({ ...page, items, nextCursor: cursor });
  const loadMore = (api: Api, lastDate = "2026-10-05") => (
    <LoadMore
      spaceId="sp-personal"
      query={{ period: "2026-10", categoryIds: "c-groceries" }}
      cursor="cur-1"
      lastDate={lastDate}
      today="2026-10-31"
      context={context}
      listHref="/spaces/sp-personal/transactions?period=2026-10&category=c-groceries"
      api={api}
    />
  );
  const cursorsOf = (requests: Request[]) => requests.map((r) => new URL(r.url).searchParams.get("cursor"));

  it("links the rows it loads to their detail on the list's own address (ruling P189)", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(loadMore(api));
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

  it("asks for the next 50 with the same period and category, and the cursor it was given", async () => {
    const { api, requests } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(loadMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    const query = new URL(requests[0]!.url).searchParams;
    expect([query.get("cursor"), query.get("period"), query.get("categoryIds"), query.get("limit")]).toEqual([
      "cur-1",
      "2026-10",
      "c-groceries",
      "50",
    ]);
  });

  it("keeps a day continued from the page above under its heading, and heads the new days", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(loadMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["4/10/2026"]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("heads the first new day when it is not the day the page above ended on", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/transactions": answer(null, more) });
    renderWithIntl(loadMore(api, "2026-10-12"));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await screen.findByText("Bread");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "5/10/2026",
      "4/10/2026",
    ]);
  });

  it("follows the cursor of each page until the API has no more", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        calls++ === 0 ? answer("cur-2", more.slice(0, 1))() : answer(null, more.slice(1))(),
    });
    renderWithIntl(loadMore(api));
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
    renderWithIntl(loadMore(api));
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
    renderWithIntl(loadMore(api));
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.SpaceArchived);
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Bread")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cursorsOf(requests)).toEqual(["cur-1", "cur-1"]);
  });
});

describe("Load more inside the list (HU-E9-03, ruling P130)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is given the list's period, category and last day, through the browser client", async () => {
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
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "25/10/2026",
      "12/10/2026",
      "5/10/2026",
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

  it("marks the chosen member and keeps it when the period changes", () => {
    renderWithIntl(
      listOf({ context: shared, next: later, filter: { period: "2026-10", payerMemberId: "m-juan" } }),
    );
    const payers = screen.getByRole("navigation", { name: "Pagó" });
    expect(within(payers).getByRole("link", { name: "Juan" })).toHaveAttribute("aria-current", "page");
    expect(within(payers).getByRole("link", { name: "Todos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-10",
    );
    expect(screen.getByRole("link", { name: "Período siguiente" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?period=2026-11&payer=m-juan",
    );
  });

  it("offers none in a personal space", () => {
    renderWithIntl(listOf());
    expect(screen.queryByRole("navigation", { name: "Pagó" })).not.toBeInTheDocument();
  });
});
