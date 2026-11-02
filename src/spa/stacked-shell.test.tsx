import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
  ])("draws %s with only its way back: no space switcher and no bottom bar", async (_, url) => {
    renderSpa(url, server());
    expect(await screen.findByRole("link", { name: es.common.back }, { timeout: 5_000 })).toBeVisible();
    expect(switcher()).toBeNull();
    expect(bottomBar()).toBeNull();
  });

  it.each([
    ["Movimientos", `${PERSONAL}/transactions`],
    ["Plan", `${PERSONAL}/plan?period=2026-11`],
  ])("keeps the space switcher and the bottom bar on the %s tab", async (_, url) => {
    renderSpa(url, server());
    expect(
      await screen.findByRole("navigation", { name: es.shell.nav.main }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(switcher()).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("link", { name: es.common.back })).toBeNull());
  });
});
