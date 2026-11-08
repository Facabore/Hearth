import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { cop, meDto, octoberPage, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import {
  cashFlowDto,
  e74Groups,
  e74Unified,
  e7Dashboard,
  HOUSEHOLD_MEMBERS,
  householdDto,
  NOVEMBER,
  savingsAccountDto,
  sixMonthsTrend,
} from "../../tests/support/ui/plan-dto";
import { renderSpa } from "../../tests/support/ui/spa";

const PERSONAL = "/spaces/sp-personal";

/** Ana's personal space and Household over a fake /api/v1: enough for a tab and for the stacked screens below. */
const server = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [NOVEMBER] }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
  "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(e7Dashboard()),
  "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
  "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(e74Groups()),
  "GET /api/v1/me/trend": () => jsonResponse(sixMonthsTrend()),
  "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto()),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] }),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [savingsAccountDto()], totals: { available: cop(0), netWorth: cop(0) } }),
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
  "POST /api/v1/spaces/{spaceId}/recurrences/preview": () => jsonResponse({ dates: [] }),
});

const switcher = () => screen.queryByRole("button", { name: /Cambiar de espacio/ });
const bottomBar = () => screen.queryByRole("navigation", { name: es.shell.nav.main });

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("stacked screens and tabs in the space shell (ruling P272)", () => {
  it.each([
    ["Cuentas", `${PERSONAL}/accounts`],
    ["Mi consumo", `${PERSONAL}/my-consumption?period=2026-11`],
    ["Ajustes", "/settings"],
    // P270's board 02: the recurrence form is a full screen, its save pinned at the bottom.
    ["Nuevo recurrente", `${PERSONAL}/recurrences/new`],
    // Ruling P311: the space's Configuración, from the header's ⚙.
    ["Configuración", `${PERSONAL}/settings`],
  ])("draws %s with only its way back: no space switcher and no bottom bar", async (_, url) => {
    renderSpa(url, server());
    expect(await screen.findByRole("link", { name: es.common.back }, { timeout: 5_000 })).toBeVisible();
    expect(switcher()).toBeNull();
    expect(bottomBar()).toBeNull();
  });

  it.each([
    ["Movimientos", `${PERSONAL}/transactions`],
    // Ruling P311: Más, the bar's fifth tab.
    ["Más", `${PERSONAL}/more`],
  ])("keeps the space switcher and the bottom bar on the %s tab", async (_, url) => {
    renderSpa(url, server());
    expect(
      await screen.findByRole("navigation", { name: es.shell.nav.main }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(switcher()).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("link", { name: es.common.back })).toBeNull());
  });

  // Ruling P311 (amends P200 and P303): Plan left the bar, so its views are stacked screens whose way back is the
  // space's Configuración, where Plan del mes opens them; they keep their view tabs.
  it.each([
    ["Rubros", `${PERSONAL}/plan?period=2026-11`],
    ["Por grupo", `${PERSONAL}/plan/groups?period=2026-11`],
  ])("draws the Plan view %s stacked, its way back to Configuración", async (_, url) => {
    renderSpa(url, server());
    const back = await screen.findByRole("link", { name: es.common.back }, { timeout: 5_000 });
    expect(back).toHaveAttribute("href", `${PERSONAL}/settings`);
    expect(switcher()).toBeNull();
    expect(bottomBar()).toBeNull();
    expect(await screen.findByRole("link", { name: "Rubros" })).toBeVisible();
  });
});

describe("the header's ⚙ and the bar's Más (ruling P311)", () => {
  it("opens the active space's Configuración from the ⚙ of a tab", async () => {
    renderSpa(`${PERSONAL}/transactions`, server());
    const gear = await screen.findByRole("link", { name: "Configuración de Personal" }, { timeout: 5_000 });
    await userEvent.click(gear);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Configuración" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Personal" })).toBeVisible();
  });

  it("names the space's Configuración Space settings in English, apart from the person's own Settings", async () => {
    renderSpa(`${PERSONAL}/more`, {
      ...server(),
      "GET /api/v1/me": () => jsonResponse(meDto({ locale: "en" })),
    });
    const tile = await screen.findByRole("link", { name: "Space settings" }, { timeout: 5_000 });
    expect(tile).toHaveAttribute("href", `${PERSONAL}/settings`);
    await userEvent.click(tile);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Space settings" }, { timeout: 5_000 }),
    ).toBeVisible();
  });

  it("opens the module grid from the bar's Más, which is current there", async () => {
    renderSpa(`${PERSONAL}/transactions`, server());
    const bar = await screen.findByRole("navigation", { name: es.shell.nav.main }, { timeout: 5_000 });
    await userEvent.click(within(bar).getByRole("link", { name: es.shell.nav.more }));
    expect(
      await screen.findByRole("heading", { level: 1, name: es.shell.more.title }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(within(bar).getByRole("link", { name: es.shell.nav.more })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: es.shell.more.settings })).toHaveAttribute(
      "href",
      `${PERSONAL}/settings`,
    );
  });
});

describe("the Configuración's statuses and its space dropdown (ruling P311)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const household = "/spaces/sp-household/settings";
  const pending = (id: string) => ({
    id,
    recurrenceId: `r-${id}`,
    type: "EXPENSE",
    description: id,
    date: "2026-11-10",
    status: "PENDING",
    amount: cop(95_000),
    categoryId: null,
    transactionId: null,
    reason: null,
  });

  it("says what the period's plan has left, the space's people and what waits to be confirmed", async () => {
    renderSpa(household, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/pending-occurrences": () =>
        jsonResponse({ items: [pending("o-1"), pending("o-2")] }),
      "GET /api/v1/me/balances": () =>
        jsonResponse({
          items: [
            {
              spaceId: "sp-household",
              memberId: "m-ana",
              net: cop(0),
              members: HOUSEHOLD_MEMBERS.map((member) => ({ memberId: member.id, name: member.displayName })),
              payments: [],
            },
          ],
        }),
    });
    const list = await screen.findByRole("navigation", { name: "Configuración" }, { timeout: 5_000 });
    const plan = within(list).getByRole("link", { name: /Plan del mes/ });
    await waitFor(() => expect(plan.textContent?.replace(/\s/g, " ")).toContain("Quedan $ 1.190.000"));
    expect(plan).toHaveAttribute("href", "/spaces/sp-household/plan");
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: /Miembros e invitados/ })).toHaveTextContent(
        `${HOUSEHOLD_MEMBERS.length} personas`,
      ),
    );
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: /Recurrentes/ })).toHaveTextContent("2 por confirmar"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Household" }));
    const menu = screen.getByRole("list", { name: es.shell.space.title });
    expect(within(menu).getByRole("link", { name: /Household/ })).toHaveTextContent(
      `Compartido · ${HOUSEHOLD_MEMBERS.length} personas`,
    );
    expect(within(menu).getByRole("link", { name: /Personal/ })).toHaveAttribute(
      "href",
      `${PERSONAL}/settings`,
    );
  });

  it("says how much the period's plan went over, in words, when its spending passed it", async () => {
    renderSpa(`${PERSONAL}/settings`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(
          e7Dashboard({
            totals: { planned: cop(4_000_000), spent: cop(4_250_000), available: cop(-250_000) },
          }),
        ),
    });
    const list = await screen.findByRole("navigation", { name: "Configuración" }, { timeout: 5_000 });
    const plan = within(list).getByRole("link", { name: /Plan del mes/ });
    await waitFor(() => expect(plan.textContent).toMatch(/Te pasaste \$\u00A0250\.000/));
    expect(plan.textContent).not.toMatch(/[−-]/);
  });

  it("counts the active space's people from its members, in the dropdown as in the Miembros row", async () => {
    const guest = { ...HOUSEHOLD_MEMBERS[1]!, id: "m-marta", userId: null, displayName: "Marta" };
    renderSpa(household, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [...HOUSEHOLD_MEMBERS, guest] }),
      // An older read of the person's balances, from before Marta joined.
      "GET /api/v1/me/balances": () =>
        jsonResponse({
          items: [
            {
              spaceId: "sp-household",
              memberId: "m-ana",
              net: cop(0),
              members: HOUSEHOLD_MEMBERS.map((member) => ({ memberId: member.id, name: member.displayName })),
              payments: [],
            },
          ],
        }),
    });
    const list = await screen.findByRole("navigation", { name: "Configuración" }, { timeout: 5_000 });
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: /Miembros e invitados/ })).toHaveTextContent(
        "3 personas",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Household" }));
    const menu = screen.getByRole("list", { name: es.shell.space.title });
    expect(within(menu).getByRole("link", { name: /Household/ })).toHaveTextContent(
      "Compartido · 3 personas",
    );
  });

  it("says Sin plan when the period has none", async () => {
    renderSpa(`${PERSONAL}/settings`, {
      ...server(),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(e7Dashboard({ plan: null })),
    });
    const list = await screen.findByRole("navigation", { name: "Configuración" }, { timeout: 5_000 });
    await waitFor(() =>
      expect(within(list).getByRole("link", { name: /Plan del mes/ })).toHaveTextContent("Sin plan"),
    );
  });
});
