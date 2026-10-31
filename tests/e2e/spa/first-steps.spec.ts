import { randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { signUp } from "../support/seed";

const steps = es.home.firstSteps;

/**
 * Issue #220 (F14): a new person's first home proposes the next steps, and recording the first expense ticks its step.
 * Recording it from a starter account also moves that account, which counts as its balance set (P265).
 */
test("a new person sees the first steps, and recording an expense ticks its step", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
  const spaceId = await signUp(page, "spa-first-steps", ip);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/spaces/${spaceId}`);
  const card = page.getByRole("region", { name: steps.title });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link")).toHaveCount(4);
  await expect(card.getByText(steps.done, { exact: true })).toHaveCount(0);
  // The period's figure stays above the card, whole on the first screen of the audit's phone.
  const figure = page.getByRole("region", { name: es.home.summary });
  await expect(figure).toBeInViewport({ ratio: 1 });

  // No sideways scroll and 44 px targets, at 390 and at 320 px.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 640 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `sideways scroll at ${width} px`).toBe(0);
    for (const target of await card.locator("a, button").all()) {
      const box = (await target.boundingBox())!;
      expect(Math.min(box.width, box.height), `a target at ${width} px`).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });

  await card.getByRole("link", { name: steps.step.expense }).click();
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  await page.getByLabel(es.ledger.form.amount).fill("12000");
  await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: es.ledger.form.save.EXPENSE, exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}(\\?|$)`));
  const expense = card.getByRole("listitem").filter({ hasText: steps.step.expense });
  await expect(expense.getByText(steps.done, { exact: true })).toBeVisible();
  await expect(expense.getByRole("link")).toHaveCount(0);
  await expect(card.getByRole("link", { name: steps.step.share })).toBeVisible();

  // Dismissed, it stays away for this person after a reload.
  await card.getByRole("button", { name: steps.dismiss }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: es.home.recent })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});
