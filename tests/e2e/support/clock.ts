import { test as base, type BrowserContext } from "@playwright/test";

/**
 * Ruling P133: the e2e server's clock (HEARTH_E2E_FIXED_NOW, 2026-10-31 23:30 in Bogotá). The single-page app reads
 * "today" from the browser (ADR 0006), so every test's browser starts at the same instant: without it, a run after the
 * month the seeds were written for looks for plans and movements of a period nobody seeded (#236).
 */
export const E2E_NOW = new Date(process.env.HEARTH_E2E_FIXED_NOW ?? "2026-11-01T04:30:00Z");

/** The e2e day in Bogotá, the seeded people's zone: a movement dated today sits in the period the screens open on. */
export const todayInBogota = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(E2E_NOW);

const setClock = async ({ context }: { context: BrowserContext }, use: () => Promise<void>) => {
  await context.clock.setFixedTime(E2E_NOW);
  await use();
};

/** An automatic fixture: the browser's Date reads E2E_NOW; a scenario that sets its own clock still wins. */
export const serverClock: [typeof setClock, { auto: true }] = [setClock, { auto: true }];

/** Playwright's test with the browser on the server's clock; specs import it instead of @playwright/test's. */
export const test = base.extend<{ serverClock: void }>({ serverClock });
