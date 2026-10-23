import { expect, type Page } from "@playwright/test";
import type { DataTable } from "playwright-bdd";
import { After, Given, Then, When } from "../support/fixtures";
import { minor } from "../support/money";
import {
  clientOf,
  householdOf,
  seedAccounts,
  seedHome,
  seedHousehold,
  seedRecurrence,
} from "../support/plan-seed";
import type { World } from "../support/world";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The e2e server's today in Bogotá (P133): 2026-11-01T04:30:00Z, so the record form saves into 2026-10. */
const TODAY = { date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota" };
const TODAY_PERIOD = TODAY.date.slice(0, 7);
/** What `seedHome` seeds (Task 17c): the features name the same figures, so a drift between them fails here. */
const HOME = { line: "Home", planned: "1,470,000", spent: "1,300,000", category: "Groceries" };

const accountsOf = new WeakMap<World, Awaited<ReturnType<typeof seedAccounts>>>();
/** The minor amount a scenario typed in the record form. */
const typedOf = new WeakMap<World, string>();
/** The recurrences a scenario defined, ended after it so the e2e server's scheduler never meets them again. */
const recurrencesOf = new WeakMap<World, string[]>();

/** The name `spaceId` gives the category of the catalog key `english.toLowerCase()` ("Groceries" → "Mercado"). */
const categoryOf = async (world: World, spaceId: string, english: string) => {
  const { items } = (await world.api.get(`/api/v1/spaces/${spaceId}/categories`)) as {
    items: { categories: { id: string; key: string | null; name: string }[] }[];
  };
  const category = items.flatMap((g) => g.categories).find((c) => c.key === english.toLowerCase());
  if (!category) throw new Error(`No category with the key of "${english}" in ${spaceId}`);
  return category;
};

/** The space's expenses of the period whose amount is the one the scenario typed. */
const typedExpenses = async (world: World, spaceId: string) => {
  const { items } = (await world.api.get(
    `/api/v1/spaces/${spaceId}/transactions?period=${TODAY_PERIOD}`,
  )) as { items: { type: string; amount: { amount: string } }[] };
  return items.filter((t) => t.type === "EXPENSE" && t.amount.amount === typedOf.get(world));
};

/** The line dashboard's row whose header starts with `line`. */
const lineRow = (page: Page, world: World, line: string) =>
  page
    .getByRole("main")
    .getByRole("table", { name: world.t("reports.lines.caption") })
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: new RegExp(`^${escaped(line)}`) }) });

Given(
  /^"([^"]+)" has the household "([^"]+)" with "([^"]+)" as "(ADMIN|MEMBER|VIEWER)"$/,
  async ({ world }, owner: string, name: string, member: string, role: string) => {
    await world.signUp(owner);
    const hh = await seedHousehold(world, { name, member, role: role as "ADMIN" | "MEMBER" | "VIEWER" });
    accountsOf.set(world, await seedAccounts(world, hh));
  },
);

Given(
  /^the (ACTIVE|CLOSED) plan for (\S+) has the line "([^"]+)" with (?:rollover "([A-Z]+)", )?planned ([\d,]+) COP and ([\d,]+) COP spent in "([^"]+)"$/,
  async (
    { world },
    status: string,
    period: string,
    line: string,
    rollover: string | null | undefined,
    planned: string,
    spent: string,
    category: string,
  ) => {
    expect({ line, planned, spent, category }).toEqual(HOME);
    await seedHome(clientOf(world), householdOf(world), accountsOf.get(world)!, {
      period,
      rolloverMode: (rollover ?? "RESET") as "RESET" | "ROLLOVER" | "ADJUSTED",
      close: status === "CLOSED",
    });
  },
);

When(
  /^"([^"]+)" records an expense of ([\d,]+) COP in "([^"]+)" in "([^"]+)"(?: and taps "([^"]+)")?$/,
  async (
    { page, world },
    who: string,
    pesos: string,
    category: string,
    space: string,
    tap: string | null | undefined,
  ) => {
    expect(who).toBe(world.user!.name);
    const spaceId = world.spaces.get(space)!;
    const { name } = await categoryOf(world, spaceId, category);
    await page.goto(`/spaces/${spaceId}/new`);
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
    await page.getByRole("radio", { name, exact: true }).click();
    typedOf.set(world, minor(pesos));
    if (!tap) return;
    expect(tap).toBe(world.t("ledger.form.save.EXPENSE"));
    await page.getByRole("button", { name: tap, exact: true }).click();
  },
);

Then(
  /^the form asks "([^"]+)" and says "([^"]+)"$/,
  async ({ page, world }, question: string, says: string) => {
    expect(question).toBe(world.t("ledger.lineWarning.confirmTitle"));
    // Ruling P235: the question takes the focus, and its panel says by how much the line goes over.
    await expect(page.getByRole("heading", { name: question })).toBeFocused();
    await expect(page.getByRole("main").getByRole("region", { name: question })).toContainText(says);
  },
);

Then("nothing was saved", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/new$/);
  expect(await typedExpenses(world, householdOf(world).spaceId)).toHaveLength(0);
});

When(/^she taps "([^"]+)"$/, async ({ page, world }, button: string) => {
  expect(button).toBe(world.t("ledger.lineWarning.confirm"));
  await page.getByRole("button", { name: button, exact: true }).click();
});

Then("the expense is saved", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/transactions/);
  expect(await typedExpenses(world, householdOf(world).spaceId)).toHaveLength(1);
});

Then(
  /^the line dashboard for (\S+) shows "([^"]+)" with available "([^"]+)" and the badge "([^"]+)"$/,
  async ({ page, world }, period: string, line: string, available: string, badge: string) => {
    expect(badge).toBe(world.t("reports.lines.overspent"));
    await page.goto(`/spaces/${householdOf(world).spaceId}/plan?period=${period}`);
    const row = lineRow(page, world, line);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("rowheader")).toContainText(badge);
    expect(norm((await row.getByRole("cell").allTextContents()).at(-1)!)).toBe(norm(available));
  },
);

Then(/^the form notes "([^"]+)"$/, async ({ page }, note: string) => {
  await expect(page.getByRole("main").getByText(note, { exact: true })).toBeVisible();
});

Then(/^tapping "([^"]+)" saves it without asking$/, async ({ page, world }, button: string) => {
  expect(button).toBe(world.t("ledger.form.save.EXPENSE"));
  await page.getByRole("button", { name: button, exact: true }).click();
  // Asking would keep the form open on its question; a NEAR note saves on the first tap (ruling P235).
  await expect(page).toHaveURL(/\/transactions/);
  expect(await typedExpenses(world, householdOf(world).spaceId)).toHaveLength(1);
});

When(
  /^"([^"]+)" copies the plan into (\S+) and opens the line dashboard for (\S+)$/,
  async ({ page, world }, who: string, period: string, opened: string) => {
    expect(who).toBe(world.user!.name);
    const { spaceId } = householdOf(world);
    await clientOf(world).post(`/api/v1/spaces/${spaceId}/plans`, { period, copyFrom: "previous" });
    await page.goto(`/spaces/${spaceId}/plan?period=${opened}`);
  },
);

Then(
  /^"([^"]+)" shows "([^"]+)" and available "([^"]+)"$/,
  async ({ page, world }, line: string, carry: string, available: string) => {
    const row = lineRow(page, world, line);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("rowheader")).toContainText(carry);
    expect(norm((await row.getByRole("cell").allTextContents()).at(-1)!)).toBe(norm(available));
  },
);

Given(
  /^"([^"]+)" has only the BANK account "([^"]+)" with ([\d,]+) COP$/,
  async ({ world }, name: string, account: string, pesos: string) => {
    await world.signUp(name);
    // Issue 169: "only" this account: her starter accounts are archived, so the active list holds just it.
    await world.archiveStarterAccounts();
    await world.seedAccount(account, { type: "BANK", openingBalance: cop(pesos) });
    const { items } = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/accounts`)) as {
      items: unknown[];
    };
    expect(items).toHaveLength(1);
  },
);

Given(
  /^she recorded a one-off expense of ([\d,]+) COP from "([^"]+)" today, which is not repeated$/,
  async ({ world }, pesos: string, account: string) => {
    const { id } = await categoryOf(world, world.user!.spaceId, "Groceries");
    await world.record("expenses", {
      description: "Mercado del mes",
      ...TODAY,
      categoryId: id,
      amount: cop(pesos),
      accountId: world.accounts.get(account),
    });
  },
);

/** #150: a MONTHLY recurrence of the personal space, AUTO, kept so the After hook ends it. */
const defineMonthly = async (
  world: World,
  body: { description: string; pesos: string; template: Record<string, unknown>; day: string; from: string },
) => {
  const { id } = await seedRecurrence(clientOf(world), world.user!.spaceId, {
    description: body.description,
    amount: cop(body.pesos),
    template: body.template,
    schedule: { kind: "MONTHLY", day: Number(body.day) },
    mode: "AUTO",
    startDate: body.from,
  });
  recurrencesOf.set(world, [...(recurrencesOf.get(world) ?? []), id]);
};

Given(
  /^her "([^"]+)" of ([\d,]+) COP comes into "([^"]+)" every month on day (\d+) from (\S+)$/,
  async ({ world }, description: string, pesos: string, account: string, day: string, from: string) => {
    const { id } = await categoryOf(world, world.user!.spaceId, "Salary");
    await defineMonthly(world, {
      description,
      pesos,
      template: { type: "INCOME", categoryId: id, accountId: world.accounts.get(account) },
      day,
      from,
    });
  },
);

Given(
  /^her "([^"]+)" of ([\d,]+) COP is paid from "([^"]+)" every month on day (\d+) from (\S+)$/,
  async ({ world }, description: string, pesos: string, account: string, day: string, from: string) => {
    const { id } = await categoryOf(world, world.user!.spaceId, "Utilities");
    const { items } = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/members`)) as {
      items: { id: string }[];
    };
    await defineMonthly(world, {
      description,
      pesos,
      template: {
        type: "EXPENSE",
        categoryId: id,
        payer: { memberId: items[0]!.id, accountId: world.accounts.get(account) },
      },
      day,
      from,
    });
  },
);

When(/^she opens "([^"]+)" with (\d+) days$/, async ({ page, world }, view: string, days: string) => {
  expect(view).toBe(world.t("reports.view.calendar"));
  await page.goto(`/spaces/${world.user!.spaceId}/plan`);
  await page
    .getByRole("navigation", { name: world.t("reports.tabs.label") })
    .getByRole("link", { name: view })
    .click();
  await expect(page).toHaveURL(/\/plan\/calendar$/);
  await page
    .getByRole("main")
    .getByRole("link", { name: world.t("reports.calendar.days", { days }) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/plan/calendar\\?days=${days}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: world.t("reports.calendar.title", { days }) }),
  ).toBeVisible();
});

Then("the days read", async ({ page, world }, table: DataTable) => {
  const list = page.getByRole("main").getByRole("list", { name: world.t("reports.calendar.listLabel") });
  const rows = table.hashes();
  // Only these dates: the one-off expense adds none, since the calendar projects no pace (ruling P245).
  await expect(list.getByRole("heading", { level: 2 })).toHaveText(rows.map((row) => row.date!));
  for (const row of rows) {
    const day = list.getByRole("listitem", { name: row.date!, exact: true });
    const movement = day.getByRole("listitem").filter({ hasText: row.movement! });
    await expect(movement).toHaveCount(1);
    expect(norm(await movement.textContent())).toContain(norm(row.amount!));
    await expect(day).toContainText(
      world.t("reports.calendar.balanceAfter", { balance: row["balance after"]! }),
    );
  }
});

Then(/^the summary reads "([^"]+)"$/, async ({ page, world }, summary: string) => {
  await expect(
    page.getByRole("main").getByRole("region", { name: world.t("reports.calendar.summary") }),
  ).toContainText(summary);
});

After(async ({ world }) => {
  for (const id of recurrencesOf.get(world) ?? [])
    await world.api.post(`/api/v1/spaces/${world.user!.spaceId}/recurrences/${id}/end`, {});
});
