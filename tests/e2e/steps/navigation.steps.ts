import { expect, type Page } from "@playwright/test";
import { BASE_URL } from "../support/base-url";
import { Given, Then, When } from "../support/fixtures";
import { openSpaceSettings } from "../support/space-settings";
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

When("{string} opens Accounts from her space's settings", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  // Ruling P309: a space's accounts are in its own settings, from the space switcher.
  await openSpaceSettings(page, world);
  // Exact: the first-steps card on the home also links to Cuentas (#152).
  await page.getByRole("link", { name: world.t("spaces.screen.accounts"), exact: true }).click();
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

// Ruling P272 (board E9-05 · 07): Crear un espacio compartido is a sheet over the switcher, on the screen it opened from.
When(
  "{string} opens Crear un espacio compartido from the space switcher",
  async ({ page, world }, name: string) => {
    expect(name).toBe(world.user!.name);
    const before = page.url();
    await page.getByRole("button", { name: world.t("shell.space.current", { name: "Personal" }) }).click();
    await page.getByRole("button", { name: world.t("shell.space.create") }).click();
    await expect(page.getByRole("dialog", { name: world.t("spaces.new.title") })).toBeVisible();
    expect(page.url()).toBe(before);
  },
);

// Phase 3a (ruling P272): Crear espacio is a sheet over the space switcher. The screen under it keeps its URL, while
// the modal sheet hides the rest of the page, the bottom bar included, from the accessibility tree.
Then("the Crear espacio sheet is open over the transactions page", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/transactions$`));
  const sheet = page.getByRole("dialog", { name: world.t("spaces.new.title") });
  await expect(sheet.getByLabel(world.t("spaces.new.name"))).toBeVisible();
  await expect(page.getByRole("link", { name: world.t("shell.nav.transactions"), exact: true })).toHaveCount(
    0,
  );
});

When("{string} goes back to the spaces in the sheet", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page
    .getByRole("dialog", { name: world.t("spaces.new.title") })
    .getByRole("button", { name: world.t("common.back") })
    .click();
});

Then("the space switcher lists her spaces", async ({ page, world }) => {
  const sheet = page.getByRole("dialog", { name: world.t("shell.space.title") });
  // Anchored: "Ajustes de Personal" (ruling P309) names the space too.
  await expect(sheet.getByRole("link", { name: /^Personal/ })).toBeVisible();
});

Then("her space's settings are shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/settings$`));
  await expect(page.getByRole("heading", { level: 1, name: world.t("spaces.screen.title") })).toBeVisible();
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
  // Miembros is a stacked screen (ruling P272): its own header names the space, under its title.
  await expect(page.getByRole("main").getByText(new RegExp(`^${space} · `))).toBeVisible();
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

/** Ruling P311 (amends P303): with Plan out of the bar, the planner is a stacked screen whose way out is Volver. */
Then("the planner is a stacked screen with its way back", async ({ page, world }) => {
  await expect(page.getByRole("link", { name: world.t("common.back") })).toBeVisible();
  await expect(page.getByRole("navigation", { name: world.t("shell.nav.main") })).toHaveCount(0);
});

When(/^she saves her capacity ([\d,]+) COP$/, async ({ page, world }, capacity: string) => {
  await page.getByRole("link", { name: world.t("budgeting.planner.editCapacities") }).click();
  await page
    .getByLabel(world.t("budgeting.capacity.field", { name: world.user!.name }))
    .fill(capacity.replaceAll(",", ""));
  await page.getByRole("button", { name: world.t("budgeting.capacity.save") }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

When("she closes the contributions sheet", async ({ page, world }) => {
  await page.getByRole("link", { name: world.t("budgeting.planner.editCapacities") }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: world.t("common.close") })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

When(
  /^she adds the line "([^"]+)" with ([\d,]+) COP$/,
  async ({ page, world }, line: string, planned: string) => {
    await page.getByRole("link", { name: world.t("budgeting.planner.addLine") }).click();
    await page.getByLabel(world.t("budgeting.lineEditor.field.name")).fill(line);
    await page.getByLabel(world.t("budgeting.lineEditor.field.planned")).fill(planned.replaceAll(",", ""));
    // A line needs categories or Todo lo demás, as in personal-plan.steps.ts.
    await page.getByRole("checkbox", { name: world.t("budgeting.lineEditor.field.catchAll") }).click();
    await page.getByRole("button", { name: world.t("budgeting.lineEditor.add") }).click();
    await expect(page.getByRole("listitem", { name: line })).toBeVisible();
  },
);

/** Ruling P311: the Plan views are a stacked screen whose way back is the space's Configuración. */
Then("the Plan of her personal space is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/plan(\\?period=[\\d-]+)?$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: world.t("common.back") })).toHaveAttribute(
    "href",
    `${homePath(world)}/settings`,
  );
});

Then("the planner is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/plans/[0-9a-f-]{36}$`));
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

/** Ruling P302 (#240): Saldos in the personal space says the person is al día, with nothing to settle. */
Then("the balances page of her personal space is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/balances$`));
  await expect(page.getByText(world.t("balances.you.settled"), { exact: true })).toBeVisible();
  await expect(
    // The personal space is named "Personal" when it is created (space.ts).
    page.getByText(world.t("balances.personalNote", { space: "Personal" })),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: world.t("shell.nav.balances"), exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

/** Ruling P311: Más, the bar's fifth tab. */
When("{string} opens Más from the bar", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  const nav = page.getByRole("navigation", { name: world.t("shell.nav.main") });
  await nav.getByRole("link", { name: world.t("shell.nav.more"), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/more$`));
});

Then("the module grid is shown, with the modules to come marked Próximamente", async ({ page, world }) => {
  await expect(page.getByRole("heading", { level: 1, name: world.t("shell.more.title") })).toBeVisible();
  const nav = page.getByRole("navigation", { name: world.t("shell.nav.main") });
  await expect(nav.getByRole("link", { name: world.t("shell.nav.more"), exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const grid = page.getByRole("main").getByRole("list");
  for (const [key, suffix] of [
    ["shell.more.settings", "/settings"],
    ["shell.more.accounts", "/accounts"],
    ["shell.more.categories", "/categories"],
    ["shell.more.recurring", "/recurrences"],
  ] as const)
    await expect(grid.getByRole("link", { name: world.t(key), exact: true })).toHaveAttribute(
      "href",
      `${homePath(world)}${suffix}`,
    );
  await expect(grid.getByText(world.t("shell.more.soon"), { exact: true })).toHaveCount(3);
});

When(
  "{string} opens her space's Configuración from the header's gear",
  async ({ page, world }, name: string) => {
    expect(name).toBe(world.user!.name);
    await openSpaceSettings(page, world);
  },
);
