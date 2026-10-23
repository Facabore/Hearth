import type { Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { STARTER_ACCOUNTS } from "../../../src/modules/accounts/domain/starter-accounts";

/** Shared by the a11y and layout specs: a fresh person with a personal space, and the same seeded ledger. */
const addresses = new WeakMap<Page, string>();

/** The visitor's address for the sign-up throttle: the page's request context does not send the context's extra headers. */
const headersOf = (page: Page, extra: Record<string, string> = {}) => ({
  ...(addresses.has(page) ? { "x-forwarded-for": addresses.get(page)! } : {}),
  ...extra,
});

export const get = async (page: Page, path: string) => {
  const response = await page.request.get(path, { headers: headersOf(page) });
  if (!response.ok()) throw new Error(`GET ${path} answered ${response.status()}: ${await response.text()}`);
  return response.json();
};

export const patch = async (page: Page, path: string, data: unknown) => {
  const response = await page.request.patch(path, { data, headers: headersOf(page) });
  if (!response.ok())
    throw new Error(`PATCH ${path} answered ${response.status()}: ${await response.text()}`);
  return response.json();
};

export const put = async (page: Page, path: string, data: unknown, extra: Record<string, string> = {}) => {
  const response = await page.request.put(path, { data, headers: headersOf(page, extra) });
  if (!response.ok()) throw new Error(`PUT ${path} answered ${response.status()}: ${await response.text()}`);
  return response.json();
};

export const post = async (page: Page, path: string, data: unknown, extra: Record<string, string> = {}) => {
  const response = await page.request.post(path, { data, headers: headersOf(page, extra) });
  if (!response.ok()) throw new Error(`POST ${path} answered ${response.status()}: ${await response.text()}`);
  return response.json();
};

/** A fresh person with a personal space and nothing else: her home shows the first-account card (P148). */
export const signUp = async (page: Page, tag: string, ip: string): Promise<string> => {
  addresses.set(page, ip);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
  await post(page, "/api/v1/auth/sign-up", {
    name: "Ana",
    email: `${tag}-${Date.now()}@example.com`,
    password: "123456789012",
    timezone: "America/Bogota",
  });
  const { items: spaces } = await get(page, "/api/v1/spaces");
  return spaces[0].id as string;
};

/** Issue 169: archives the starter accounts sign-up opened, for a page about a person with no active account. */
export const archiveStarterAccounts = async (page: Page, spaceId: string): Promise<void> => {
  const space = `/api/v1/spaces/${spaceId}`;
  const starters = new Set(STARTER_ACCOUNTS.map((starter) => starter.names.es));
  const { items } = await get(page, `${space}/accounts`);
  for (const account of items.filter((a: { name: string }) => starters.has(a.name)))
    await post(page, `${space}/accounts/${account.id}/archive`, {});
};

/** The same seeding as the e2e World: "Bancolombia", an archived "Old wallet", one expense in the first category. */
export const seedLedger = async (page: Page, spaceId: string): Promise<void> => {
  const space = `/api/v1/spaces/${spaceId}`;
  const account = await post(page, `${space}/accounts`, {
    name: "Bancolombia",
    type: "BANK",
    openingBalance: { amount: "200000000", currency: "COP" },
  });
  const old = await post(page, `${space}/accounts`, {
    name: "Old wallet",
    type: "WALLET",
    openingBalance: { amount: "0", currency: "COP" },
  });
  await post(page, `${space}/accounts/${old.id}/archive`, {});
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  await post(
    page,
    `${space}/expenses`,
    {
      description: "Market",
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount: { amount: "8500000", currency: "COP" },
      accountId: account.id,
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

/**
 * Records an income of 1,200,000 COP from the form, into the account it opens on, under the first category the
 * picker offers, and waits for the list it lands on: the save every toast test starts from (P195).
 */
export const saveIncomeFromForm = async (page: Page, spaceId: string): Promise<void> => {
  await page.goto(`/spaces/${spaceId}/new?type=income`);
  await page.locator("[data-ready='true']").waitFor({ state: "attached" });
  await page.getByLabel(es.ledger.form.amount).fill("1200000");
  await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
  await page.getByRole("dialog").getByRole("radio").first().click();
  const use = page.getByRole("dialog").getByRole("button", { name: /^Usar / });
  if (await use.isVisible()) await use.click();
  await page.getByRole("button", { name: es.ledger.form.save.INCOME }).click();
  await page.waitForURL(new RegExp(`/spaces/${spaceId}/transactions$`));
};
