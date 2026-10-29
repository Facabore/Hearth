import { expect, type Page } from "@playwright/test";
import { BASE_URL } from "../support/base-url";
import { Given, Then, When } from "../support/fixtures";
import type { World } from "../support/world";

const homePath = (world: World) => `/spaces/${world.user!.spaceId}`;
const escaped = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The tab opened by URL, when a scenario has one; every other step acts on it instead of the first page. */
let deepLinkTab: Page | undefined;
const current = (page: Page) => deepLinkTab ?? page;

Given("the viewport is {int} by {int}", async ({ page }, width: number, height: number) => {
  deepLinkTab = undefined;
  await page.setViewportSize({ width, height });
});

const TABS: Record<string, { key: string; suffix: string }> = {
  Inicio: { key: "shell.nav.home", suffix: "" },
  Movimientos: { key: "shell.nav.transactions", suffix: "/transactions" },
};

When(/^"([^"]+)" opens the (Inicio|Movimientos) tab$/, async ({ page, world }, name: string, tab: string) => {
  expect(name).toBe(world.user!.name);
  const { key, suffix } = TABS[tab]!;
  await page.getByRole("link", { name: world.t(key), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}${suffix}$`));
});

When("{string} opens Accounts from the user menu", async ({ page, world }, name: string) => {
  await page.getByRole("button", { name: world.t("shell.profile.open", { name }) }).click();
  await page.getByRole("link", { name: world.t("shell.profile.accounts") }).click();
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/accounts`));
});

Then("the accounts screen is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/accounts$`));
  await expect(page.getByRole("heading", { level: 1, name: world.t("accounts.title") })).toBeVisible();
});

When("{string} chooses Volver", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await current(page)
    .getByRole("link", { name: world.t("common.back") })
    .click();
});

Then("the transactions page is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/transactions$`));
  await expect(
    page.getByRole("link", { name: world.t("shell.nav.transactions"), exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

When("{string} opens the accounts screen by its URL in a new tab", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  // A new tab shares the session cookie but not sessionStorage: it has no history of its own.
  const tab = await page.context().newPage();
  await tab.setViewportSize(page.viewportSize()!);
  await tab.goto(`${homePath(world)}/accounts`);
  await expect(tab.getByRole("heading", { level: 1, name: world.t("accounts.title") })).toBeVisible();
  deepLinkTab = tab;
});

Then("the home page of her personal space is shown", async ({ page, world }) => {
  const shown = current(page);
  await expect(shown).toHaveURL(new RegExp(`${escaped(homePath(world))}$`));
  await expect(shown.getByRole("heading", { level: 1, name: world.t("home.title") })).toBeAttached();
});

When(
  "{string} chooses {string} on the first-account card of the home page",
  async ({ page, world }, name: string, action: string) => {
    expect(name).toBe(world.user!.name);
    expect(action).toBe(world.t("home.firstAccount.action"));
    await page
      .getByRole("region", { name: world.t("home.firstAccount.title") })
      .getByRole("link", { name: action })
      .click();
    await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/accounts\\?`));
  },
);

When(
  "{string} creates the CASH account {string} from the accounts screen",
  async ({ page, world }, name: string, account: string) => {
    expect(name).toBe(world.user!.name);
    await page.getByRole("link", { name: world.t("accounts.new") }).click();
    await page.getByRole("radio", { name: world.t("accounts.type.CASH") }).click();
    await page.getByLabel(world.t("accounts.field.name")).fill(account);
    await page.getByLabel(world.t("accounts.field.opening")).fill("0");
    await page.getByRole("button", { name: world.t("accounts.create") }).click();
  },
);

Then("the home page lists the account {string}", async ({ page, world }, account: string) => {
  await expect(page.getByRole("region", { name: world.t("home.accounts") })).toContainText(account);
});

Then("the accounts screen lists {string}", async ({ page }, account: string) => {
  await expect(page.getByRole("listitem", { name: account })).toBeVisible();
});

When("{string} opens the create-space link of the space switcher", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByRole("button", { name: world.t("shell.space.current", { name: "Personal" }) }).click();
  await page.getByRole("link", { name: world.t("shell.space.create") }).click();
  await expect(page).toHaveURL(/\/spaces\/new\?/);
});

When("{string} creates the shared space {string}", async ({ page, world }, name: string, space: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByLabel(world.t("spaces.new.name")).fill(space);
  await page.getByRole("button", { name: world.t("spaces.new.create") }).click();
  // Creating a space ends on its members screen. A Back pressed before the save answers would be followed by the
  // save's own move there, which is not what these scenarios walk through.
  await expect(page).toHaveURL(/\/spaces\/(?!new)[0-9a-f-]{36}\/members$/);
});

// The product behaviour kept on purpose: creating a space switches to it, whatever screen the flow started from.
Then("the members screen of the new space {string} is shown", async ({ page, world }, space: string) => {
  await expect(page).toHaveURL(/\/spaces\/(?!new)[0-9a-f-]{36}\/members$/);
  expect(page.url()).not.toContain(world.user!.spaceId);
  await expect(
    page.getByRole("button", { name: world.t("shell.space.current", { name: space }) }),
  ).toBeVisible();
});

When("{string} goes back in the browser", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.goBack();
});

Given("{string} owns the shared space {string}", async ({ world }, name: string, space: string) => {
  expect(name).toBe(world.user!.name);
  const created = (await world.api.post("/api/v1/spaces", {
    kind: "SHARED",
    name: space,
    currency: "COP",
  })) as {
    id: string;
  };
  world.spaces.set(space, created.id);
});

When(
  "{string} opens the members screen of {string} by its URL while signed out",
  async ({ page, world }, name: string, space: string) => {
    expect(name).toBe(world.user!.name);
    await page.context().clearCookies();
    await page.goto(`/spaces/${world.spaces.get(space)}/members`);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  },
);

When("{string} signs in again", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByLabel(world.t("auth.email")).fill(world.user!.email);
  await page.getByLabel(world.t("auth.password"), { exact: true }).fill("123456789012");
  await page.getByRole("button", { name: world.t("auth.signIn.submit") }).click();
});

Then("the members screen of {string} is shown", async ({ page, world }, space: string) => {
  await expect(page).toHaveURL(new RegExp(`/spaces/${world.spaces.get(space)}/members$`));
});

Then("the home page of {string} is shown", async ({ page, world }, space: string) => {
  await expect(page).toHaveURL(new RegExp(`/spaces/${world.spaces.get(space)}$`));
  expect(new URL(page.url()).origin).toBe(BASE_URL);
});

When(
  "{string} opens the home page of {string} by its URL",
  async ({ page, world }, name: string, space: string) => {
    expect(name).toBe(world.user!.name);
    await page.goto(`/spaces/${world.spaces.get(space)}`);
  },
);

When("{string} opens the Saldos tab", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByRole("link", { name: world.t("shell.nav.balances"), exact: true }).click();
  await expect(page).toHaveURL(/\/balances$/);
});

When("{string} opens her balance history from Saldos", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page
    .getByRole("link", { name: /Ver historial$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/members\/[^/]+\/history$/);
});

When(
  "{string} steps to the previous period {int} times",
  async ({ page, world }, name: string, times: number) => {
    expect(name).toBe(world.user!.name);
    const previous = page.getByRole("link", { name: world.t("balances.history.previous") });
    for (let step = 0; step < times; step += 1) {
      const before = page.url();
      const href = await previous.getAttribute("href");
      expect(href, "the previous period's link").not.toBeNull();
      await previous.click();
      await expect.poll(() => page.url()).not.toBe(before);
      // ADR 0006: the address moves before the period's screen does; a step is taken once the screen shows it.
      await expect(previous).not.toHaveAttribute("href", href!);
    }
  },
);

Then("the balances page of {string} is shown", async ({ page, world }, space: string) => {
  await expect(page).toHaveURL(new RegExp(`/spaces/${world.spaces.get(space)}/balances$`));
});
