import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures";

const pesos = (amount: string) => amount.replaceAll(",", "");

/**
 * #167's sibling (owner, 2026-10-22): the personal space's Plan tab leads to the period's plan. Since ruling P267 it
 * opens on Rubros, whose card for a period without a plan creates it.
 */
When(
  /^"[^"]+" opens the Plan tab of her personal space for (\S+) and starts its plan$/,
  async ({ page, world }, period: string) => {
    await page.goto(`/spaces/${world.user!.spaceId}/plan?period=${period}`);
    await page.getByRole("button", { name: world.t("budgeting.start.create") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
  },
);

When(
  /^she enters her capacity ([\d,]+) COP and adds "([^"]+)" ([\d,]+) COP marked as catch-all$/,
  async ({ page, world }, capacity: string, line: string, planned: string) => {
    await page.getByRole("link", { name: world.t("budgeting.planner.editCapacities") }).click();
    await page
      .getByLabel(world.t("budgeting.capacity.field", { name: world.user!.name }))
      .fill(pesos(capacity));
    await page.getByRole("button", { name: world.t("budgeting.capacity.save") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: world.t("budgeting.planner.addLine") }).click();
    await page.getByLabel(world.t("budgeting.lineEditor.field.name")).fill(line);
    await page.getByLabel(world.t("budgeting.lineEditor.field.planned")).fill(pesos(planned));
    await page.getByRole("switch", { name: world.t("budgeting.lineEditor.field.catchAll") }).click();
    await page.getByRole("button", { name: world.t("budgeting.lineEditor.add") }).click();
    await expect(page.getByRole("listitem", { name: line })).toBeVisible();
  },
);

When("she activates the plan", async ({ page, world }) => {
  await page.getByRole("button", { name: world.t("budgeting.planner.activate") }).click();
  await expect(page.getByText(world.t("budgeting.status.ACTIVE"), { exact: true })).toBeVisible();
});

Then(
  /^the Plan tab of her personal space shows the (\S+) plan as active, with the link to edit it$/,
  async ({ page, world }, period: string) => {
    await page.goto(`/spaces/${world.user!.spaceId}/plan?period=${period}`);
    const main = page.getByRole("main");
    await expect(main.getByText(world.t("budgeting.status.ACTIVE"), { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: world.t("reports.frame.editPlan") })).toHaveAttribute(
      "href",
      /\/plans\/[0-9a-f-]{36}$/,
    );
    await expect(main.getByRole("button", { name: world.t("budgeting.start.create") })).toHaveCount(0);
  },
);
