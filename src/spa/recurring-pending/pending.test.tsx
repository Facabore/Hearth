import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  accountDto,
  cop,
  householdSpace,
  meDto,
  memberDto,
  normalized,
  octoberPage,
  rowContext,
  spaceDto,
  transactionDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";
import { ledgerKeys } from "../ledger/queries";
import { recurrenceKeys, type OccurrenceDto, type RecurrenceDto } from "./queries";

const recurrence = (overrides: Partial<RecurrenceDto> = {}): RecurrenceDto => ({
  id: "r-energy",
  type: "EXPENSE",
  description: "Energía",
  amount: cop(180_000),
  mode: "CONFIRM",
  schedule: { kind: "MONTHLY", day: 10 },
  startDate: "2026-11-10",
  endDate: null,
  status: "ACTIVE",
  pauseReason: null,
  nextOccurrence: "2027-01-10",
  categoryId: null,
  payerMemberId: "m-ana",
  sourceAccountId: "a-bank",
  destinationAccountId: null,
  split: null,
  lastOccurrence: null,
  createdBy: "u-ana",
  createdAt: "2026-11-01T12:00:00.000Z",
  ...overrides,
});

const occurrence = (overrides: Partial<OccurrenceDto> = {}): OccurrenceDto => ({
  id: "o-energy",
  recurrenceId: "r-energy",
  type: "EXPENSE",
  description: "Energía",
  date: "2026-12-10",
  status: "PENDING",
  amount: cop(180_000),
  categoryId: null,
  transactionId: null,
  reason: null,
  ...overrides,
});

const energy = recurrence();
const internet = recurrence({
  id: "r-internet",
  description: "Internet",
  amount: cop(95_000),
  schedule: { kind: "MONTHLY", day: 5 },
  payerMemberId: "m-juan",
  sourceAccountId: null,
});
const pendingEnergy = occurrence({ categoryId: "c-groceries" });
const pendingInternet = occurrence({
  id: "o-internet",
  recurrenceId: "r-internet",
  description: "Internet",
  date: "2026-12-05",
  amount: cop(95_000),
});

/** Ana in Hogar over a fake /api/v1, with Internet and Energía waiting; `role` is hers in Hogar. */
const pendingApi = (role: "OWNER" | "VIEWER" = "OWNER", overrides: Record<string, FakeHandler> = {}) => {
  let pending = [pendingInternet, pendingEnergy];
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () =>
      jsonResponse({ items: [spaceDto(), householdSpace({ name: "Hogar", role })] }),
    // P271: every member reads the pending list; only members who record money confirm or skip.
    "GET /api/v1/spaces/{spaceId}/pending-occurrences": () => jsonResponse({ items: pending }),
    "GET /api/v1/spaces/{spaceId}/recurrences": () =>
      jsonResponse({
        items: [
          { ...energy, lastOccurrence: { ...pendingEnergy } },
          { ...internet, lastOccurrence: { ...pendingInternet } },
        ],
      }),
    "GET /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": () => jsonResponse(energy),
    "GET /api/v1/spaces/{spaceId}/members": () =>
      jsonResponse({
        items: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })],
      }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
    "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/balances": () => problemResponse(403, "InsufficientRole"),
    "POST /api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/confirm": (_, { occurrenceId }) => {
      pending = pending.filter((o) => o.id !== occurrenceId);
      return jsonResponse(
        {
          ...transactionDto({
            id: "t-energy",
            description: "Energía",
            date: "2026-10-31",
            amount: cop(205_300),
          }),
          warnings: [],
        },
        201,
      );
    },
    "POST /api/v1/spaces/{spaceId}/pending-occurrences/{occurrenceId}/skip": (_, { occurrenceId }) => {
      pending = pending.filter((o) => o.id !== occurrenceId);
      return jsonResponse({ ...pendingEnergy, status: "SKIPPED" });
    },
    ...overrides,
  };
  return routes;
};

const card = (name: string) => screen.getByRole("article", { name });
const calls = (requests: Request[], method: string, pattern: RegExp) =>
  requests.filter((r) => r.method === method && pattern.test(new URL(r.url).pathname));

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("Por confirmar in the SPA (HU-E9-09, ruling P270)", () => {
  it("lists the pending occurrences earliest first, named with their payer and account", async () => {
    renderSpa("/spaces/sp-household/pending-occurrences", pendingApi());
    expect(await screen.findByRole("heading", { level: 1, name: "Por confirmar" })).toBeInTheDocument();
    const names = screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"));
    expect(names).toEqual(["pending-o-internet", "pending-o-energy"]);
    expect(normalized(card("Energía").textContent)).toContain("Sugerido: $ 180.000 · Ana · Bancolombia");
    expect(normalized(card("Internet").textContent)).toContain("Sugerido: $ 95.000 · Juan");
    expect(document.title).toBe("Por confirmar · Hearth");
    // P270: a card carries its category's icon once the categories are read; one without a category has none.
    await waitFor(() =>
      expect(card("Energía").querySelector("span[aria-hidden='true'].rounded-xl")).not.toBeNull(),
    );
    expect(card("Internet").querySelector("span[aria-hidden='true'].rounded-xl")).toBeNull();
  });

  it("draws board 07's real amount as one large field with its symbol inside", async () => {
    renderSpa("/spaces/sp-household/pending-occurrences", pendingApi());
    const field = await screen.findByRole("textbox", { name: "Monto real de Energía" });
    expect(field).toHaveClass("text-2xl", "font-semibold");
    expect(within(field.parentElement!).getByText("$")).toHaveClass("text-2xl", "font-semibold");
  });

  it("confirms Energía with 205.300 COP in minor units, then the item leaves and the movements are read again (S4)", async () => {
    const spa = renderSpa("/spaces/sp-household/pending-occurrences", pendingApi());
    const field = await screen.findByRole("textbox", { name: "Monto real de Energía" });
    spa.queryClient.setQueryData(ledgerKeys.page("sp-household", { limit: 3 }), octoberPage);
    await userEvent.clear(field);
    await userEvent.type(field, "205300");
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Energía" })).not.toBeInTheDocument());
    const [sent] = calls(spa.requests, "POST", /\/pending-occurrences\/o-energy\/confirm$/);
    expect(await sent!.json()).toEqual({ amount: { amount: "20530000", currency: "COP" } });
    expect(sent!.headers.get("idempotency-key")).toMatch(/.+/);
    // Board 08: the toast says what was saved, with "Ver" to open it.
    const saved = await screen.findByText("Gasto guardado");
    expect(
      within(saved.closest("[data-toast]") as HTMLElement).getByRole("button", { name: "Ver" }),
    ).toBeInTheDocument();
    // The home's and the list's pages hold the new movement and are read again; so is the badge's count.
    const home = ledgerKeys.page("sp-household", { limit: 3 });
    expect(spa.queryClient.getQueryData<typeof octoberPage>(home)?.items.map((tx) => tx.id)).toContain(
      "t-energy",
    );
    expect(spa.queryClient.getQueryState(home)?.isInvalidated).toBe(true);
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/pending-occurrences$/).length).toBeGreaterThanOrEqual(2),
    );
    expect(spa.queryClient.getQueryData<OccurrenceDto[]>(recurrenceKeys.pending("sp-household"))).toEqual([
      pendingInternet,
    ]);
  });

  it("skips Energía: it leaves the list and the toast names its next date from the API (S5)", async () => {
    const spa = renderSpa("/spaces/sp-household/pending-occurrences", pendingApi());
    await screen.findByRole("article", { name: "Energía" });
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Omitir" }));
    expect(await screen.findByText("Energía omitida. Sigue el 10/1/2027.")).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Energía" })).not.toBeInTheDocument();
    expect(calls(spa.requests, "POST", /\/pending-occurrences\/o-energy\/skip$/)).toHaveLength(1);
    expect(calls(spa.requests, "GET", /\/recurrences\/r-energy$/)).toHaveLength(1);
  });

  it("shows a VIEWER what waits, read from the API, with the role note and no confirm or skip (S6, P271)", async () => {
    const spa = renderSpa("/spaces/sp-household/pending-occurrences", pendingApi("VIEWER"));
    expect(
      await screen.findByText(
        "Tu rol en Hogar es Lector: puedes ver lo que está por confirmar, pero no confirmarlo ni omitirlo.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-labelledby"))).toEqual([
      "pending-o-internet",
      "pending-o-energy",
    ]);
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Omitir" })).not.toBeInTheDocument();
    expect(calls(spa.requests, "GET", /\/pending-occurrences$/)).toHaveLength(1);
  });
});

describe("the ways into Por confirmar (HU-E9-09, ruling P270)", () => {
  const movements = () =>
    within(screen.getByRole("navigation", { name: "Principal" })).getByRole("link", { name: /^Movimientos/ });

  it("counts the space's pending occurrences on the Movimientos tab for a member who records money (S7)", async () => {
    renderSpa("/spaces/sp-household/transactions", pendingApi());
    await waitFor(() => expect(movements()).toHaveAccessibleName("Movimientos, 2 por confirmar"));
  });

  it("puts a banner under Movimientos' title that leads to them", async () => {
    renderSpa("/spaces/sp-household/transactions", pendingApi());
    const review = await screen.findByRole("link", { name: "Revisar" });
    expect(review).toHaveAttribute("href", "/spaces/sp-household/pending-occurrences");
    // Board E9-09 01: the count on one line, what waits under it in a smaller muted line.
    expect(screen.getByText("2 movimientos por confirmar")).toHaveClass("text-[15px]");
    expect(screen.getByText("Internet y Energía")).toHaveClass("text-[13px]", "text-muted");
  });

  it("shows a VIEWER no badge and no banner, and never asks the API for the count (S7)", async () => {
    const spa = renderSpa("/spaces/sp-household/transactions", pendingApi("VIEWER"));
    expect(await screen.findByRole("heading", { level: 1, name: "Movimientos" })).toBeInTheDocument();
    expect(movements()).toHaveAccessibleName("Movimientos");
    expect(screen.queryByRole("link", { name: "Revisar" })).not.toBeInTheDocument();
    expect(calls(spa.requests, "GET", /\/pending-occurrences$/)).toHaveLength(0);
  });

  it("shows nothing when nothing waits (S7)", async () => {
    const spa = renderSpa(
      "/spaces/sp-household/transactions",
      pendingApi("OWNER", {
        "GET /api/v1/spaces/{spaceId}/pending-occurrences": () => jsonResponse({ items: [] }),
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Movimientos" })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls(spa.requests, "GET", /\/pending-occurrences$/).length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(spa.queryClient.isFetching()).toBe(0));
    expect(movements()).toHaveAccessibleName("Movimientos");
    expect(screen.queryByRole("link", { name: "Revisar" })).not.toBeInTheDocument();
  });
});
