import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { percentShown, shown } from "../support/money";
import { householdOf, seedHousehold } from "../support/plan-seed";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const pesos = (amount: string) => amount.replaceAll(",", "");

Given(
  /^"([^"]+)" is OWNER and "([^"]+)" is MEMBER of "([^"]+)" with the period policy MONTHLY\(1\)$/,
  async ({ world }, owner: string, member: string, name: string) => {
    await world.signUp(owner);
    await seedHousehold(world, { name, member, role: "MEMBER" });
  },
);

When(
  /^"[^"]+" creates the (\S+) plan and enters capacities "([^"]+)" ([\d,]+) COP and "([^"]+)" ([\d,]+) COP$/,
  async (
    { page, world },
    period: string,
    first: string,
    firstAmount: string,
    second: string,
    secondAmount: string,
  ) => {
    await page.goto(`/spaces/${householdOf(world).spaceId}/plan?period=${period}`);
    await page.getByRole("button", { name: world.t("budgeting.start.create") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: world.t("budgeting.planner.editCapacities") }).click();
    await page.getByLabel(world.t("budgeting.capacity.field", { name: first })).fill(pesos(firstAmount));
    await page.getByLabel(world.t("budgeting.capacity.field", { name: second })).fill(pesos(secondAmount));
    await page.getByRole("button", { name: world.t("budgeting.capacity.save") }).click();
    await expect(page).toHaveURL(/\/plans\/[0-9a-f-]{36}$/);
  },
);

When(
  /^adds "([^"]+)" ([\d,]+) COP funded by "([A-Z_]+)", "([^"]+)" ([\d,]+) COP "([A-Z_]+)", "([^"]+)" ([\d,]+) COP "([A-Z_]+)" with a savings account and "([^"]+)" ([\d,]+) COP "([A-Z_]+)" marked as catch-all, all with rollover "([A-Z_]+)"$/,
  async (
    { page, world },
    a: string,
    aAmount: string,
    aFunding: string,
    b: string,
    bAmount: string,
    bFunding: string,
    c: string,
    cAmount: string,
    cFunding: string,
    d: string,
    dAmount: string,
    dFunding: string,
    rollover: string,
  ) => {
    // The savings line names an account its owner holds (P8): Ana's own SAVINGS account in her personal space.
    await world.seedAccount("Ahorros", { type: "SAVINGS", openingBalance: { amount: "0", currency: "COP" } });
    const add = async (
      name: string,
      amount: string,
      funding: string,
      extra: { savings?: boolean; catchAll?: boolean } = {},
    ) => {
      await page.getByRole("link", { name: world.t("budgeting.planner.addLine") }).click();
      await page.getByLabel(world.t("budgeting.lineEditor.field.name")).fill(name);
      await page.getByLabel(world.t("budgeting.lineEditor.field.planned")).fill(pesos(amount));
      await page.getByRole("radio", { name: world.t(`budgeting.funding.${funding}`) }).click();
      if (extra.savings) await page.getByRole("checkbox", { name: "Ahorros" }).check();
      if (extra.catchAll)
        await page.getByRole("switch", { name: world.t("budgeting.lineEditor.field.catchAll") }).click();
      await page.getByRole("radio", { name: world.t(`budgeting.rollover.${rollover}`) }).click();
      await page.getByRole("button", { name: world.t("budgeting.lineEditor.add") }).click();
      await expect(page.getByRole("listitem", { name })).toBeVisible();
    };
    await add(a, aAmount, aFunding);
    await add(b, bAmount, bFunding);
    await add(c, cAmount, cFunding, { savings: true });
    await add(d, dAmount, dFunding, { catchAll: true });
  },
);

Then(
  /^the planner shows total capacity ([\d,]+) COP split ([\d.]+)% \/ ([\d.]+)%$/,
  async ({ page, world }, total: string, first: string, second: string) => {
    const capacity = page.getByRole("region", { name: world.t("budgeting.planner.capacity") });
    const text = norm(await capacity.textContent());
    expect(text).toContain(norm(shown(total)));
    expect(text).toContain(norm(percentShown(first)));
    expect(text).toContain(norm(percentShown(second)));
  },
);

Then(
  /^it shows unallocated capacity ([\d,]+) COP and "([^"]+)" at ([\d.]+)% of total capacity$/,
  async ({ page, world }, unallocated: string, line: string, share: string) => {
    const capacity = norm(
      await page.getByRole("region", { name: world.t("budgeting.planner.capacity") }).textContent(),
    );
    expect(capacity).toContain(
      norm(world.t("budgeting.planner.unallocated", { amount: shown(unallocated) })),
    );
    const row = norm(await page.getByRole("listitem", { name: line }).textContent());
    expect(row).toContain(norm(world.t("budgeting.planner.ofCapacity", { share: percentShown(share) })));
  },
);
