import { expect, type Page } from "@playwright/test";

/**
 * Ruling P307: a sheet without an address of its own holds an entry of the browser's history while open, and gives it
 * back once it closes. A person's next move comes long after; a test that opens another address right away waits for
 * that, or the same-page Back can cut its navigation short.
 */
export const sheetsSettled = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => (history.state as { hearthSheet?: number } | null)?.hearthSheet ?? 0))
    .toBe(0);
