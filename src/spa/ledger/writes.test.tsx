import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import type { TransactionDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  householdSpace,
  meDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";

const LIST = "/spaces/sp-personal/transactions";
const ONE = "/api/v1/spaces/{spaceId}/transactions/{transactionId}";

/** An answer the test gives when it chooses, so it can look at the screen while the API has not answered. */
const deferred = () => {
  let answer: (response: Response) => void = () => undefined;
  const response = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  return { response, answer };
};

/**
 * Ana's personal space over a fake /api/v1 that keeps its movements, so a read after a write returns what the server
 * would. `hold` makes the named reads hang from then on: whatever shows meanwhile came from the cache.
 */
const ledgerServer = (writes: Record<string, FakeHandler> = {}) => {
  const items: TransactionDto[] = [...octoberPage.items];
  const hold = new Set<string>();
  const held =
    (name: string, handler: FakeHandler): FakeHandler =>
    (request, params) =>
      hold.has(name) ? new Promise<Response>(() => undefined) : handler(request, params);
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces/{spaceId}/transactions": held("page", () => jsonResponse({ ...octoberPage, items })),
    [`GET ${ONE}`]: held("transaction", (_, { transactionId }) => {
      const tx = items.find((item) => item.id === transactionId);
      return tx ? jsonResponse(tx) : problemResponse(404, "TransactionNotFound");
    }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({
        items: [
          accountDto({ id: "a-bank", name: "Bancolombia" }),
          accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" }),
        ],
      }),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    ...writes,
  };
  return { routes, items, hold };
};

const count = (requests: Request[], method: string, path: RegExp) =>
  requests.filter((r) => r.method === method && path.test(new URL(r.url).pathname)).length;

/** What `refresh()` would read again if a save did not settle the cache itself: who is signed in and their spaces. */
const identityReads = (requests: Request[]) => [
  count(requests, "GET", /\/me$/),
  count(requests, "GET", /\/spaces$/),
];

/** The reads a movement never changes: who is signed in, their spaces, the categories, members and periods. */
const unrelatedReads = (requests: Request[]) =>
  ["/me$", "/spaces$", "/categories$", "/members$", "/periods$"].map((path) =>
    count(requests, "GET", new RegExp(path)),
  );

const listRow = (name: RegExp) => screen.queryByRole("link", { name, hidden: true });

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the ledger's writes in the SPA (slice 2 of #199, ADR 0006)", () => {
  it("deletes at once: the row leaves before the API answers, Deshacer is offered, and only what changed is read again", async () => {
    const answer = deferred();
    const { routes, items } = ledgerServer({
      [`DELETE ${ONE}`]: (_, { transactionId }) => {
        items.splice(
          items.findIndex((item) => item.id === transactionId),
          1,
        );
        return answer.response;
      },
    });
    const spa = renderSpa(`${LIST}?tx=t-dinner`, routes);
    await screen.findByRole("dialog", { name: "Dinner" });
    const reads = unrelatedReads(spa.requests);
    const pages = count(spa.requests, "GET", /\/transactions$/);

    await userEvent.click(screen.getByRole("button", { name: es.ledger.detail.delete }));
    await waitFor(() => expect(listRow(/Dinner/)).toBeNull());

    answer.answer(new Response(null, { status: 204 }));
    expect(await screen.findByRole("button", { name: es.ledger.toast.undo })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(es.ledger.toast.deleted.EXPENSE);
    await waitFor(() => expect(spa.location()).toBe(LIST));
    // The space's pages are read again; refresh() after the save reads nothing else.
    await waitFor(() => expect(count(spa.requests, "GET", /\/transactions$/)).toBeGreaterThan(pages));
    expect(unrelatedReads(spa.requests)).toEqual(reads);
    expect(listRow(/Dinner/)).toBeNull();
  });

  it("puts the row back when the API refuses the delete, and says why in the sheet", async () => {
    const { routes } = ledgerServer({ [`DELETE ${ONE}`]: () => problemResponse(403, "Forbidden") });
    renderSpa(`${LIST}?tx=t-dinner`, routes);
    const dialog = await screen.findByRole("dialog", { name: "Dinner" });

    await userEvent.click(within(dialog).getByRole("button", { name: es.ledger.detail.delete }));

    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    expect(listRow(/Dinner/)).not.toBeNull();
  });

  it("brings the row back from Deshacer before the API answers the restore (P194)", async () => {
    const restore = deferred();
    const { routes, items } = ledgerServer({
      [`DELETE ${ONE}`]: (_, { transactionId }) => {
        items.splice(
          items.findIndex((item) => item.id === transactionId),
          1,
        );
        return new Response(null, { status: 204 });
      },
      [`POST ${ONE}/restore`]: () => restore.response,
    });
    renderSpa(`${LIST}?tx=t-dinner`, routes);
    await screen.findByRole("dialog", { name: "Dinner" });
    await userEvent.click(screen.getByRole("button", { name: es.ledger.detail.delete }));
    await userEvent.click(await screen.findByRole("button", { name: es.ledger.toast.undo }));

    await waitFor(() => expect(listRow(/Dinner/)).not.toBeNull());

    const dinner = octoberPage.items.find((item) => item.id === "t-dinner")!;
    items.splice(1, 0, dinner);
    restore.answer(jsonResponse(dinner));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(es.ledger.toast.restored.EXPENSE),
    );
    expect(listRow(/Dinner/)).not.toBeNull();
  });

  it("shows an edit's sheet with the API's answer at once, without waiting on a read", async () => {
    const { routes, items, hold } = ledgerServer({
      [`PATCH ${ONE}`]: async (request, { transactionId }) => {
        const at = items.findIndex((item) => item.id === transactionId);
        const body = (await request.json()) as { description: string };
        items[at] = { ...items[at]!, description: body.description, version: items[at]!.version + 1 };
        hold.add("page").add("transaction");
        return jsonResponse(items[at]);
      },
    });
    // As a person gets there: Movimientos, the row's sheet, Editar.
    const spa = renderSpa(`${LIST}?tx=t-dinner`, routes);
    const sheet = await screen.findByRole("dialog", { name: "Dinner" });
    await userEvent.click(within(sheet).getByRole("link", { name: es.ledger.detail.edit }));
    const description = await screen.findByLabelText(es.ledger.form.description);
    const reads = identityReads(spa.requests);
    await userEvent.clear(description);
    await userEvent.type(description, "Cena");
    await userEvent.click(screen.getByRole("button", { name: es.ledger.edit.save }));

    // The reads hang from the save on: the sheet and the row can only come from the API's answer.
    expect(await screen.findByRole("dialog", { name: "Cena" })).toBeVisible();
    expect(spa.location()).toBe(`${LIST}?tx=t-dinner`);
    expect(listRow(/Cena/)).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(es.ledger.toast.edited);
    // Back on Movimientos is a visit, which revalidates its reads (ADR 0006); the save's refresh() reads nothing.
    expect(identityReads(spa.requests)).toEqual(reads);
  });

  it("keeps a refused edit on its form with Cargar la última versión, which reads the transaction again (P193)", async () => {
    const { routes, items } = ledgerServer({
      [`PATCH ${ONE}`]: () => problemResponse(412, "PreconditionFailed"),
    });
    const spa = renderSpa(`${LIST}/t-dinner/edit`, routes);
    await screen.findByLabelText(es.ledger.form.description);
    const before = count(spa.requests, "GET", /\/transactions\/t-dinner$/);
    items[1] = { ...items[1]!, description: "Cena de Ana", version: 3 };

    await userEvent.type(screen.getByLabelText(es.ledger.form.description), "!");
    await userEvent.click(screen.getByRole("button", { name: es.ledger.edit.save }));
    await userEvent.click(await screen.findByRole("button", { name: es.ledger.edit.reload }));

    expect(await screen.findByDisplayValue("Cena de Ana")).toBeVisible();
    expect(count(spa.requests, "GET", /\/transactions\/t-dinner$/)).toBeGreaterThan(before);
    expect(spa.location()).toBe(`${LIST}/t-dinner/edit`);
  });

  it("lands a recorded expense on Movimientos with its row, without waiting on a read, and keeps the toast (P195)", async () => {
    const recorded: TransactionDto = {
      ...octoberPage.items[1]!,
      id: "t-new",
      description: "Pan",
      date: "2026-10-20",
      occurredAt: "2026-10-20T13:00:00.000Z",
      timeZone: "America/Bogota",
      createdAt: "2026-10-20T13:00:00.000Z",
    };
    const { routes, items, hold } = ledgerServer({
      "POST /api/v1/spaces/{spaceId}/expenses": () => {
        items.splice(1, 0, recorded);
        hold.add("page");
        return jsonResponse({ ...recorded, warnings: [] }, 201);
      },
    });
    // As a person gets there: from Movimientos, whose Registrar returns to it (#172).
    const spa = renderSpa(LIST, routes);
    await screen.findByText("Salary");
    await userEvent.click(screen.getByRole("link", { name: es.shell.nav.record }));
    await userEvent.type(await screen.findByLabelText(es.ledger.form.amount), "12000");
    await userEvent.type(screen.getByLabelText(es.ledger.form.description), "Pan");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));

    await waitFor(() => expect(spa.location()).toBe(LIST));
    expect(await screen.findByRole("link", { name: /Pan/ })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(es.ledger.toast.saved.EXPENSE);
    expect(screen.getByRole("button", { name: es.ledger.toast.view })).toBeVisible();
  });

  it("converts a movement and undoes it: each answer replaces the row it changed (#195)", async () => {
    const original = octoberPage.items.find((item) => item.id === "t-dinner")!;
    const transfer: TransactionDto = {
      ...original,
      id: "t-transfer",
      type: "TRANSFER",
      categoryId: null,
      payments: [],
      sourceAccountId: "a-bank",
      destinationAccountId: "a-visa",
    };
    const { routes, items } = ledgerServer({
      [`POST ${ONE}/convert`]: () => {
        items.splice(items.indexOf(original), 1, transfer);
        return jsonResponse(transfer, 201);
      },
      [`POST ${ONE}/convert/undo`]: () => {
        items.splice(items.indexOf(transfer), 1, original);
        return jsonResponse(original);
      },
    });
    const spa = renderSpa(`${LIST}/t-dinner/edit?returnTo=${encodeURIComponent(LIST)}`, routes);
    await userEvent.click(await screen.findByRole("tab", { name: es.ledger.type.TRANSFER }));
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Visa/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: es.ledger.edit.save }));

    await waitFor(() => expect(spa.location()).toBe(`${LIST}?tx=t-transfer`));
    expect(screen.getByRole("status")).toHaveTextContent(es.ledger.toast.converted.TRANSFER);
    // The toast sits over the new movement's modal sheet; its own pointer-events-auto class is CSS jsdom never applies.
    await userEvent
      .setup({ pointerEventsCheck: 0 })
      .click(screen.getByRole("button", { name: es.ledger.toast.undo }));

    await waitFor(() => expect(spa.location()).toBe(`${LIST}?tx=t-dinner`));
    expect(await screen.findByRole("dialog", { name: "Dinner" })).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: /Dinner/, hidden: true })).toHaveLength(1),
    );
  });
});
