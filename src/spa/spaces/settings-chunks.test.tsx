import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { meDto, spaceDto } from "../../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { e7Dashboard, HOUSEHOLD_MEMBERS, householdDto, NOVEMBER } from "../../../tests/support/ui/plan-dto";
import { renderSpa } from "../../../tests/support/ui/spa";

/** How the Configuración's lazy chunks load: how many next loads fail, and what a load waits for first. */
const chunks = vi.hoisted(() => ({
  statusFailures: 0,
  sheetFailures: 0,
  sheetGate: Promise.resolve() as Promise<void>,
}));

vi.mock("./settings-status", async (importOriginal) => {
  if (chunks.statusFailures > 0) {
    chunks.statusFailures -= 1;
    throw new Error("the statuses' chunk did not load");
  }
  return importOriginal();
});

vi.mock("@/modules/spaces/ui/space-settings/space-lifecycle-sheet", async (importOriginal) => {
  await chunks.sheetGate;
  if (chunks.sheetFailures > 0) {
    chunks.sheetFailures -= 1;
    throw new Error("the sheet's chunk did not load");
  }
  return importOriginal();
});

const server = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdDto()] }),
  "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [NOVEMBER] }),
  "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
  "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(e7Dashboard()),
  "GET /api/v1/spaces/{spaceId}/pending-occurrences": () => jsonResponse({ items: [] }),
  "GET /api/v1/me/balances": () => jsonResponse({ items: [] }),
});

const list = () => screen.findByRole("navigation", { name: "Configuración" }, { timeout: 5_000 });

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T15:00:00.000Z"));
  return () => vi.useRealTimers();
});

describe("the Configuración's lazy chunks (ruling P311)", () => {
  it("shows its rows without statuses when the statuses' chunk fails, and loads it again on a later visit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    chunks.statusFailures = 1;
    renderSpa("/spaces/sp-household/settings", server());
    const plan = within(await list()).getByRole("link", { name: /Plan del mes/ });
    await waitFor(() => expect(chunks.statusFailures).toBe(0));
    expect(plan).not.toHaveTextContent("Quedan");
    expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();

    // Another space's Configuración draws its rows afresh, and their statuses load this time.
    await userEvent.click(screen.getByRole("button", { name: "Household" }));
    await userEvent.click(
      within(screen.getByRole("list", { name: es.shell.space.title })).getByRole("link", {
        name: /Personal/,
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("navigation", { name: "Configuración" }))
          .getByRole("link", { name: /Plan del mes/ })
          .textContent?.replace(/\s/g, " "),
      ).toContain("Quedan $ 1.190.000"),
    );
    vi.mocked(console.error).mockRestore();
  });

  it("answers a tap on Salir at once, and a sheet that fails to load opens on the next tap", async () => {
    let release = () => undefined as void;
    chunks.sheetGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    chunks.sheetFailures = 1;
    renderSpa("/spaces/sp-household/settings", server());
    await list();
    const leave = screen.getByRole("button", { name: /^Salir de Household/ });
    await userEvent.click(leave);
    // The sheet's code is still on its way: the row says so instead of doing nothing.
    expect(leave).toHaveAttribute("aria-busy", "true");
    expect(leave).toHaveTextContent(es.common.loading);

    release();
    await waitFor(() => expect(leave).not.toHaveAttribute("aria-busy"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();

    await userEvent.click(leave);
    expect(
      await screen.findByRole("dialog", { name: "¿Salir de Household?" }, { timeout: 5_000 }),
    ).toBeVisible();
  });
});
