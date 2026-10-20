import { expect, type Page } from "@playwright/test";
import { BUILT_IN_FORMATS, formatDate } from "../../../src/shared/ui/format/formatters";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";
import type { World } from "../support/world";

const DAY_KEYS: Record<string, string> = {
  Today: "ledger.day.today",
  Yesterday: "ledger.day.yesterday",
  "The day before yesterday": "ledger.day.dayBeforeYesterday",
};
/** "Today · 23:30" as the Spanish screen writes it: the day translated, the time as it is (a format, not a language). */
const onScreen = (world: { t: (key: string) => string }, english: string) => {
  const [day = "", time = ""] = english.split(" · ");
  return `${world.t(DAY_KEYS[day]!)} · ${time}`;
};
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });
/** 2026-10-31 at 12:00 in Bogotá, the day the accounts scenario's movements happen. */
const NOON = { date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota" };

const openForm = async (page: Page, world: World) => {
  await page.goto(`/spaces/${world.user!.spaceId}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
};
const sheetOf = (page: Page, world: World) =>
  page.getByRole("dialog", { name: world.t("ledger.when.title") });

Given(
  /^"([^"]+)" is signed in with the timezone "([^"]+)", the account "([^"]+)" with opening balance ([\d,]+) COP and the category "([^"]+)" in her personal space$/,
  async ({ page, world }, name: string, zone: string, account: string, pesos: string, category: string) => {
    await world.signUp(name, { timezone: zone });
    await world.seedAccount(account, {
      type: "BANK",
      openingBalance: cop(pesos),
      institution: account,
      lastFour: "1203",
      color: "STEEL",
    });
    await world.seedCategory(category);
    await page.goto("/");
  },
);

Given(/^the Clock reads (\S+)$/, async ({ page }, instant: string) => {
  // The browser's clock; the server's is HEARTH_E2E_FIXED_NOW (2026-11-01T04:30:00Z), which only the "today" headings read.
  await page.clock.setFixedTime(new Date(instant));
});

When("{string} opens the new expense form", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await openForm(page, world);
});

Then("the date and time chip reads {string}", async ({ page, world }, chip: string) => {
  await expect(page.getByTestId("when-chip")).toHaveText(onScreen(world, chip), { useInnerText: true });
});

When(
  /^"([^"]+)" enters "([^"]+)", ([\d,]+) COP, "([^"]+)" and "([^"]+)" and saves$/,
  async (
    { page, world },
    _name: string,
    description: string,
    pesos: string,
    category: string,
    account: string,
  ) => {
    await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
    await page.getByLabel(world.t("ledger.form.description")).fill(description);
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
    await page.getByRole("radio", { name: category }).click();
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.account")) }).click();
    await page.getByRole("radio", { name: new RegExp(account) }).click();
    await page.getByRole("button", { name: world.t("ledger.form.save.EXPENSE") }).click();
    await expect(page).toHaveURL(/\/transactions/);
  },
);

Then(
  /^the transaction has date (\S+), occurredAt "([^"]+)" and timeZone "([^"]+)"$/,
  async ({ world }, date: string, occurredAt: string, zone: string) => {
    const page = (await world.api.get(
      `/api/v1/spaces/${world.user!.spaceId}/transactions?period=${date.slice(0, 7)}`,
    )) as { items: { description: string; date: string; occurredAt: string; timeZone: string }[] };
    const tx = page.items.find((t) => t.description === "Market")!;
    expect([tx.date, new Date(tx.occurredAt).toISOString(), tx.timeZone]).toEqual([
      date,
      new Date(occurredAt).toISOString(),
      zone,
    ]);
  },
);

Then(
  /^the transaction list shows "([^"]+)" with ([\d,]+) COP at (\S+) under the day heading of the key "([^"]+)"$/,
  async ({ page, world }, description: string, pesos: string, time: string, key: string) => {
    const day = page.getByRole("region", { name: world.t(key) });
    const row = day.getByRole("listitem").filter({ hasText: description });
    await expect(row).toContainText(time);
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
  },
);

Then(
  /^the accounts screen shows "([^"]+)" with a balance of ([\d,]+) COP$/,
  async ({ page, world }, account: string, pesos: string) => {
    await page.goto(`/spaces/${world.user!.spaceId}/accounts`);
    expect(norm(await page.getByRole("listitem", { name: account }).textContent())).toContain(
      norm(shown(pesos)),
    );
  },
);

Given(
  /^an income of ([\d,]+) COP into "([^"]+)", an expense of ([\d,]+) COP from "([^"]+)" and a transfer of ([\d,]+) COP from "([^"]+)" to the WALLET "([^"]+)" opened with ([\d,]+) COP$/,
  async (
    { world },
    income: string,
    into: string,
    expense: string,
    from: string,
    transfer: string,
    source: string,
    wallet: string,
    opening: string,
  ) => {
    const walletId = await world.seedAccount(wallet, { type: "WALLET", openingBalance: cop(opening) });
    // Incomes and expenses both need a category (HU-E4-01): the Background's.
    const [categoryId] = [...world.categories.values()];
    await world.record("incomes", {
      ...NOON,
      categoryId,
      amount: cop(income),
      accountId: world.accounts.get(into),
    });
    await world.record("expenses", {
      ...NOON,
      categoryId,
      amount: cop(expense),
      accountId: world.accounts.get(from),
    });
    await world.record("transfers", {
      ...NOON,
      amount: cop(transfer),
      sourceAccountId: world.accounts.get(source),
      destinationAccountId: walletId,
    });
  },
);

Given(
  /^the CREDIT_CARD "([^"]+)" with balance (-?[\d,]+) COP, credit limit ([\d,]+) COP and payment day (\d+)$/,
  async ({ world }, name: string, balance: string, limit: string, day: string) => {
    await world.seedAccount(name, {
      type: "CREDIT_CARD",
      openingBalance: cop(balance),
      terms: { creditLimit: cop(limit), paymentDay: Number(day) },
    });
  },
);

Given(/^"([^"]+)" archived the account "([^"]+)"$/, async ({ world }, _name: string, account: string) => {
  const id = await world.seedAccount(account, { type: "WALLET", openingBalance: cop("0") });
  await world.api.post(`/api/v1/spaces/${world.user!.spaceId}/accounts/${id}/archive`, {});
});

When("{string} opens the accounts screen", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.goto(`/spaces/${world.user!.spaceId}/accounts`);
});

Then(
  /^"([^"]+)" shows a balance of ([\d,]+) COP with its type icon, color, institution and last four digits$/,
  async ({ page }, account: string, pesos: string) => {
    const row = page.getByRole("listitem", { name: account });
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
    expect(norm(await row.textContent())).toContain(`${account} ···1203`);
    await expect(row.locator("[data-icon='bank'][data-color='STEEL']")).toBeAttached();
  },
);

Then(
  /^"([^"]+)" shows (-?[\d,]+) COP with an available credit of ([\d,]+) COP and its next payment date$/,
  async ({ page, world }, account: string, balance: string, available: string) => {
    const { items } = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/accounts`)) as {
      items: { name: string; derived: { nextPaymentDate: string } }[];
    };
    const date = formatDate(items.find((a) => a.name === account)!.derived.nextPaymentDate, BUILT_IN_FORMATS);
    const text = norm(await page.getByRole("listitem", { name: account }).textContent());
    expect(text).toContain(norm(shown(balance)));
    expect(text).toContain(norm(world.t("accounts.card.available", { amount: shown(available) })));
    expect(text).toContain(norm(world.t("accounts.card.payBy", { date })));
  },
);

Then(
  /^the header shows "Available" ([\d,]+) COP and "Net worth" ([\d,]+) COP$/,
  async ({ page, world }, available: string, netWorth: string) => {
    const totals = norm(await page.getByRole("region", { name: world.t("accounts.totals") }).textContent());
    expect(totals).toContain(norm(`${world.t("accounts.available")}${shown(available)}`));
    expect(totals).toContain(norm(`${world.t("accounts.netWorth")}${shown(netWorth)}`));
  },
);

Then(
  /^"([^"]+)" is listed under archived accounts and is not offered in the account picker of the new expense form$/,
  async ({ page, world }, account: string) => {
    await expect(page.getByRole("region", { name: world.t("accounts.archived") })).toContainText(account);
    await openForm(page, world);
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.account")) }).click();
    const sheet = page.getByRole("dialog", { name: world.t("ledger.form.account") });
    await expect(sheet.getByRole("radio").first()).toBeVisible();
    await expect(sheet.getByRole("radio", { name: new RegExp(account) })).toHaveCount(0);
  },
);

Given(
  /^"([^"]+)" has the timeFormat "([^"]+)" and the weekStart "([^"]+)"$/,
  async ({ world }, _name: string, timeFormat: string, weekStart: string) => {
    await world.api.patch("/api/v1/me", { timeFormat, weekStart });
  },
);

When(
  "{string} opens the date and time sheet of the new expense form",
  async ({ page, world }, name: string) => {
    expect(name).toBe(world.user!.name);
    await openForm(page, world);
    await page.getByTestId("when-chip").click();
  },
);

Then(
  /^the quick-day buttons "([^"]+)", "([^"]+)" and "([^"]+)" are shown above a month calendar whose week starts on Monday$/,
  async ({ page, world }, first: string, second: string, third: string) => {
    const days = [first, second, third];
    const sheet = sheetOf(page, world);
    const quick = sheet.getByRole("radiogroup", { name: world.t("ledger.when.day") });
    const radios = quick.getByRole("radio");
    await expect(radios).toHaveCount(3);
    for (const [i, day] of days.entries()) await expect(radios.nth(i)).toContainText(world.t(DAY_KEYS[day]!));
    const grid = sheet.getByRole("grid");
    const follows = await quick.evaluate(
      (group, calendar) =>
        Boolean(group.compareDocumentPosition(calendar!) & Node.DOCUMENT_POSITION_FOLLOWING),
      await grid.elementHandle(),
    );
    expect(follows).toBe(true);
    await expect(grid.getByRole("columnheader").first()).toHaveText(world.t("common.weekdayShort.MONDAY"));
  },
);

When(
  /^"([^"]+)" chooses "(Today|Yesterday|The day before yesterday)"$/,
  async ({ page, world }, _name: string, day: string) => {
    const name = world.t(DAY_KEYS[day]!);
    await sheetOf(page, world)
      .getByRole("radio", { name: new RegExp(`^${name}`) })
      .click();
  },
);

When(/^sets the time to (\d\d):(\d\d)$/, async ({ page, world }, hh: string, mm: string) => {
  const sheet = sheetOf(page, world);
  const clock = sheet.getByRole("group", { name: world.t("ledger.when.time") });
  const target = Number(hh);
  const pm = sheet.getByRole("radio", { name: world.t("ledger.when.pm"), exact: true });
  const twelveHour = (await pm.count()) > 0;
  if (twelveHour)
    await sheet
      .getByRole("radio", { name: world.t(target >= 12 ? "ledger.when.pm" : "ledger.when.am"), exact: true })
      .click();
  const shownHour = (h: number) => (twelveHour ? String(h % 12 || 12) : String(h).padStart(2, "0"));
  const hourOutput = clock.locator("output").first();
  for (let i = 0; i < 24 && norm(await hourOutput.textContent()) !== shownHour(target); i += 1)
    await clock.getByRole("button", { name: world.t("ledger.when.hourDown") }).click();
  await expect(hourOutput).toHaveText(shownHour(target));
  await sheet.getByRole("button", { name: `:${mm}`, exact: true }).click();
});

Then("the sheet clock shows {string}", async ({ page, world }, expected: string) => {
  const sheet = sheetOf(page, world);
  const [clockText = "", half] = expected.split(" with ");
  const clock = sheet.getByRole("group", { name: world.t("ledger.when.time") });
  expect(
    norm(await clock.locator("output").first().textContent()) +
      " : " +
      norm(await clock.locator("output").nth(1).textContent()),
  ).toBe(clockText);
  expect(norm(await clock.textContent())).toContain(clockText);
  if (half)
    await expect(sheet.getByRole("radio", { name: world.t("ledger.when.pm"), exact: true })).toBeChecked();
});

Then("the chip reads {string}", async ({ page, world }, chip: string) => {
  await sheetOf(page, world)
    .getByRole("button", { name: new RegExp(`^${world.t("ledger.when.apply", { label: "" }).trim()}`) })
    .click();
  await expect(page.getByTestId("when-chip")).toHaveText(onScreen(world, chip), { useInnerText: true });
});
