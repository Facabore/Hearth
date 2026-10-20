import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  cop,
  meDto,
  octoberExpense,
  octoberPage,
  rowContext,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import es from "@/i18n/messages/es.json";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LoadMore } from "./load-more";
import { TransactionList } from "./transaction-list";
import { loadTransactionList, TransactionListContainer } from "./transaction-list-container";

// The container reads the person and the client from server.ts; the filters navigate with the router.
const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
  getMe: vi.fn(),
  serverApi: vi.fn(),
}));
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: mocks.getMe,
  serverApi: mocks.serverApi,
}));
beforeEach(() => vi.clearAllMocks());

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const page = octoberPage;
const context = rowContext;
const groups = rowContext.groups;
const expense = octoberExpense;

describe("transaction list (HU-E9-03)", () => {
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

  it("asks the API for the chosen category's period and shows its total", async () => {
    const filtered = {
      ...page,
      totals: { expenses: cop(185_000), income: cop(0) },
      items: page.items.slice(2),
    };
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(filtered),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [page.period] }),
    });
    const result = await loadTransactionList(api, {
      spaceId: "sp-personal",
      period: "2026-10",
      categoryId: "c-groceries",
    });
    const query = new URL(requests[0]!.url).searchParams;
    expect([query.get("period"), query.get("categoryIds"), query.get("limit")]).toEqual([
      "2026-10",
      "c-groceries",
      "50",
    ]);
    expect(result.ok && result.data.page.items).toHaveLength(2);
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

describe("the period and the category filter (HU-E9-03, ruling P130)", () => {
  it("steps to the neighbouring periods and keeps the chosen category", () => {
    renderWithIntl(
      listOf({ previous: other, next: later, filter: { period: "2026-10", categoryId: "c-groceries" } }),
    );
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
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("filters by the category chosen in the picker, keeping the period", async () => {
    renderWithIntl(listOf());
    await userEvent.click(screen.getByRole("button", { name: "Categoría" }));
    const sheet = screen.getByRole("dialog", { name: "Filtrar por categoría" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Restaurants" }));
    expect(mocks.router.push).toHaveBeenLastCalledWith(
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
    expect(mocks.router.push).toHaveBeenLastCalledWith(
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
    expect(mocks.router.push).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions?period=2026-10");
  });

  it("removes the filter from a list that had no period in the address", async () => {
    renderWithIntl(listOf({ filter: { categoryId: "c-dining" } }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar el filtro Restaurants" }));
    expect(mocks.router.push).toHaveBeenLastCalledWith("/spaces/sp-personal/transactions");
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

  it("is read-only in M6a: no row has an edit, delete or any other control", () => {
    renderWithIntl(listOf());
    for (const row of screen.getAllByRole("listitem")) {
      expect(within(row).queryAllByRole("button")).toEqual([]);
      expect(within(row).queryAllByRole("link")).toEqual([]);
    }
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
      api={api}
    />
  );
  const cursorsOf = (requests: Request[]) => requests.map((r) => new URL(r.url).searchParams.get("cursor"));

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

describe("what the list loads (HU-E9-03, ruling P130)", () => {
  const routes = (periods: (request: Request) => Response) => ({
    "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(page),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
    "GET /api/v1/spaces/{spaceId}/periods": periods,
  });

  it("names rows with archived categories and accounts, and finds the periods around this one", async () => {
    const { api, requests } = fakeApi(
      routes((request) => {
        const from = new URL(request.url).searchParams.get("from");
        return jsonResponse({ items: [from === "2026-09-30" ? other : later] });
      }),
    );
    const result = await loadTransactionList(api, { spaceId: "sp-personal", period: "2026-10" });
    const queryOf = (path: string) =>
      requests.filter((r) => new URL(r.url).pathname.endsWith(path)).map((r) => new URL(r.url).searchParams);
    expect(queryOf("/categories").map((q) => q.get("archived"))).toEqual(["true"]);
    expect(queryOf("/accounts").map((q) => q.get("archived"))).toEqual(["true"]);
    expect(queryOf("/periods").map((q) => [q.get("from"), q.get("count")])).toEqual([
      ["2026-09-30", "1"],
      ["2026-11-01", "1"],
    ]);
    expect(result.ok && [result.data.previous?.label, result.data.next?.label]).toEqual([
      "2026-09",
      "2026-11",
    ]);
  });

  it("has no neighbour where the API knows no period, and fails with the page's problem", async () => {
    const empty = fakeApi(routes(() => jsonResponse({ items: [] })));
    const result = await loadTransactionList(empty.api, { spaceId: "sp-personal" });
    expect(result.ok && [result.data.previous, result.data.next]).toEqual([null, null]);
    const failing = fakeApi({
      ...routes(() => jsonResponse({ items: [] })),
      "GET /api/v1/spaces/{spaceId}/transactions": () => problemResponse(409, "SpaceArchived"),
    });
    expect(await loadTransactionList(failing.api, { spaceId: "sp-personal" })).toMatchObject({
      ok: false,
      problem: { code: "SpaceArchived" },
    });
  });
});

describe("the list container (HU-E9-03, HU-E9-02)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads today in the person's zone and every format from their preferences", async () => {
    vi.stubEnv("HEARTH_E2E_FIXED_NOW", "2026-11-01T04:30:00.000Z");
    const me = meDto({
      timezone: "America/Bogota",
      locale: "en",
      preferences: {
        ...meDto().preferences,
        effective: { numberFormat: "COMMA_DOT", dateFormat: "MDY", timeFormat: "H12", weekStart: "SUNDAY" },
      },
    });
    mocks.getMe.mockResolvedValue(me);
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(page),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [{ id: "a-old", name: "Old wallet" }],
          totals: { available: cop(0), netWorth: cop(0) },
        }),
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    });
    mocks.serverApi.mockResolvedValue(api);
    const element = await TransactionListContainer({
      spaceId: "sp-personal",
      period: "2026-10",
      categoryId: "c-dining",
    });
    expect((element as unknown as { props: Record<string, unknown> }).props).toMatchObject({
      spaceId: "sp-personal",
      today: "2026-10-31",
      filter: { period: "2026-10", categoryId: "c-dining" },
      context: {
        formats: me.preferences.effective,
        viewerZone: "America/Bogota",
        accountNames: { "a-old": "Old wallet" },
      },
    });
  });

  it("shows the problem's message when the list cannot be read", async () => {
    mocks.getMe.mockResolvedValue(meDto());
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": () => problemResponse(409, "SpaceArchived"),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
    });
    mocks.serverApi.mockResolvedValue(api);
    renderWithIntl(await TransactionListContainer({ spaceId: "sp-personal" }));
    expect(screen.getByRole("alert")).toHaveTextContent(es.errors.SpaceArchived);
  });
});
