import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { post, signUp } from "../support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const scan = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

test.describe("the Plan tab and the planner (slice 5 of #199, ADR 0006)", () => {
  test("starts a shared space's plan from its Plan tab, saves the capacities, and opens every view", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const personal = await signUp(page, "spa-plan", ip);
    const space = (await post(page, "/api/v1/spaces", {
      kind: "SHARED",
      name: "Household",
      currency: "COP",
    })) as {
      id: string;
    };

    // A period with no plan offers to start one; starting it lands in its planner.
    await page.goto(`/spaces/${space.id}/plan`);
    await expect(page).toHaveTitle(`${es.reports.title} · Hearth`);
    await scan(page, "plan without a plan");
    await page.getByRole("button", { name: "Crear plan" }).click();
    await expect(page).toHaveURL(new RegExp(`/spaces/${space.id}/plans/[^/]+$`));
    await expect(page).toHaveTitle(`${es.budgeting.planner.metaTitle} · Hearth`);
    await scan(page, "planner");

    // The capacities: saving returns to the planner.
    const planner = page.url();
    await page.goto(`${planner}/capacities`);
    await expect(page.getByRole("button", { name: "Guardar capacidades" })).toBeVisible();
    await scan(page, "capacities");
    await page
      .getByLabel(/^Capacidad de/)
      .first()
      .fill("2.000.000");
    await page.getByRole("button", { name: "Guardar capacidades" }).click();
    await expect(page).toHaveURL(planner);

    // A new line's editor.
    await page.goto(`${planner}/lines/new`);
    await expect(page).toHaveTitle(`${es.budgeting.lineEditor.newTitle} · Hearth`);
    await scan(page, "new line");

    // Every view of the shared space and of the personal one, each from its own report.
    for (const [url, title] of [
      [`/spaces/${space.id}/plan/lines`, es.reports.view.lines],
      [`/spaces/${space.id}/plan/members`, es.reports.view.members],
      [`/spaces/${space.id}/plan/fund`, es.reports.view.fund],
      [`/spaces/${space.id}/plan/groups`, es.reports.view.groups],
      [`/spaces/${personal}/plan`, es.reports.title],
      [`/spaces/${personal}/plan/calendar`, es.reports.calendar.metaTitle],
      [`/spaces/${personal}/plan/trend`, es.reports.view.trend],
    ] as const) {
      await page.goto(url);
      await expect(page).toHaveTitle(`${title} · Hearth`);
      await expect(page.getByRole("heading", { name: es.notFound.title })).toHaveCount(0);
      await scan(page, url);
    }

    expect(errors).toEqual([]);
  });
});
