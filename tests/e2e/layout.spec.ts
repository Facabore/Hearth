import { randomInt } from "node:crypto";
import { expect, request, test as base, type Browser, type Locator, type Page } from "@playwright/test";
import en from "../../src/i18n/messages/en.json" with { type: "json" };
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { BASE_URL } from "./support/base-url";
import { Person } from "./support/people";
import { categoryIdsByKey, clientOf, seedHome, seedHousehold, seedRecurrence } from "./support/plan-seed";
import {
  archiveStarterAccounts,
  get,
  patch,
  post,
  put,
  saveIncomeFromForm,
  seedLedger,
  signUp,
} from "./support/seed";
import { World } from "./support/world";

/**
 * Phone-width layout guards (UI Definition of Done, WCAG 1.4.10 Reflow, 2.4.11 Focus Not Obscured, 2.5.5 Target Size):
 * measured in a real browser against the standalone build, at the 390 x 844 phone of the audit and at 320 px.
 */
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };
const TARGET = 44;

const WIDE_FONT_CSS = '* { font-family: Verdana, "DejaVu Sans", sans-serif !important; }';

/** The addresses the tests open on purpose to see the not-found page: the browser logs their 404 (N1). */
const MISSING = ["/nope", "/spaces/does-not-exist/accounts"];

/** The refusal a test stages on purpose (a plan's close answering 409): the browser logs every failed response. */
const STAGED_REFUSAL = /\/api\/v1\/spaces\/[^/]+\/plans\/[^/]+\/close$/;

/** Every test fails on a `console.error` or an uncaught page error: nothing may log one on a normal visit. */
const test = base.extend<{ errors: string[]; wideFont: boolean }>({
  /**
   * Linux Chromium falls back to DejaVu Sans / Liberation for the `system-ui` stack, which is wider than Segoe UI on
   * Windows. A wide face on every machine catches that class of overflow locally; `LAYOUT_WIDE_FONT=1` forces it for
   * the whole file.
   */
  wideFont: [process.env.LAYOUT_WIDE_FONT === "1", { option: true }],
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const { url } = message.location();
        if (/ 404 /.test(message.text()) && MISSING.some((path) => url.endsWith(path))) return;
        if (/ 409 /.test(message.text()) && STAGED_REFUSAL.test(url)) return;
        errors.push(`${message.text()} @ ${message.location().url}`);
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
test.use({ viewport: PHONE });

/** Puts the wide face on every page of a page or a context (the init script runs before the page's own scripts). */
const useWideFont = (target: Pick<Page, "addInitScript">) =>
  target.addInitScript((css) => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.documentElement.append(style);
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  }, WIDE_FONT_CSS);

test.beforeEach(async ({ page, wideFont }) => {
  if (wideFont) await useWideFont(page);
});

/** The longest realistic strings: a long account name and a long description with a big amount (UX checklist A2). */
const seedLong = async (page: Page, spaceId: string) => {
  const space = `/api/v1/spaces/${spaceId}`;
  const account = await post(page, `${space}/accounts`, {
    name: "Cuenta de ahorros de la familia Rodríguez Hernández",
    type: "BANK",
    openingBalance: { amount: "250000000000", currency: "COP" },
  });
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  await post(
    page,
    `${space}/expenses`,
    {
      description: "Mercado semanal en la plaza de Paloquemao con frutas verduras y otras cosas",
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount: { amount: "123456789000", currency: "COP" },
      accountId: account.id,
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

/**
 * The session ledger's "Bancolombia". Issue 169's starter accounts ("Ahorros" first) sort around it, so a test names
 * the account it pays from instead of taking the first one.
 */
const bancolombiaIn = (accounts: { id: string; name: string }[]): string =>
  accounts.find((a) => a.name === "Bancolombia")!.id;

/** A fresh person, her ledger and a shared space, each test from its own address (the throttles never meet). */
const session = async (page: Page, tag: string) => {
  // Random, not a counter: a failed test restarts its worker, and the sign-up throttle (10 an hour) is per address.
  const address = `10.253.${randomInt(256)}.${randomInt(1, 255)}`;
  const spaceId = await signUp(page, `layout-${tag}`, address);
  await seedLedger(page, spaceId);
  await seedLong(page, spaceId);
  await patch(page, "/api/v1/me", { timeFormat: "H12" });
  const shared = (await post(page, "/api/v1/spaces", { kind: "SHARED", name: "Casa", currency: "COP" })) as {
    id: string;
  };
  return { spaceId, sharedId: shared.id };
};

/** #150: a recurrence's name with nothing to break it at, as long as a realistic one gets. */
const UNBROKEN_RECURRENCE = "R".repeat(60);

/**
 * #142, #143, #150 (Task 17c), seeded through the plan seed's `SeedClient`: the session's Ana gets a household (Juan its
 * MEMBER) whose ACTIVE October plan has Home rolling over with 1,300,000 COP spent, and its November copy, which waits
 * for October to close (the longest carry text). Her personal space gets an expense recurrence with an unbroken name
 * and a 15-digit amount inside the calendar's window. Juan is only needed to seed, so his context is closed here.
 */
const seedAdditions = async (page: Page, spaceId: string, testId: string) => {
  const world = new World(page, testId, `10.252.${randomInt(256)}.${randomInt(1, 255)}`, request);
  world.user = { name: "Ana", email: "", spaceId };
  try {
    const household = await seedHousehold(world, { name: "Household", member: "Juan", role: "MEMBER" });
    const ana = clientOf(world);
    // The session's ledger already holds her "Bancolombia"; the savings line needs a SAVINGS account of hers: the
    // "Ahorros" sign-up opened at zero (issue 169).
    const { items: owned } = await get(page, `/api/v1/spaces/${spaceId}/accounts`);
    const accounts = {
      bancolombia: owned.find((a: { name: string }) => a.name === "Bancolombia").id as string,
      savings: owned.find((a: { name: string }) => a.name === "Ahorros").id as string,
    };
    await seedHome(ana, household, accounts, { period: "2026-10", rolloverMode: "ROLLOVER", close: false });
    await ana.post(`/api/v1/spaces/${household.spaceId}/plans`, { period: "2026-11", copyFrom: "previous" });
    const keys = await categoryIdsByKey(ana, spaceId);
    const { items: members } = await get(page, `/api/v1/spaces/${spaceId}/members`);
    await seedRecurrence(ana, spaceId, {
      description: UNBROKEN_RECURRENCE,
      amount: { amount: HUGE_EXPENSE, currency: "COP" },
      template: {
        type: "EXPENSE",
        categoryId: keys.utilities,
        payer: { memberId: members[0].id, accountId: accounts.bancolombia },
      },
      schedule: { kind: "MONTHLY", day: 5 },
      mode: "AUTO",
      startDate: "2026-11-05",
    });
    return household.spaceId;
  } finally {
    await world.dispose();
  }
};

/** #142 (ruling P235): on the open record form of the household, 212,300 COP of Groceries takes Home over; Save asks. */
const askBeforeSaving = async (page: Page) => {
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  await page.getByLabel(es.ledger.form.amount).fill("212300");
  await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
  await page.getByRole("radio", { name: /^Mercado|^Groceries/ }).click();
  await page.getByRole("button", { name: es.ledger.form.save.EXPENSE, exact: true }).click();
  await expect(page.getByRole("heading", { name: es.ledger.lineWarning.confirmTitle })).toBeFocused();
};

/**
 * A shared fund with a long name that an expense has just taken below zero (HU-E9-06, P170): the address the form opens
 * after that save, with its notice. The expense is recorded through the API, so the warning is the API's own.
 */
const FUND_NAME = "Fondo común de la familia Rodríguez Hernández del hogar";
const warnedList = async (page: Page, sharedId: string) => {
  const space = `/api/v1/spaces/${sharedId}`;
  const fund = await post(page, `${space}/accounts`, {
    name: FUND_NAME,
    type: "SHARED_FUND",
    openingBalance: { amount: "0", currency: "COP" },
  });
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  const amount = { amount: "200000000", currency: "COP" };
  const recorded = await post(
    page,
    `${space}/expenses`,
    {
      description: "Arriendo",
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount,
      payments: [{ memberId: null, accountId: fund.id, amount }],
    },
    { "idempotency-key": crypto.randomUUID() },
  );
  expect(recorded.warnings.map((w: { code: string }) => w.code)).toEqual(["FundBalanceNegative"]);
  return `/spaces/${sharedId}/transactions?notice=FundBalanceNegative&account=${fund.id}`;
};

/**
 * A member's balance history (HU-E9-07, P176): a guest with a real, long name owes half of an expense that the person
 * paid, so the history has one movement with a long title and big amounts. `minor` is that expense: the huge one is
 * for the screens that show only the history, because it also empties the account it was paid from, and the personal
 * home would then show a balance of trillions. The expense is recorded through the API; the address opens the period
 * that holds it.
 */
const BIG_EXPENSE = "123456789000";
const HUGE_EXPENSE = "123456789012400";
const HISTORY_GUEST = "Carlos Alberto Rodríguez Hernández de la Vega";
/**
 * The address of the edit route of the long expense `seedLong` records: the sheet's own Editar link, with the list it
 * was opened from as its `returnTo` (ruling P191).
 */
const editPathOf = async (page: Page, spaceId: string) => {
  await page.goto(`/spaces/${spaceId}/transactions`);
  await settle(page);
  await page.getByRole("link", { name: /Mercado semanal/ }).click();
  const href = await page.getByRole("link", { name: es.ledger.detail.edit }).getAttribute("href");
  expect(href, "the sheet offers Editar").toContain(`/spaces/${spaceId}/transactions/`);
  return href!;
};
/** The longest names the API accepts (space 80, member 100 characters), with no break opportunity. */
const UNBROKEN_SPACE = "W".repeat(80);
const UNBROKEN_NAME = "M".repeat(100);
const historyPath = async (
  page: Page,
  spaceId: string,
  sharedId: string,
  minor = BIG_EXPENSE,
  guestName = HISTORY_GUEST,
) => {
  const space = `/api/v1/spaces/${sharedId}`;
  // The person pays from an account of their own: a shared space holds only funds, so it is one of their personal space.
  const { items: accounts } = await get(page, `/api/v1/spaces/${spaceId}/accounts`);
  const account = { id: bancolombiaIn(accounts) };
  const guest = await post(page, `${space}/guests`, { displayName: guestName });
  const { items: members } = await get(page, `${space}/members`);
  const payer = members.find((m: { kind: string }) => m.kind === "USER");
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  const amount = { amount: minor, currency: "COP" };
  await post(
    page,
    `${space}/expenses`,
    {
      description: "Mercado semanal en la plaza de Paloquemao con frutas verduras y otras cosas",
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount,
      payments: [{ memberId: payer.id, accountId: account.id, amount }],
    },
    { "idempotency-key": crypto.randomUUID() },
  );
  return `/spaces/${sharedId}/members/${guest.id}/history?from=2026-10-30`;
};

/**
 * A split with a guest whose name is as long as a real one (HU-E9-06, P172), recorded through the API: the person's
 * "Dividir con alguien" sheet then lists a person with a direct space. Once per page.
 */
const GUEST_NAME = "Carlos Alberto Rodríguez Hernández de la Vega";
const withDirectSpace = new WeakSet<Page>();
const ensureDirectSpace = async (page: Page, spaceId: string) => {
  if (withDirectSpace.has(page)) return;
  withDirectSpace.add(page);
  const space = `/api/v1/spaces/${spaceId}`;
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryKey: string = groups.flatMap((g: { categories: { key: string | null }[] }) => g.categories)[0]
    .key;
  const { items: accounts } = await get(page, `${space}/accounts`);
  await post(
    page,
    "/api/v1/direct-splits",
    {
      description: "Cena",
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:00:00.000Z",
      timeZone: "America/Bogota",
      counterpart: { kind: "GUEST", displayName: GUEST_NAME },
      categoryKey,
      amount: { amount: "12000000", currency: "COP" },
      accountId: bancolombiaIn(accounts),
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

/**
 * The settle-up sheet of the shared space "Casa" (HU-E9-07, P174), opened with a guest as the payer: a guest with a real,
 * long name is added through the API once per page, so the sheet lists a long chip and shows the guest's note.
 */
const withSharedGuest = new WeakSet<Page>();
const ensureSharedGuest = async (page: Page) => {
  if (withSharedGuest.has(page)) return;
  withSharedGuest.add(page);
  const sharedId = /\/spaces\/([^/]+)/.exec(new URL(page.url()).pathname)![1];
  await post(page, `/api/v1/spaces/${sharedId}/guests`, { displayName: GUEST_NAME });
};

/**
 * A second person in the shared space "Casa" (HU-E9-05): Juan joins by a link, so the members screen lists a role the
 * person can change. Once per page.
 */
const withSecondMember = new WeakSet<Page>();
const ensureSecondMember = async (page: Page) => {
  if (withSecondMember.has(page)) return;
  withSecondMember.add(page);
  const sharedId = /\/spaces\/([^/]+)/.exec(new URL(page.url()).pathname)![1];
  const { url } = await post(page, `/api/v1/spaces/${sharedId}/invitations`, {
    kind: "LINK",
    role: "MEMBER",
  });
  const juan = await Person.signUp(request, "Juan", `layout-juan-${Date.now()}@example.com`, {
    "x-forwarded-for": `10.253.${randomInt(256)}.${randomInt(1, 255)}`,
  });
  try {
    await juan.api.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`, {});
  } finally {
    await juan.dispose();
  }
};

/**
 * The pages a visitor opens (HU-E9-05, P155-P156): a pending invitation, and a guest's claim link, in a space whose
 * name and a guest whose name are as long as the API accepts.
 */
const openPages = async (page: Page) => {
  const space = await post(page, "/api/v1/spaces", { kind: "SHARED", name: UNBROKEN_SPACE, currency: "COP" });
  const guest = await post(page, `/api/v1/spaces/${space.id}/guests`, { displayName: GUEST_NAME });
  const invitation = await post(page, `/api/v1/spaces/${space.id}/invitations`, {
    kind: "LINK",
    role: "MEMBER",
  });
  const claim = await post(page, `/api/v1/spaces/${space.id}/guests/${guest.id}/claim-links`, {});
  return [invitation, claim].map(({ url }: { url: string }) => new URL(url).pathname);
};

/** A visitor: a fresh context with no cookies, on the same phone and, when asked, with the wide face. */
const visitorPage = async (browser: Browser, viewport: { width: number; height: number }, wide: boolean) => {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "es-CO", viewport });
  if (wide) await useWideFont(context);
  return { page: await context.newPage(), close: () => context.close() };
};

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The elements that reach past the right edge of the phone (at most 10, the innermost first), so a failure names its
 * culprit. Elements that cannot widen the page are left out: fixed ones and those inside a scroller or a clipped box.
 */
const overflowCulprits = (page: Page) =>
  page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    const widens = (el: Element) => {
      for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === "fixed") return false;
        if (node !== el && style.overflowX !== "visible") return false;
      }
      return true;
    };
    /** Where the element's content ends: text that cannot wrap spills out of a box that itself fits. */
    const reach = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return (
        r.left + (getComputedStyle(el).overflowX === "visible" ? Math.max(r.width, el.scrollWidth) : r.width)
      );
    };
    const past = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => el.getBoundingClientRect().width > 0 && reach(el) > edge + 0.5 && widens(el),
    );
    return past
      .filter((el) => !past.some((other) => other !== el && el.contains(other)))
      .sort((a, b) => reach(b) - reach(a))
      .slice(0, 10)
      .map((el) => {
        const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".");
        const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `<${el.tagName.toLowerCase()}${classes ? `.${classes}` : ""}> "${text}" right=${Math.round(reach(el))}`;
      });
  });

/** Overflow in px, and on failure the list of culprits in the message. Keeps the assertion strict. */
const overflowReport = async (page: Page, what: string) => {
  const overflow = await horizontalOverflow(page);
  const culprits = overflow > 0 ? await overflowCulprits(page) : [];
  const list = culprits.join("\n");
  return { overflow, message: `${what} overflows by this many px; past the edge:\n${list}` };
};

declare global {
  interface Window {
    paintedAt(x: number, y: number): Element | null;
  }
}

/**
 * What is painted at a point. A modal dialog turns off pointer events outside itself, so a plain `elementFromPoint`
 * would skip the navigation that really covers the sheet: `paintedAt` lets every element answer for a moment.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.paintedAt = (x, y) => {
      const style = document.createElement("style");
      style.textContent = "*{pointer-events:auto !important}";
      document.head.append(style);
      const hit = document.elementFromPoint(x, y);
      style.remove();
      return hit;
    };
  });
});

const settle = async (page: Page) => {
  await page.waitForLoadState("load");
  // Let the navigation's prefetches finish, so a failing one is logged inside the test; a page that never idles is fine.
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
};

/**
 * The last control a person can act on in the open sheet, scrolled to the end of its own scroll area. With sheets
 * stacked (HU-E9-04's icon library over the category sheet) it is the top one, the last opened.
 */
const lastControlIsOnTop = (page: Page) =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll<HTMLElement>("[role='dialog']")].at(-1);
    if (!dialog) return "no open dialog";
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), [role='radio']:not([disabled]), select",
      ),
    ].filter(visible);
    const last = controls.at(-1);
    if (!last) return "no actionable control";
    last.scrollIntoView({ block: "end" });
    const r = last.getBoundingClientRect();
    const top = window.paintedAt(r.left + r.width / 2, r.top + r.height / 2);
    const label = last.getAttribute("aria-label") ?? last.textContent?.trim() ?? last.tagName;
    return top && last.contains(top)
      ? "ok"
      : `covered: "${label}" by <${top?.tagName ?? "nothing"}> ${top?.className ?? ""}`;
  });

/** `shared` opens the sheet in the shared space "Casa" instead of the personal one. */
const sheets: {
  name: string;
  open: (page: Page, spaceId: string) => Promise<void>;
  path?: string;
  shared?: true;
}[] = [
  {
    name: "profile sheet",
    open: (page) =>
      page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click(),
  },
  {
    name: "space switcher",
    open: (page) =>
      page.getByRole("button", { name: es.shell.space.current.replace("{name}", "Personal") }).click(),
  },
  {
    name: "account picker",
    path: "new",
    open: async (page) => {
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByRole("button", { name: new RegExp(`^${es.ledger.form.account}`) }).click();
    },
  },
  {
    name: "category picker",
    path: "new",
    open: async (page) => {
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
    },
  },
  {
    name: "date and time sheet",
    path: "new",
    open: async (page) => {
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByTestId("when-chip").click();
    },
  },
  {
    name: "category edit sheet",
    path: "categories",
    open: (page) =>
      page.getByRole("button", { name: es.categories.edit.replace("{name}", "Arriendo") }).click(),
  },
  {
    name: "icon library",
    path: "categories",
    open: async (page) => {
      await page.getByRole("button", { name: es.categories.edit.replace("{name}", "Arriendo") }).click();
      await page.getByRole("button", { name: es.categories.icons.seeAll }).click();
    },
  },
  {
    name: "invite sheet",
    path: "members",
    shared: true,
    open: (page) => page.getByRole("button", { name: es.members.invite }).click(),
  },
  {
    name: "invite sheet with its link",
    path: "members",
    shared: true,
    open: async (page) => {
      await page.getByRole("button", { name: es.members.invite }).click();
      await page.getByRole("button", { name: es.members.inviteSheet.createLink }).click();
      await expect(page.getByLabel(es.members.inviteSheet.linkLabel, { exact: true })).toBeVisible();
    },
  },
  {
    name: "add guest sheet",
    path: "members",
    shared: true,
    open: (page) => page.getByRole("button", { name: es.members.addGuest }).click(),
  },
  {
    name: "guest sheet with its claim link",
    path: "members",
    shared: true,
    open: async (page) => {
      await ensureSharedGuest(page);
      await page.reload();
      await page
        .getByRole("button", {
          name: es.members.guestOptions.replace("{name}", `${GUEST_NAME} ${es.members.guestSuffix}`),
        })
        .click();
      await page.getByRole("button", { name: es.members.guest.createClaim }).click();
      await expect(page.getByLabel(es.members.guest.claimLabel, { exact: true })).toBeVisible();
    },
  },
  {
    name: "role sheet",
    path: "members",
    shared: true,
    open: async (page) => {
      await ensureSecondMember(page);
      await page.reload();
      await page
        .getByRole("button", {
          name: es.members.role.replace("{name}", "Juan").replace("{role}", es.shell.role.MEMBER),
        })
        .click();
    },
  },
  {
    name: "split sheet",
    path: "new",
    shared: true,
    open: async (page) => {
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.locator("#record-amount").fill("300000");
      await page.getByRole("button", { name: es.ledger.form.moreOptions }).click();
      await page.getByRole("button", { name: new RegExp(es.ledger.split.split) }).click();
    },
  },
  {
    name: "split with someone sheet",
    path: "new",
    open: async (page, spaceId) => {
      await ensureDirectSpace(page, spaceId);
      await page.reload();
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByRole("button", { name: es.ledger.form.moreOptions }).click();
      await page.getByRole("button", { name: es.ledger.direct.open }).click();
      // Someone picked, so the footer's action is enabled and is the last control to reach.
      await page.getByRole("radio", { name: new RegExp(GUEST_NAME) }).click();
    },
  },
  {
    name: "settle-up sheet",
    path: "balances",
    shared: true,
    open: async (page) => {
      await ensureSharedGuest(page);
      await page.reload();
      await page.getByRole("button", { name: es.balances.record }).click();
      // The guest pays: the sheet shows the guest's note and the viewer's accounts to receive in.
      await page
        .getByRole("radiogroup", { name: es.balances.settle.payer })
        .getByRole("radio", { name: new RegExp(GUEST_NAME) })
        .click();
    },
  },
  {
    name: "transaction filters",
    path: "transactions",
    open: (page) => page.getByRole("button", { name: es.ledger.list.filterCategory }).click(),
  },
  {
    // Ruling P189: a row opens its detail over the list; its last control is Eliminar, above the bottom bar.
    name: "transaction detail sheet",
    path: "transactions",
    open: async (page) => {
      await page.getByRole("link", { name: /Mercado semanal/ }).click();
      await expect(page.getByRole("dialog", { name: /Mercado semanal/ })).toBeVisible();
    },
  },
  {
    name: "time zone sheet",
    path: "settings",
    open: (page) => page.getByRole("button", { name: new RegExp(es.settings.field.timezone) }).click(),
  },
];

for (const wideFont of [false, true]) {
  test.describe(`no screen scrolls sideways (WCAG 1.4.10 Reflow)${wideFont ? " with a wide font" : ""}`, () => {
    test.skip(
      !wideFont && process.env.LAYOUT_WIDE_FONT === "1",
      "the wide font is forced for the whole file",
    );
    test.use({ wideFont: wideFont || process.env.LAYOUT_WIDE_FONT === "1" });
    for (const viewport of [PHONE, SMALL_PHONE]) {
      test(`every screen at ${viewport.width} px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const check = async (path: string) => {
          await page.goto(path);
          await settle(page);
          const { overflow, message } = await overflowReport(page, path);
          expect.soft(overflow, message).toBeLessThanOrEqual(0);
        };
        for (const path of ["/sign-in?expired=1", "/sign-up", "/sign-in"]) await check(path);

        const { spaceId, sharedId } = await session(page, `reflow-${viewport.width}`);
        const warned = await warnedList(page, sharedId);
        const history = await historyPath(page, spaceId, sharedId);
        const edit = await editPathOf(page, spaceId);
        for (const path of [
          `/spaces/${spaceId}`,
          `/spaces/${spaceId}/transactions`,
          `/spaces/${spaceId}/accounts`,
          `/spaces/${spaceId}/accounts/new`,
          `/spaces/${spaceId}/new`,
          `/spaces/${sharedId}`,
          `/spaces/${sharedId}/members`,
          `/spaces/${sharedId}/balances`,
          // HU-E9-04: the category tree, managed (personal) and its shared counterpart.
          `/spaces/${spaceId}/categories`,
          `/spaces/${sharedId}/categories`,
          // HU-E9-10, HU-E9-11: the Plan tab, My spending (personal) and without a plan (shared).
          `/spaces/${spaceId}/plan`,
          `/spaces/${spaceId}/plan/lines`,
          `/spaces/${spaceId}/plan/groups`,
          `/spaces/${sharedId}/plan`,
          `/spaces/${sharedId}/plan/fund`,
          `/spaces/${sharedId}/plan/groups`,
          history,
          // Ruling P191: the record form on a transaction, which has its own header, line and notice.
          edit,
          `/spaces/${sharedId}/new`,
          warned,
          "/spaces/new",
          "/settings",
          // N3: Settings and New space opened from a shared space wear its shell.
          `/settings?from=${sharedId}`,
          `/spaces/new?from=${sharedId}`,
          // N1: the app's own not-found page, for an address and for a space.
          "/nope",
          "/spaces/does-not-exist/accounts",
        ])
          await check(path);

        // #142, #143, #150 (Task 17c): the longest carry text, the calendar's windows and the line warning's question.
        const household = await seedAdditions(page, spaceId, test.info().testId);
        for (const path of [
          `/spaces/${household}/plan?period=2026-11`,
          `/spaces/${spaceId}/plan/calendar`,
          `/spaces/${spaceId}/plan/calendar?days=60`,
        ])
          await check(path);
        await page.goto(`/spaces/${household}/new`);
        await askBeforeSaving(page);
        const { overflow, message } = await overflowReport(page, "the record form asking before saving");
        expect.soft(overflow, message).toBeLessThanOrEqual(0);
      });
    }

    test("the home of a space still reflows at 320 px with an empty and a full ledger", async ({ page }) => {
      await page.setViewportSize(SMALL_PHONE);
      const { spaceId } = await session(page, "home-320");
      await page.goto(`/spaces/${spaceId}`);
      await settle(page);
      await expect(page.getByRole("heading", { name: es.home.recent })).toBeVisible();
      const { overflow, message } = await overflowReport(page, "the home");
      expect(overflow, message).toBeLessThanOrEqual(0);
    });

    test("each open sheet leaves the page as wide as the phone", async ({ page }) => {
      const { spaceId, sharedId } = await session(page, "sheet-width");
      for (const sheet of sheets) {
        await page.goto(
          sheet.path === "settings"
            ? "/settings"
            : `/spaces/${sheet.shared ? sharedId : spaceId}${sheet.path ? `/${sheet.path}` : ""}`,
        );
        await sheet.open(page, spaceId);
        await expect(page.getByRole("dialog")).toBeVisible();
        const { overflow, message } = await overflowReport(page, sheet.name);
        expect.soft(overflow, message).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
      }
    });

    for (const viewport of [PHONE, SMALL_PHONE]) {
      test(`one very long unbroken name does not widen a sub-screen's header at ${viewport.width} px (ScreenHeader)`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const { spaceId, sharedId } = await session(page, `unbroken-${viewport.width}`);
        // The history's title is "Historial de <name>": its h1 holds the whole unbroken name.
        await page.goto(await historyPath(page, spaceId, sharedId, BIG_EXPENSE, UNBROKEN_NAME));
        await settle(page);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(UNBROKEN_NAME);
        const { overflow, message } = await overflowReport(page, "the history");
        expect(overflow, message).toBeLessThanOrEqual(0);
        // The title wraps inside the header: it never pushes the way back off the screen or shrinks it.
        const box = (await page.getByRole("link", { name: es.common.back, exact: true }).boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(TARGET);
        expect(box.height).toBeGreaterThanOrEqual(TARGET);
        expect(box.x).toBeGreaterThanOrEqual(0);
      });

      // The shell's space switcher truncates the name, so an unbroken space name never widens the header.
      test(`a space with one very long unbroken name still reflows on its sub-screens at ${viewport.width} px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const { spaceId } = await session(page, `unbroken-space-${viewport.width}`);
        const space = (await post(page, "/api/v1/spaces", {
          kind: "SHARED",
          name: UNBROKEN_SPACE,
          currency: "COP",
        })) as { id: string };
        const history = await historyPath(page, spaceId, space.id);
        for (const path of [`/spaces/${space.id}/members`, `/spaces/${space.id}/balances`, history]) {
          await page.goto(path);
          await settle(page);
          const { overflow, message } = await overflowReport(page, path);
          expect.soft(overflow, message).toBeLessThanOrEqual(0);
        }
      });
    }

    for (const viewport of [PHONE, SMALL_PHONE]) {
      test(`the invitation and claim pages fit ${viewport.width} px with long names, signed in and as a visitor, and every action is a full target (HU-E9-05)`, async ({
        page,
        browser,
        wideFont,
      }) => {
        await page.setViewportSize(viewport);
        await session(page, `open-pages-${viewport.width}`);
        const paths = await openPages(page);
        const visitor = await visitorPage(browser, viewport, wideFont);
        try {
          for (const [who, on] of [
            ["signed in", page],
            ["as a visitor", visitor.page],
          ] as const)
            for (const path of paths) {
              await on.goto(path);
              await settle(on);
              const what = `${path} ${who}`;
              await expect(on.getByRole("heading", { level: 1 }), what).toBeVisible();
              const { overflow, message } = await overflowReport(on, what);
              expect.soft(overflow, message).toBeLessThanOrEqual(0);
              const actions = on.locator("main").getByRole("link").or(on.locator("main").getByRole("button"));
              expect.soft(await actions.count(), `${what}: has an action`).toBeGreaterThan(0);
              for (const action of await actions.all()) {
                const box = (await action.boundingBox())!;
                const label = (await action.textContent())?.trim();
                expect.soft(box.height, `${what}: height of "${label}"`).toBeGreaterThanOrEqual(TARGET);
                expect.soft(box.width, `${what}: width of "${label}"`).toBeGreaterThanOrEqual(TARGET);
                expect
                  .soft(box.x + box.width, `${what}: "${label}" stays on screen`)
                  .toBeLessThanOrEqual(viewport.width);
              }
            }
        } finally {
          await visitor.close();
        }
      });
    }

    for (const viewport of [PHONE, SMALL_PHONE]) {
      test(`a member's balance history fits ${viewport.width} px with a 15-digit amount, and has a way back to Saldos (HU-E9-07, P176)`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const { spaceId, sharedId } = await session(page, `history-${viewport.width}`);
        await page.goto(await historyPath(page, spaceId, sharedId, HUGE_EXPENSE));
        await settle(page);

        await expect(page.getByRole("heading", { level: 1 })).toContainText(HISTORY_GUEST);
        await expect(
          page.getByRole("region", { name: es.balances.history.entries }).getByRole("listitem"),
        ).toHaveCount(1);
        const { overflow, message } = await overflowReport(page, "the history");
        expect(overflow, message).toBeLessThanOrEqual(0);

        const back = page.getByRole("link", { name: es.common.back, exact: true });
        await expect(back).toBeVisible();
        await expect(back).toHaveAttribute("href", `/spaces/${sharedId}/balances`);
        const box = (await back.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(TARGET);
        expect(box.height).toBeGreaterThanOrEqual(TARGET);
        expect(box.x).toBeGreaterThanOrEqual(0);

        await back.click();
        await expect(page).toHaveURL(new RegExp(`/spaces/${sharedId}/balances$`));
        await expect(page.getByRole("link", { name: new RegExp(HISTORY_GUEST) })).toBeVisible();
      });
    }
  });
}

test.describe("a shared expense saved with a warning (HU-E9-06, ruling P170)", () => {
  test("names the fund and its balance, dismisses with a full target and names who paid", async ({
    page,
  }) => {
    const { sharedId } = await session(page, "warned");
    await page.goto(await warnedList(page, sharedId));
    await settle(page);
    const notice = page.locator("main").getByRole("status");
    await expect(notice).toContainText(es.ledger.saved.title);
    await expect(notice).toContainText(FUND_NAME);
    await expect(notice).toContainText("−$ 2.000.000");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Arriendo" })).toContainText(
      es.ledger.paidBy.replace("{name}", FUND_NAME),
    );
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const dismiss = page.getByRole("link", { name: es.ledger.saved.dismiss });
    const box = (await dismiss.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(TARGET);
    expect(box.height).toBeGreaterThanOrEqual(TARGET);
    expect(box.x + box.width, "the dismiss link stays on screen").toBeLessThanOrEqual(PHONE.width);
    await dismiss.click();
    await expect(page).toHaveURL(new RegExp(`/spaces/${sharedId}/transactions$`));
    await expect(page.locator("main").getByRole("status")).toHaveCount(0);
  });
});

// 57 of the 60 characters the longest name a line takes (budget-line.ts MAX_NAME).
const LONG_LINE = "Mercado, aseo y gastos del hogar de toda la familia Pérez";
const FUND_LINE = "Arriendo y servicios del hogar pagados con el fondo común";

/**
 * The shared space gets October's plan: a guest with a real, long name beside the person, both with a capacity, and
 * one line with a very long name and over a billion pesos that is split 60/40 between them. An expense takes the
 * line past its plan, so its row also carries "Excedida" and the overage in words (#142, ruling P244), and the member
 * matrix has big figures and a gap of each sign. A second long-named line is paid from the fund, so the Fund view
 * has billion-peso figures to expect.
 */
const seedOverBudgetPlan = async (page: Page, sharedId: string) => {
  const space = `/api/v1/spaces/${sharedId}`;
  const guest = await post(page, `${space}/guests`, { displayName: HISTORY_GUEST });
  let plan = await post(page, `${space}/plans`, { period: "2026-10" });
  const { items: members } = await get(page, `${space}/members`);
  const money = (minor: string) => ({ amount: minor, currency: "COP" });
  plan = await put(
    page,
    `${space}/plans/${plan.id}/capacities`,
    {
      capacities: [
        { memberId: members[0].id, amount: money("200000000000") },
        { memberId: guest.id, amount: money("100000000000") },
      ],
    },
    { "if-match": `"${plan.version}"` },
  );
  plan = await post(
    page,
    `${space}/plans/${plan.id}/lines`,
    { name: LONG_LINE, plannedAmount: money("123456789000") },
    { "if-match": `"${plan.version}"` },
  );
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  const line = plan.lines[0].id;
  plan = await put(
    page,
    `${space}/plans/${plan.id}/lines/${line}/categories`,
    { categoryIds: [categoryId] },
    { "if-match": `"${plan.version}"` },
  );
  plan = await put(
    page,
    `${space}/plans/${plan.id}/lines/${line}/allocation`,
    {
      rule: "PERCENT",
      members: [
        { memberId: members[0].id, percent: "60" },
        { memberId: guest.id, percent: "40" },
      ],
    },
    { "if-match": `"${plan.version}"` },
  );
  // A line paid from the fund and never contributed to: the Fund view then expects over a billion pesos from
  // each member and reads them as still to pay in (HU-E9-10).
  await post(
    page,
    `${space}/plans/${plan.id}/lines`,
    { name: FUND_LINE, plannedAmount: money("123456789000"), funding: "SHARED_FUND" },
    { "if-match": `"${plan.version}"` },
  );
  const fund = await post(page, `${space}/accounts`, {
    name: "Fondo",
    type: "SHARED_FUND",
    openingBalance: { amount: "0", currency: "COP" },
  });
  const spent = money("150000000000");
  await post(
    page,
    `${space}/expenses`,
    {
      description: "Mercado grande",
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount: spent,
      payments: [{ memberId: null, accountId: fund.id, amount: spent }],
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

test.describe("the Plan tab (HU-E9-10, ruling P200)", () => {
  /**
   * A DRAFT plan of the shared space for `period`, whose only line has a very long name and a plan of over a billion
   * pesos. `copyFrom` makes it a copy of the previous period's plan, as the planner's close action needs to follow.
   */
  const seedBigPlan = async (page: Page, sharedId: string, period: string, copyFrom?: "previous") => {
    const space = `/api/v1/spaces/${sharedId}`;
    let plan = await post(page, `${space}/plans`, copyFrom ? { period, copyFrom } : { period });
    const { items: members } = await get(page, `${space}/members`);
    plan = await put(
      page,
      `${space}/plans/${plan.id}/capacities`,
      { capacities: [{ memberId: members[0].id, amount: { amount: "200000000000", currency: "COP" } }] },
      { "if-match": `"${plan.version}"` },
    );
    if (!copyFrom)
      plan = await post(
        page,
        `${space}/plans/${plan.id}/lines`,
        { name: LONG_LINE, plannedAmount: { amount: "123456789000", currency: "COP" } },
        { "if-match": `"${plan.version}"` },
      );
    return plan as { id: string; version: number; lines: { id: string }[] };
  };

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`the bottom bar fits its tabs and the dashboard keeps long names and big figures on screen at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId, sharedId } = await session(page, `plan-tab-${viewport.width}`);
      await seedOverBudgetPlan(page, sharedId);
      for (const [path, tabs] of [
        [`/spaces/${sharedId}/plan`, 5],
        // The member matrix: a card per member, so no table scrolls and no figure is cut off.
        [`/spaces/${sharedId}/plan/members`, 5],
        [`/spaces/${sharedId}/plan/fund`, 5],
        [`/spaces/${sharedId}/plan/groups`, 5],
        // HU-E9-11: My spending, the personal space's own page, and its Lines view.
        [`/spaces/${spaceId}/plan`, 4],
        [`/spaces/${spaceId}/plan/lines`, 4],
        // HU-E9-11: By group, the person's own spending merged across their spaces.
        [`/spaces/${spaceId}/plan/groups`, 4],
      ] as const) {
        await page.goto(path);
        await settle(page);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(/octubre 2026/i);
        const { overflow, message } = await overflowReport(page, path);
        expect.soft(overflow, message).toBeLessThanOrEqual(0);

        const nav = page.getByRole("navigation", { name: es.shell.nav.main });
        const links = nav.getByRole("link");
        await expect(links, `${path}: the tabs`).toHaveCount(tabs);
        await expect(nav.getByRole("link", { name: es.shell.nav.plan, exact: true })).toHaveAttribute(
          "aria-current",
          "page",
        );
        const boxes = (await links.evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, right: r.right, width: r.width, height: r.height };
          }),
        )) as { x: number; right: number; width: number; height: number }[];
        boxes.sort((a, b) => a.x - b.x);
        boxes.forEach((box, index) => {
          expect.soft(box.width, `${path}: tab ${index} width`).toBeGreaterThanOrEqual(TARGET);
          expect.soft(box.height, `${path}: tab ${index} height`).toBeGreaterThanOrEqual(TARGET);
          expect.soft(box.x, `${path}: tab ${index} starts on screen`).toBeGreaterThanOrEqual(0);
          expect.soft(box.right, `${path}: tab ${index} ends on screen`).toBeLessThanOrEqual(viewport.width);
          if (index > 0) {
            expect
              .soft(box.x, `${path}: tab ${index} does not overlap the one before`)
              .toBeGreaterThanOrEqual(boxes[index - 1]!.right - 0.5);
          }
        });

        // The dashboard's own controls: the period links and the view tabs are full targets.
        for (const link of await page.locator("main").getByRole("link").all()) {
          const box = (await link.boundingBox())!;
          expect
            .soft(box.height, "a link of the dashboard is at least 44 px tall")
            .toBeGreaterThanOrEqual(TARGET);
          // Issue #174 (U3): the view tabs wrap to a second row, so every link, a tab included, ends on screen where
          // it stands, with no scrolling.
          expect.soft(box.x + box.width, "and ends on screen").toBeLessThanOrEqual(viewport.width);
        }
      }
      // The long line wraps inside its row instead of widening the page.
      await page.goto(`/spaces/${sharedId}/plan`);
      // From 1024 px the desktop overview (Task 16) repeats the line; under it those panels are hidden.
      await expect(page.getByText(LONG_LINE).filter({ visible: true })).toBeVisible();
      await expect(page.getByText(es.reports.lines.overspent)).toBeVisible();
      await expect(page.getByText(es.reports.lines.overBy.replace("{amount}", ""))).toBeVisible();

      // The member matrix keeps the long line, the guest's long name and the big figures inside their cards, and
      // no table needs to scroll: below 640 px a member is a card (P217).
      await page.goto(`/spaces/${sharedId}/plan/members`);
      await expect(page.getByRole("heading", { level: 2, name: LONG_LINE })).toBeVisible();
      const matrixRegion = page.getByRole("region", {
        name: es.reports.matrix.caption.replace("{line}", LONG_LINE),
      });
      // The fund-paid line lists the guest too, so the name is looked up inside the long line's own table.
      await expect(matrixRegion.getByRole("rowheader", { name: HISTORY_GUEST })).toBeVisible();
      expect(
        await matrixRegion.evaluate((el) => el.scrollWidth - el.clientWidth),
        "the matrix table does not scroll on a phone",
      ).toBeLessThanOrEqual(0);
      for (const cell of await matrixRegion.getByRole("cell").all()) {
        const box = (await cell.boundingBox())!;
        expect.soft(box.x, "a figure starts on screen").toBeGreaterThanOrEqual(0);
        expect.soft(box.x + box.width, "and ends on screen").toBeLessThanOrEqual(viewport.width);
      }

      // The fund cards keep their billion-peso figures and their badges on screen (the loop above measured the
      // overflow). The person and the guest both still have to pay in.
      await page.goto(`/spaces/${sharedId}/plan/fund`);
      await expect(page.getByText(es.reports.fund.behind).first()).toBeVisible();
      await expect(page.getByText(es.reports.fund.note)).toBeVisible();
    });
  }

  /** Every link and button of the screen's main area is a full target that ends on screen. */
  const expectFullTargets = async (page: Page, what: string, width: number) => {
    const controls = page.locator("main").getByRole("link").or(page.locator("main").getByRole("button"));
    expect.soft(await controls.count(), `${what}: has controls`).toBeGreaterThan(0);
    for (const control of await controls.all()) {
      // Issue #174 (U3): the view tabs wrap instead of scrolling, so no control waits beyond the edge.
      const box = (await control.boundingBox())!;
      const label = (await control.getAttribute("aria-label")) ?? (await control.textContent())?.trim();
      expect.soft(box.height, `${what}: height of "${label}"`).toBeGreaterThanOrEqual(TARGET);
      expect.soft(box.width, `${what}: width of "${label}"`).toBeGreaterThanOrEqual(TARGET);
      expect.soft(box.x + box.width, `${what}: "${label}" stays on screen`).toBeLessThanOrEqual(width);
    }
  };

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`the planner keeps a long line and big figures on screen, its last action above the bottom bar, and has a way back at ${viewport.width} px (HU-E9-08)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, `planner-${viewport.width}`);
      const plan = await seedBigPlan(page, sharedId, "2026-10");
      await page.goto(`/spaces/${sharedId}/plans/${plan.id}`);
      await settle(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Plan de octubre 2026/i);
      await expect(page.getByText(LONG_LINE)).toBeVisible();
      const { overflow, message } = await overflowReport(page, "the planner");
      expect.soft(overflow, message).toBeLessThanOrEqual(0);
      await expectFullTargets(page, "the planner", viewport.width);

      // Activate is the last control: scrolled to the end of the page it sits above the bottom navigation.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const activate = (await page
        .getByRole("button", { name: es.budgeting.planner.activate })
        .boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: es.shell.nav.main }).boundingBox())!;
      expect(activate.y + activate.height, "Activar plan ends above the bottom bar").toBeLessThanOrEqual(
        nav.y,
      );

      // The way back is the shared header's link to the dashboard of the plan's period.
      const back = page.getByRole("link", { name: es.common.back, exact: true });
      await expect(back).toHaveAttribute("href", `/spaces/${sharedId}/plan?period=2026-10`);
      const box = (await back.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(TARGET);
      expect(box.height).toBeGreaterThanOrEqual(TARGET);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`/spaces/${sharedId}/plan\\?period=2026-10$`));
      // The dashboard again: the desktop overview's hidden panels (Task 16) repeat the line under 1024 px.
      await expect(page.getByText(LONG_LINE).filter({ visible: true })).toBeVisible();
    });

    test(`closing a plan whose source plan is still open names the period and links to it at ${viewport.width} px (ruling P248)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, `planner-source-${viewport.width}`);
      const space = `/api/v1/spaces/${sharedId}`;
      const august = await seedBigPlan(page, sharedId, "2026-08");
      const september = await seedBigPlan(page, sharedId, "2026-09", "previous");
      await post(
        page,
        `${space}/plans/${september.id}/activate`,
        {},
        { "if-match": `"${september.version}"` },
      );
      // The server side of the refusal lands with Task 1e: this answers what it will answer.
      await page.route("**/api/v1/spaces/*/plans/*/close", (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "urn:hearth:problem:SourcePlanOpen",
            title: "",
            status: 409,
            code: "SourcePlanOpen",
            requestId: "req-e2e",
            sourcePeriod: "2026-08",
          }),
        }),
      );
      await page.goto(`/spaces/${sharedId}/plans/${september.id}`);
      await settle(page);
      await page.getByRole("button", { name: es.budgeting.planner.close }).click();
      const alert = page.locator("main").getByRole("alert");
      await expect(alert).toContainText(es.errors.SourcePlanOpen.replace("{period}", "2026-08"));
      const { overflow, message } = await overflowReport(page, "the refusal");
      expect.soft(overflow, message).toBeLessThanOrEqual(0);
      await expectFullTargets(page, "the refusal", viewport.width);

      const source = alert.getByRole("link", {
        name: es.budgeting.planner.goToSource.replace("{period}", "2026-08"),
      });
      await expect(source).toHaveAttribute("href", `/spaces/${sharedId}/plans/${august.id}`);
      await source.click();
      await expect(page).toHaveURL(new RegExp(`/spaces/${sharedId}/plans/${august.id}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Plan de agosto 2026/i);
    });

    test(`a period without a plan offers to copy the previous one, and the planner says what the copy left out at ${viewport.width} px (HU-E9-10, ruling P209)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, `no-plan-${viewport.width}`);
      const space = `/api/v1/spaces/${sharedId}`;
      // September's DRAFT plan has the long "Mercado" line fed by one category, which is archived afterwards.
      const september = await seedBigPlan(page, sharedId, "2026-09");
      const { items: groups } = await get(page, `${space}/categories`);
      const category: { id: string; name: string } = groups.flatMap(
        (group: { categories: { id: string; name: string }[] }) => group.categories,
      )[0];
      const plan = await get(page, `${space}/plans/${september.id}`);
      await put(
        page,
        `${space}/plans/${september.id}/lines/${plan.lines[0].id}/categories`,
        { categoryIds: [category.id] },
        { "if-match": `"${plan.version}"` },
      );
      await post(page, `${space}/categories/${category.id}/archive`, {});

      await page.goto(`/spaces/${sharedId}/plan?period=2026-10`);
      await settle(page);
      await expect(
        page.getByRole("heading", { level: 2, name: /^octubre 2026 no tiene plan$/i }),
      ).toBeVisible();
      const create = page.getByRole("button", { name: es.budgeting.start.create });
      const copy = page.getByRole("button", { name: es.budgeting.start.copy });
      await expect(create).toBeVisible();
      const { overflow, message } = await overflowReport(page, "the period without a plan");
      expect.soft(overflow, message).toBeLessThanOrEqual(0);
      await expectFullTargets(page, "the period without a plan", viewport.width);
      // The last control sits above the bottom bar once the page is scrolled to its end.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const nav = (await page.getByRole("navigation", { name: es.shell.nav.main }).boundingBox())!;
      const last = (await create.boundingBox())!;
      expect(last.y + last.height, "Crear plan ends above the bottom bar").toBeLessThanOrEqual(nav.y);

      await copy.click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Plan de octubre 2026/i);
      const notice = page.getByRole("status").filter({ hasText: es.budgeting.copy.title });
      await expect(notice).toContainText(
        es.budgeting.copy.droppedMapping.replace("{category}", category.name).replace("{line}", LONG_LINE),
      );
      const planner = await overflowReport(page, "the copied plan");
      expect.soft(planner.overflow, planner.message).toBeLessThanOrEqual(0);
      await expectFullTargets(page, "the copied plan", viewport.width);
      const box = (await notice.boundingBox())!;
      expect(box.x + box.width, "the notice stays on screen").toBeLessThanOrEqual(viewport.width);

      // Once: a reload of the planner no longer has it, and the way back leads to the dashboard of the period.
      await page.reload();
      await settle(page);
      await expect(page.getByRole("status").filter({ hasText: es.budgeting.copy.title })).toHaveCount(0);
      const back = page.getByRole("link", { name: es.common.back, exact: true });
      await expect(back).toHaveAttribute("href", `/spaces/${sharedId}/plan?period=2026-10`);
      await back.click();
      await expect(page.getByText(LONG_LINE)).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: /no tiene plan/i })).toHaveCount(0);
    });
  }

  /** Ana earns 1,650,000 COP in September in her personal space: the income her October suggestion reads (D17). */
  const seedIncome = async (page: Page, personalId: string) => {
    const space = `/api/v1/spaces/${personalId}`;
    const { items: accounts } = await get(page, `${space}/accounts`);
    const { items: groups } = await get(page, `${space}/categories`);
    const salary = groups
      .flatMap((group: { categories: { id: string; key: string | null }[] }) => group.categories)
      .find((category: { key: string | null }) => category.key === "salary");
    await post(
      page,
      `${space}/incomes`,
      {
        description: "Salario",
        date: "2026-09-15",
        categoryId: salary.id,
        amount: { amount: "165000000", currency: "COP" },
        accountId: bancolombiaIn(accounts),
      },
      { "idempotency-key": crypto.randomUUID() },
    );
  };

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`the capacities screen keeps its figures and the private suggestion on screen, its last action above the bottom bar, and has a way back at ${viewport.width} px (HU-E9-08, ruling P208)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId, sharedId } = await session(page, `capacities-${viewport.width}`);
      const plan = await seedBigPlan(page, sharedId, "2026-10");
      await seedIncome(page, spaceId);
      await page.goto(`/spaces/${sharedId}/plans/${plan.id}/capacities`);
      await settle(page);
      await expect(page.getByRole("heading", { level: 1, name: es.budgeting.capacity.title })).toBeVisible();
      await expect(
        page.getByText(
          /^Sugerido \$\s1\.650\.000: tus ingresos de septiembre 2026 en Personal\. Solo tú lo ves\.$/,
        ),
      ).toBeVisible();
      const { overflow, message } = await overflowReport(page, "the capacities screen");
      expect.soft(overflow, message).toBeLessThanOrEqual(0);
      await expectFullTargets(page, "the capacities screen", viewport.width);

      // Use suggestion fills Ana's own field and sends nothing: the plan keeps its capacity until Save.
      await page.getByRole("button", { name: es.budgeting.capacity.useSuggestion }).click();
      await expect(page.getByRole("textbox", { name: "Capacidad de Ana" })).toHaveValue("1.650.000");

      // Save is the last control: scrolled to the end of the page it sits above the bottom navigation.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      const save = (await page.getByRole("button", { name: es.budgeting.capacity.save }).boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: es.shell.nav.main }).boundingBox())!;
      expect(save.y + save.height, "Guardar capacidades ends above the bottom bar").toBeLessThanOrEqual(
        nav.y,
      );

      // The way back is the shared header's link to the planner.
      const back = page.getByRole("link", { name: es.common.back, exact: true });
      await expect(back).toHaveAttribute("href", `/spaces/${sharedId}/plans/${plan.id}`);
      const box = (await back.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(TARGET);
      expect(box.height).toBeGreaterThanOrEqual(TARGET);
      await back.click();
      await expect(page).toHaveURL(new RegExp(`/spaces/${sharedId}/plans/${plan.id}$`));
    });
  }

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`the line editor keeps a long line and big figures on screen, every control a full target, its last action above the bottom bar, and has a way back at ${viewport.width} px (HU-E9-08)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, `line-editor-${viewport.width}`);
      const plan = await seedBigPlan(page, sharedId, "2026-10");
      const line: { id: string } = (await get(page, `/api/v1/spaces/${sharedId}/plans/${plan.id}`)).lines[0];
      const planner = `/spaces/${sharedId}/plans/${plan.id}`;

      /** Inputs, choices, switches and the label of a checkbox are full targets that end on screen. */
      const expectFullFields = async (what: string) => {
        const fields = page
          .locator("main")
          .getByRole("textbox")
          .or(page.locator("main").getByRole("radio"))
          .or(page.locator("main").getByRole("switch"))
          .or(page.locator("main label:has(input[type='checkbox'])"));
        expect.soft(await fields.count(), `${what}: has fields`).toBeGreaterThan(0);
        for (const field of await fields.all()) {
          const box = (await field.boundingBox())!;
          const label = (await field.getAttribute("aria-label")) ?? (await field.textContent())?.trim();
          expect.soft(box.height, `${what}: height of "${label}"`).toBeGreaterThanOrEqual(TARGET);
          expect.soft(box.width, `${what}: width of "${label}"`).toBeGreaterThanOrEqual(TARGET);
          expect
            .soft(box.x + box.width, `${what}: "${label}" stays on screen`)
            .toBeLessThanOrEqual(viewport.width);
        }
      };

      for (const [what, path, title, last] of [
        ["a new line", `${planner}/lines/new`, es.budgeting.lineEditor.newTitle, es.budgeting.lineEditor.add],
        [
          "an existing line",
          `${planner}/lines/${line.id}`,
          es.budgeting.lineEditor.title.replace("{name}", LONG_LINE),
          es.budgeting.lineEditor.remove.open,
        ],
      ] as const) {
        await page.goto(path);
        await settle(page);
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        const { overflow, message } = await overflowReport(page, what);
        expect.soft(overflow, message).toBeLessThanOrEqual(0);
        await expectFullTargets(page, what, viewport.width);
        await expectFullFields(what);

        // The savings accounts appear with the Savings funding: their rows are full targets too.
        await page.getByRole("radio", { name: es.budgeting.funding.SAVINGS }).click();
        await expectFullFields(`${what} as savings`);
        await page.getByRole("radio", { name: es.budgeting.funding.DIRECT }).click();

        // The allocation editor: its four rules are full targets, and so is a member's value field by percentage.
        await expect(page.getByRole("region", { name: es.budgeting.allocation.title })).toBeVisible();
        await page.getByRole("radio", { name: es.budgeting.rule.PERCENT }).click();
        await expect(
          page.getByRole("region", { name: es.budgeting.allocation.title }).getByRole("group").first(),
        ).toBeVisible();
        await expectFullFields(`${what} by percentage`);
        const byPercentage = await overflowReport(page, `${what} by percentage`);
        expect.soft(byPercentage.overflow, byPercentage.message).toBeLessThanOrEqual(0);

        // The last control sits above the bottom bar once the page is scrolled to its end.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const bottom = (await page.getByRole("button", { name: last, exact: true }).boundingBox())!;
        const nav = (await page.getByRole("navigation", { name: es.shell.nav.main }).boundingBox())!;
        expect(bottom.y + bottom.height, `${what}: "${last}" ends above the bottom bar`).toBeLessThanOrEqual(
          nav.y,
        );

        // The way back is the shared header's link to the planner.
        const back = page.getByRole("link", { name: es.common.back, exact: true });
        await expect(back).toHaveAttribute("href", planner);
        const box = (await back.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(TARGET);
        expect(box.height).toBeGreaterThanOrEqual(TARGET);
      }

      // The category sheet: every row is a full target on screen, its last control is on top, and Escape closes it.
      await page.getByRole("button", { name: es.budgeting.mapping.choose }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const rows = page.getByRole("dialog").locator("label:has(input[type='checkbox'])");
      expect(await rows.count(), "the category sheet lists the space's categories").toBeGreaterThan(0);
      for (const row of await rows.all()) {
        const box = (await row.boundingBox())!;
        const label = (await row.textContent())?.trim();
        expect.soft(box.height, `category sheet: height of "${label}"`).toBeGreaterThanOrEqual(TARGET);
        expect
          .soft(box.x + box.width, `category sheet: "${label}" stays on screen`)
          .toBeLessThanOrEqual(viewport.width);
      }
      const mappingSheet = await overflowReport(page, "the category sheet");
      expect.soft(mappingSheet.overflow, mappingSheet.message).toBeLessThanOrEqual(0);
      expect(await lastControlIsOnTop(page), "the category sheet").toBe("ok");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // The removal confirmation: its last control is on top of everything, and Escape closes it without removing.
      await page.getByRole("button", { name: es.budgeting.lineEditor.remove.open }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await lastControlIsOnTop(page), "the removal sheet").toBe("ok");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // The way back leads to the planner.
      await page.getByRole("link", { name: es.common.back, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${planner}$`));
      await expect(page.getByText(LONG_LINE)).toBeVisible();
    });
  }

  test("a line is added, edited and removed through the real API from the planner (HU-E9-08)", async ({
    page,
  }) => {
    const { sharedId } = await session(page, "line-editor-flow");
    const plan = await seedBigPlan(page, sharedId, "2026-10");
    const planner = `/spaces/${sharedId}/plans/${plan.id}`;
    await page.goto(planner);
    await settle(page);
    await page.getByRole("link", { name: es.budgeting.planner.addLine }).click();
    await page.getByLabel(es.budgeting.lineEditor.field.name).fill("Mascotas");
    await page.getByLabel(es.budgeting.lineEditor.field.planned).fill("100.000");
    await page.getByRole("radio", { name: es.budgeting.rollover.ROLLOVER }).click();
    await page.getByRole("button", { name: es.budgeting.lineEditor.add, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${planner}$`));
    const row = page.getByRole("listitem", { name: "Mascotas" });
    await expect(row).toContainText(es.budgeting.rollover.ROLLOVER);
    await expect(row).toContainText("100.000");

    await row
      .getByRole("link", { name: es.budgeting.planner.editLine.replace("{name}", "Mascotas") })
      .click();
    await expect(page.getByRole("radio", { name: es.budgeting.rollover.ROLLOVER })).toBeChecked();
    await page.getByLabel(es.budgeting.lineEditor.field.planned).fill("150.000");
    // HU-E9-08: a category and a percentage, which the real API must answer the way the preview said.
    await page.getByRole("button", { name: es.budgeting.mapping.choose }).click();
    const categories = page.getByRole("dialog");
    await categories.getByRole("checkbox").first().check();
    await categories.getByRole("button", { name: es.budgeting.mapping.done }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("radio", { name: es.budgeting.rule.PERCENT }).click();
    const own = page.getByRole("region", { name: es.budgeting.allocation.title }).getByRole("group").first();
    await own.getByRole("textbox").fill("100");
    await expect(own).toContainText("150.000");
    await page.getByRole("button", { name: es.budgeting.lineEditor.save, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${planner}$`));
    await expect(page.getByRole("listitem", { name: "Mascotas" })).toContainText("150.000");
    const saved = (await get(page, `/api/v1/spaces/${sharedId}/plans/${plan.id}`)).lines.find(
      (line: { name: string }) => line.name === "Mascotas",
    );
    expect(saved.categoryIds).toHaveLength(1);
    expect(saved.allocation.rule).toBe("PERCENT");
    expect(saved.allocation.members[0].assigned.amount).toBe("15000000");

    await page
      .getByRole("listitem", { name: "Mascotas" })
      .getByRole("link", { name: es.budgeting.planner.editLine.replace("{name}", "Mascotas") })
      .click();
    await page.getByRole("button", { name: es.budgeting.lineEditor.remove.open }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: es.budgeting.lineEditor.remove.confirm, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${planner}$`));
    await expect(page.getByRole("listitem", { name: "Mascotas" })).toHaveCount(0);
    await expect(page.getByText(LONG_LINE)).toBeVisible();
  });

  test("another member never receives Ana's suggestion, in the screen or in the page they are sent (ruling P208)", async ({
    page,
  }) => {
    const { spaceId, sharedId } = await session(page, "capacities-private");
    const plan = await seedBigPlan(page, sharedId, "2026-10");
    await seedIncome(page, spaceId);
    const { url } = await post(page, `/api/v1/spaces/${sharedId}/invitations`, {
      kind: "LINK",
      role: "MEMBER",
    });
    const juan = await Person.signUp(request, "Juan", `layout-juan-private-${Date.now()}@example.com`, {
      "x-forwarded-for": `10.253.${randomInt(256)}.${randomInt(1, 255)}`,
    });
    try {
      await juan.api.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`, {});
      const sent = await juan.api.html(`/spaces/${sharedId}/plans/${plan.id}/capacities`);
      // Ana's September income is in neither the text nor the data of Juan's page...
      expect(sent).not.toContain("1.650.000");
      expect(sent).not.toContain("165000000");
      // ...and his own row has no suggestion: he earned nothing, and a suggestion of 0 is dropped (#175).
      expect(sent).toContain("Capacidad de Juan");
      // The catalog's "Sugerido {amount}" template travels with the messages; no rendered amount follows it.
      expect(sent).not.toMatch(/Sugerido \$/);
    } finally {
      await juan.dispose();
    }
    // Ana, the page, still gets hers.
    await page.goto(`/spaces/${sharedId}/plans/${plan.id}/capacities`);
    await expect(page.getByText(/Sugerido \$\s1\.650\.000:/)).toBeVisible();
  });

  test("from 640 px the member matrix scrolls inside its own focusable region, never the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    const { sharedId } = await session(page, "plan-matrix-640");
    await seedOverBudgetPlan(page, sharedId);
    const path = `/spaces/${sharedId}/plan/members`;
    await page.goto(path);
    await settle(page);
    const { overflow, message } = await overflowReport(page, path);
    expect(overflow, message).toBeLessThanOrEqual(0);
    const region = page.getByRole("region", { name: es.reports.matrix.caption.replace("{line}", LONG_LINE) });
    await region.focus();
    await expect(region, "the scroll region takes the keyboard").toBeFocused();
    await expect(region.getByRole("columnheader")).toHaveCount(5);
  });
});

// 59 and 56 of the 60 characters a category name takes.
const LONG_CATEGORY = "Mascotas, veterinario y accesorios de toda la familia Pérez";
const LONG_SUBCATEGORY = "Consultas y vacunas de la clínica veterinaria del barrio";

/**
 * The shared space's first group gets a category and a subcategory with names as long as the API takes, and
 * billion-peso spending both in the category itself and in the subcategory, so every level of the drill-down has a
 * long name and big figures (HU-E9-10, ruling P215).
 */
const seedGroupSpending = async (page: Page, sharedId: string) => {
  const space = `/api/v1/spaces/${sharedId}`;
  const { items: groups } = await get(page, `${space}/categories`);
  const style = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" };
  const category = await post(page, `${space}/categories`, {
    groupId: groups[0].id,
    name: LONG_CATEGORY,
    ...style,
  });
  const subcategory = await post(page, `${space}/categories`, {
    // A subcategory shows its parent's style and takes none of its own.
    parentCategoryId: category.id,
    name: LONG_SUBCATEGORY,
  });
  const fund = await post(page, `${space}/accounts`, {
    name: "Fondo de grupos",
    type: "SHARED_FUND",
    openingBalance: { amount: "0", currency: "COP" },
  });
  for (const [categoryId, minor] of [
    [category.id, "123456789000"],
    [subcategory.id, "98765432100"],
  ] as const) {
    const amount = { amount: minor, currency: "COP" };
    await post(
      page,
      `${space}/expenses`,
      {
        description: "Gasto de grupo",
        date: "2026-10-30",
        occurredAt: "2026-10-30T17:00:00.000Z",
        timeZone: "America/Bogota",
        categoryId,
        amount,
        payments: [{ memberId: null, accountId: fund.id, amount }],
      },
      { "idempotency-key": crypto.randomUUID() },
    );
  }
};

/** No page scroll, and every row and crumb of a By group level is a full target that starts and ends on screen. */
const levelFits = async (page: Page, viewport: { width: number }, where: string) => {
  const { overflow, message } = await overflowReport(page, where);
  expect.soft(overflow, message).toBeLessThanOrEqual(0);
  for (const control of await page.locator("main").getByRole("button").all()) {
    const box = (await control.boundingBox())!;
    expect.soft(box.height, `${where}: a control is at least 44 px tall`).toBeGreaterThanOrEqual(TARGET);
    expect.soft(box.x, `${where}: and starts on screen`).toBeGreaterThanOrEqual(0);
    expect.soft(box.x + box.width, `${where}: and ends on screen`).toBeLessThanOrEqual(viewport.width);
  }
};

test.describe("the By group view (HU-E9-10, ruling P215)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`keeps long names and big figures on screen, drills with 44 px targets and goes back level by level at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, `by-group-${viewport.width}`);
      await seedGroupSpending(page, sharedId);
      const path = `/spaces/${sharedId}/plan/groups`;
      const drills = () => new URL(page.url()).searchParams.getAll("drill");
      const trail = page.getByRole("navigation", { name: es.reports.byGroup.trail });

      const fits = (where: string) => levelFits(page, viewport, where);

      await page.goto(path);
      await settle(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/octubre 2026/i);
      await expect(page.getByText(es.reports.byGroup.hint.groups)).toBeVisible();
      await fits("groups");

      await page.getByRole("list", { name: es.reports.byGroup.groups }).getByRole("button").first().click();
      await expect(page.getByText(LONG_CATEGORY).first()).toBeVisible();
      expect(drills()).toHaveLength(1);
      await fits("categories");

      await page.getByRole("button", { name: new RegExp(`^${LONG_CATEGORY}`) }).click();
      await expect(page.getByText(LONG_SUBCATEGORY)).toBeVisible();
      await expect(page.getByText(es.reports.byGroup.noSubcategory)).toBeVisible();
      expect(drills()).toHaveLength(2);
      await fits("subcategories");

      // Each level is a history entry: Back climbs one level, Forward descends, and a reload keeps the level.
      await page.goBack();
      await expect(page.getByText(es.reports.byGroup.hint.categories)).toBeVisible();
      expect(drills()).toHaveLength(1);
      await page.goForward();
      await expect(page.getByText(LONG_SUBCATEGORY)).toBeVisible();
      await page.reload();
      await expect(page.getByText(LONG_SUBCATEGORY)).toBeVisible();
      expect(drills()).toHaveLength(2);

      // The breadcrumb goes back to the root, and the period stays in the address.
      await trail.getByRole("button", { name: es.reports.byGroup.all }).click();
      await expect(page.getByText(es.reports.byGroup.hint.groups)).toBeVisible();
      expect(drills()).toEqual([]);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/octubre 2026/i);
    });
  }
});

test.describe("the personal By group view (HU-E9-11, rulings P76 and P215)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`merges the seeded group, names a custom category by its space and goes back level by level at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId, sharedId } = await session(page, `personal-by-group-${viewport.width}`);
      await seedGroupSpending(page, sharedId);
      const drills = () => new URL(page.url()).searchParams.getAll("drill");
      const trail = page.getByRole("navigation", { name: es.reports.byGroup.trail });
      const scoped = (name: string) =>
        es.reports.spaceScoped.replace("{space}", "Casa").replace("{name}", name);
      const fits = (where: string) => levelFits(page, viewport, where);

      // The tab opens from the personal Plan tab's own row of views, on the same period.
      await page.goto(`/spaces/${spaceId}/plan`);
      await settle(page);
      await page.getByRole("link", { name: es.reports.view.groups }).click();
      await expect(page).toHaveURL(`/spaces/${spaceId}/plan/groups?period=2026-10`);
      await expect(page.getByText(es.reports.byGroup.personalNote)).toBeVisible();
      await expect(page.getByText(es.reports.byGroup.hint.groups)).toBeVisible();
      await fits("groups");

      await page.getByRole("list", { name: es.reports.byGroup.groups }).getByRole("button").first().click();
      await expect(page.getByText(scoped(LONG_CATEGORY)).first()).toBeVisible();
      expect(drills()).toHaveLength(1);
      await fits("categories");

      await page.getByRole("button", { name: new RegExp(`^${scoped(LONG_CATEGORY)}`) }).click();
      await expect(page.getByText(scoped(LONG_SUBCATEGORY))).toBeVisible();
      await expect(page.getByText(es.reports.byGroup.noSubcategory)).toBeVisible();
      expect(drills()).toHaveLength(2);
      await fits("subcategories");

      // Every level is a history entry, and the breadcrumb climbs back to the groups on the same period.
      await page.goBack();
      await expect(page.getByText(es.reports.byGroup.hint.categories)).toBeVisible();
      await page.goForward();
      await trail.getByRole("button", { name: es.reports.byGroup.all }).click();
      await expect(page.getByText(es.reports.byGroup.hint.groups)).toBeVisible();
      expect(drills()).toEqual([]);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(/octubre 2026/i);
    });
  }
});

test.describe("bottom sheets sit above the bottom navigation", () => {
  test("the last control of every sheet is the topmost element at its center", async ({ page }) => {
    const { spaceId, sharedId } = await session(page, "sheets");
    for (const sheet of sheets) {
      await page.goto(
        sheet.path === "settings"
          ? "/settings"
          : `/spaces/${sheet.shared ? sharedId : spaceId}${sheet.path ? `/${sheet.path}` : ""}`,
      );
      await sheet.open(page, spaceId);
      await expect(page.getByRole("dialog")).toBeVisible();
      expect.soft(await lastControlIsOnTop(page), sheet.name).toBe("ok");
      await page.keyboard.press("Escape");
    }
  });

  test("the open sheet and its scrim are painted above the navigation", async ({ page }) => {
    const { spaceId } = await session(page, "stacking");
    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const covered = await page.evaluate(() => {
      const nav = document.querySelector("nav[aria-label]")!.getBoundingClientRect();
      const hit = window.paintedAt(nav.left + nav.width / 2, nav.top + 4);
      return hit?.closest("nav") != null;
    });
    expect(covered, "the navigation still receives the point under the sheet").toBe(false);
  });
});

test.describe("sheets fit the screen and only their body scrolls", () => {
  test("on a short phone the header stays on screen and the body scrolls on its own", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    const { spaceId } = await session(page, "short");
    await page.goto(`/spaces/${spaceId}/new`);
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    await page.getByTestId("when-chip").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const body = [...el.querySelectorAll<HTMLElement>("*")].find(
        (child) => getComputedStyle(child).overflowY === "auto",
      );
      return {
        top: r.top,
        bottom: r.bottom,
        height: window.innerHeight,
        bodyScrolls: body ? body.scrollHeight > body.clientHeight : false,
        overscroll: body ? getComputedStyle(body).overscrollBehaviorY : "none",
        dialogScrolls: el.scrollHeight > el.clientHeight + 1,
      };
    });
    expect(box.top, "header is on screen").toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(box.height);
    expect(box.bodyScrolls, "the body is the scroller").toBe(true);
    expect(box.dialogScrolls, "the sheet itself does not scroll").toBe(false);
    expect(box.overscroll).toBe("contain");
    await expect(dialog.getByRole("button", { name: es.common.close })).toBeInViewport();
  });

  test("the sheet is capped in dvh, with a fallback", async ({ page }) => {
    const { spaceId } = await session(page, "dvh");
    await page.goto(`/spaces/${spaceId}`);
    await page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click();
    const cap = await page.getByRole("dialog").evaluate((el) => getComputedStyle(el).maxHeight);
    expect(cap).toBe(`${Math.round(PHONE.height * 0.9 * 100) / 100}px`);
    const sources = await page.evaluate(() =>
      [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .map((r) => r.cssText)
        .join("\n"),
    );
    expect(sources).toMatch(/max-height:\s*90dvh/);
  });

  test("in Porcentaje, each share of the split sheet comes into view above Listo on the audit's phone (#177)", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    const { sharedId } = await session(page, "split-percent");
    await page.goto(`/spaces/${sharedId}/new`);
    await ensureSecondMember(page);
    await page.reload();
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    await page.locator("#record-amount").fill("300000");
    await page.getByRole("button", { name: es.ledger.form.moreOptions }).click();
    await page.getByRole("button", { name: new RegExp(es.ledger.split.split) }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: es.ledger.split.methods.PERCENT }).click();
    const shares = dialog.getByLabel(new RegExp(`^${es.ledger.split.valueOf.replace("{name}", "")}`));
    expect(await shares.count()).toBeGreaterThanOrEqual(2);
    const done = dialog.getByRole("button", { name: es.ledger.split.done });
    for (const share of await shares.all()) {
      await share.scrollIntoViewIfNeeded();
      const box = (await share.boundingBox())!;
      const footer = (await done.boundingBox())!;
      expect(box.y + box.height, "the share ends above Listo").toBeLessThanOrEqual(footer.y);
      const onTop = await share.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = window.paintedAt(r.left + r.width / 2, r.top + r.height / 2);
        return hit !== null && (el === hit || el.contains(hit));
      });
      expect(onTop, "nothing covers the share").toBe(true);
    }
  });

  test("the page behind does not scroll while a sheet is open", async ({ page }) => {
    const { spaceId } = await session(page, "scroll-lock");
    await page.goto(`/spaces/${spaceId}/transactions`);
    await settle(page);
    // A tall page, so there is something to scroll behind the scrim.
    await page.evaluate(() => {
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.querySelector("main")!.append(filler);
    });
    await page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.mouse.move(195, 40);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

const MARKET = /Mercado semanal/;
const sheet = (page: Page) => page.getByRole("dialog", { name: MARKET });

/** Movimientos reached from Cuentas through the bottom navigation, so there is somewhere to go back to. */
const listFromAccounts = async (page: Page, tag: string) => {
  const { spaceId } = await session(page, tag);
  const list = `/spaces/${spaceId}/transactions`;
  await page.goto(`/spaces/${spaceId}/accounts`);
  await settle(page);
  await page
    .getByRole("navigation", { name: es.shell.nav.main })
    .getByRole("link", { name: es.shell.nav.transactions })
    .click();
  await expect(page).toHaveURL(new RegExp(`${list}$`));
  await settle(page);
  return { spaceId, list, accounts: `/spaces/${spaceId}/accounts` };
};

test.describe("the transaction detail sheet is addressed by the URL (ruling P189)", () => {
  test("a row opens it with a new entry, Back closes it and Forward opens it again", async ({ page }) => {
    const { list } = await listFromAccounts(page, "detail-sheet");
    const entries = () => page.evaluate(() => window.history.length);
    const before = await entries();

    await page.getByRole("link", { name: MARKET }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(page).toHaveURL(/\?tx=[^&]+$/);
    expect(await entries(), "opening is a push").toBe(before + 1);

    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    await page.goForward();
    await expect(sheet(page)).toBeVisible();
  });

  for (const how of ["the close button", "Escape"] as const) {
    test(`closing with ${how} goes back, so Back then leaves the list for where the person was`, async ({
      page,
    }) => {
      const { list, accounts } = await listFromAccounts(
        page,
        `detail-close-${how === "Escape" ? "esc" : "x"}`,
      );
      await page.getByRole("link", { name: MARKET }).click();
      await expect(sheet(page)).toBeVisible();
      if (how === "Escape") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: es.common.close }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${list}$`));

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${accounts}$`));
    });
  }

  test("a reload keeps the sheet and closing it still goes back to the list", async ({ page }) => {
    const { list, accounts } = await listFromAccounts(page, "detail-reload");
    await page.getByRole("link", { name: MARKET }).click();
    await expect(sheet(page)).toBeVisible();
    await page.reload();
    await expect(sheet(page)).toBeVisible();
    await page.getByRole("button", { name: es.common.close }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${accounts}$`));
  });

  test("a deep link has no entry before it, so closing replaces it and adds none", async ({ page }) => {
    const { list, accounts } = await listFromAccounts(page, "detail-deep");
    await page.getByRole("link", { name: MARKET }).click();
    await expect(sheet(page)).toBeVisible();
    const deep = page.url();
    await page.goto(accounts);
    await settle(page);
    await page.goto(deep);
    await expect(sheet(page)).toBeVisible();
    const entries = await page.evaluate(() => window.history.length);

    await page.getByRole("button", { name: es.common.close }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    expect(await page.evaluate(() => window.history.length), "closing replaces the entry").toBe(entries);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${accounts}$`));
  });

  test("a deleted or unknown transaction in the address says so inside the sheet", async ({ page }) => {
    const { spaceId } = await session(page, "detail-missing");
    await page.goto(`/spaces/${spaceId}/transactions?tx=00000000-0000-4000-8000-000000000000`);
    const dialog = page.getByRole("dialog", { name: es.errors.TransactionNotFound });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveText(es.errors.TransactionNotFound);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/transactions$`));
  });
});

test.describe("deleting from the detail sheet leaves the person on the list and offers Deshacer (ruling P194)", () => {
  const entries = (page: Page) => page.evaluate(() => window.history.length);
  const statusOf = (page: Page) => page.getByRole("region", { name: es.toast.region }).getByRole("status");

  /** The toast with Deshacer sits above the navigation, inside the width, and its buttons are full targets. */
  const expectToastAboveNavigation = async (page: Page, width: number) => {
    const toast = page.getByTestId("toast");
    await toast.hover();
    const nav = (await page.locator("nav[aria-label]").boundingBox())!;
    const box = (await toast.boundingBox())!;
    expect(box.y + box.height, "the toast ends above the navigation").toBeLessThanOrEqual(nav.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "the toast stays inside the width").toBeLessThanOrEqual(width);
    const undo = (await page.getByRole("button", { name: es.ledger.toast.undo }).boundingBox())!;
    expect(undo.width).toBeGreaterThanOrEqual(TARGET);
    expect(undo.height).toBeGreaterThanOrEqual(TARGET);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  };

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`from a list opened in the app: back to it with no new entry, Deshacer brings the row back at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { list, accounts } = await listFromAccounts(page, `delete-back-${viewport.width}`);
      await page.getByRole("link", { name: MARKET }).click();
      await expect(sheet(page)).toBeVisible();
      const opened = await entries(page);

      await page.getByRole("button", { name: es.ledger.detail.delete }).click();
      await expect(statusOf(page)).toContainText(es.ledger.toast.deleted.EXPENSE);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${list}$`));
      // The list behind was refreshed once it was back: the deleted row is gone.
      await expect(page.getByRole("link", { name: MARKET })).toHaveCount(0);
      expect(await entries(page), "deleting adds no history entry").toBe(opened);
      await expectToastAboveNavigation(page, viewport.width);

      await statusOf(page).getByRole("button", { name: es.ledger.toast.undo }).click();
      await expect(statusOf(page)).toContainText(es.ledger.toast.restored.EXPENSE);
      await expect(page.getByRole("link", { name: MARKET })).toBeVisible();
      expect(await entries(page), "undoing adds no history entry").toBe(opened);

      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`${accounts}$`));
    });
  }

  test("from a deep link: the entry is replaced by the list, and Deshacer brings the row back", async ({
    page,
  }) => {
    const { list, accounts } = await listFromAccounts(page, "delete-deep");
    await page.getByRole("link", { name: MARKET }).click();
    await expect(sheet(page)).toBeVisible();
    const deep = page.url();
    await page.goto(accounts);
    await settle(page);
    await page.goto(deep);
    await expect(sheet(page)).toBeVisible();
    const opened = await entries(page);

    await page.getByRole("button", { name: es.ledger.detail.delete }).click();
    await expect(statusOf(page)).toContainText(es.ledger.toast.deleted.EXPENSE);
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    await expect(page.getByRole("link", { name: MARKET })).toHaveCount(0);
    expect(await entries(page), "deleting replaces the entry of the sheet").toBe(opened);

    await statusOf(page).getByRole("button", { name: es.ledger.toast.undo }).click();
    await expect(statusOf(page)).toContainText(es.ledger.toast.restored.EXPENSE);
    await expect(page.getByRole("link", { name: MARKET })).toBeVisible();
  });

  test("the address of a transaction just deleted says it no longer exists, with nothing to delete", async ({
    page,
  }) => {
    const { list } = await listFromAccounts(page, "delete-address");
    await page.getByRole("link", { name: MARKET }).click();
    await expect(sheet(page)).toBeVisible();
    const address = page.url();
    expect(address).toMatch(/\?tx=/);
    await page.getByRole("button", { name: es.ledger.detail.delete }).click();
    await expect(page).toHaveURL(new RegExp(`${list}$`));
    await page.goto(address);
    const dialog = page.getByRole("dialog", { name: es.errors.TransactionNotFound });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: es.ledger.detail.delete })).toHaveCount(0);
  });
});

test.describe("touch targets are at least 44 x 44 px (WCAG 2.5.5)", () => {
  test("the sign-up page links to sign-in with a full target", async ({ page }) => {
    await page.goto("/sign-up");
    const box = await page.getByRole("link", { name: es.auth.signUp.signIn }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(TARGET);
    expect(box!.width).toBeGreaterThanOrEqual(TARGET);
  });

  test("the date and time sheet controls are large and the AM/PM labels sit inside their segments", async ({
    page,
  }) => {
    const { spaceId } = await session(page, "targets");
    await page.goto(`/spaces/${spaceId}/new`);
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    await page.getByTestId("when-chip").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const small = await dialog.evaluate((el, floor) => {
      const targets = el.querySelectorAll<HTMLElement>("button, a[href], input, [role='radio']");
      return [...targets]
        .map((target) => ({ target, r: target.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < floor || r.height < floor))
        .map(
          ({ target, r }) =>
            `${target.getAttribute("aria-label") ?? target.textContent} ${r.width}x${r.height}`,
        );
    }, TARGET);
    expect(small).toEqual([]);

    // The labels never leave their segment, and the segments never overlap the clock controls.
    const collisions = await dialog.evaluate((el) => {
      const halves = [...el.querySelectorAll<HTMLElement>("[role='radio']")].filter((radio) =>
        /^(a\. ?m\.|p\. ?m\.|AM|PM)$/i.test(radio.textContent?.trim() ?? ""),
      );
      if (halves.length !== 2) return [`expected 2 AM/PM segments, found ${halves.length}`];
      const clock = [
        ...el.querySelectorAll<HTMLElement>("[role='group'] button, [role='group'] output"),
      ].filter((control) => !control.closest("[role='radiogroup']"));
      const out: string[] = [];
      for (const half of halves) {
        const label = half.textContent?.trim();
        if (half.scrollWidth > half.clientWidth) out.push(`${label} overflows its segment`);
        const a = half.getBoundingClientRect();
        for (const other of clock) {
          const b = other.getBoundingClientRect();
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            out.push(`${label} overlaps ${other.getAttribute("aria-label") ?? other.tagName}`);
        }
      }
      return out;
    });
    expect(collisions).toEqual([]);
  });

  test("the line warning's two buttons and the calendar's two window links are full targets (#142, #150)", async ({
    page,
  }) => {
    const { spaceId } = await session(page, "targets-additions");
    const household = await seedAdditions(page, spaceId, test.info().testId);
    await page.goto(`/spaces/${household}/new`);
    await askBeforeSaving(page);
    const measure = async (label: string, target: Locator) => {
      const box = (await target.boundingBox())!;
      expect.soft(box.width, `width of "${label}"`).toBeGreaterThanOrEqual(TARGET);
      expect.soft(box.height, `height of "${label}"`).toBeGreaterThanOrEqual(TARGET);
    };
    for (const name of [es.ledger.lineWarning.confirm, es.ledger.lineWarning.review])
      await measure(name, page.getByRole("button", { name, exact: true }));
    await page.goto(`/spaces/${spaceId}/plan/calendar`);
    for (const days of ["30", "60"]) {
      const label = es.reports.calendar.days.replace("{days}", days);
      await measure(label, page.getByRole("main").getByRole("link", { name: label, exact: true }));
    }
  });
});

test.describe("a focused control is never hidden by the bottom navigation (WCAG 2.4.11)", () => {
  test("tabbing to the end of the record form leaves the last control uncovered", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 560 });
    const { spaceId } = await session(page, "focus");
    await page.goto(`/spaces/${spaceId}/new`);
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    const save = page.getByRole("button", { name: es.ledger.form.save.EXPENSE });
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      if (await save.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(save).toBeFocused();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    const hit = await save.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top !== null && el.contains(top);
    });
    expect(hit, "the focused Save button is the topmost element at its center").toBe(true);
  });

  test("the scrolling root keeps room for the navigation and the safe area", async ({ page }) => {
    const { spaceId } = await session(page, "scroll-padding");
    await page.goto(`/spaces/${spaceId}`);
    const padding = await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
    expect(parseFloat(padding)).toBeGreaterThanOrEqual(76);
  });
});

test.describe("the last control of a scrolling screen ends above the bottom bar (UX: nothing under the bar)", () => {
  /**
   * The seeded ids a screen's address takes: the personal space, the shared space "Casa", and the household when the
   * screen asks for one.
   */
  type Ids = { readonly spaceId: string; readonly sharedId: string; readonly household?: string };
  const ready = async (page: Page) => {
    await expect(page.locator("[data-ready='true']")).toBeAttached();
  };
  /** The edit route of a transaction the API just recorded (ruling P191). */
  const editOf = (spaceId: string, transaction: { id: string }) =>
    `/spaces/${spaceId}/transactions/${transaction.id}/edit`;
  /** Ruling P191 and #171: an income of the personal space, so its edit form names the account that received it. */
  const editIncome = async ({ spaceId }: Ids, page: Page) => {
    const space = `/api/v1/spaces/${spaceId}`;
    const { items: accounts } = await get(page, `${space}/accounts`);
    const { items: groups } = await get(page, `${space}/categories`);
    const salary = groups
      .flatMap((group: { categories: { id: string; key: string | null }[] }) => group.categories)
      .find((category: { key: string | null }) => category.key === "salary");
    const income = await post(
      page,
      `${space}/incomes`,
      {
        description: "Salario de octubre con la prima y las horas extra del mes",
        date: "2026-10-30",
        categoryId: salary.id,
        amount: { amount: BIG_EXPENSE, currency: "COP" },
        accountId: bancolombiaIn(accounts),
      },
      { "idempotency-key": crypto.randomUUID() },
    );
    return editOf(spaceId, income);
  };
  /**
   * Ruling P191 and #171: a shared expense of "Casa" split with a guest whose name is as long as a real one, paid from
   * the person's own account. Its edit form names who paid and starts with the division open: its tallest context.
   */
  const editSharedSplit = async ({ spaceId, sharedId }: Ids, page: Page) => {
    const space = `/api/v1/spaces/${sharedId}`;
    const { items: accounts } = await get(page, `/api/v1/spaces/${spaceId}/accounts`);
    const guest = await post(page, `${space}/guests`, { displayName: HISTORY_GUEST });
    const { items: members } = await get(page, `${space}/members`);
    const owner = members.find((m: { kind: string }) => m.kind === "USER");
    const { items: groups } = await get(page, `${space}/categories`);
    const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
    const amount = { amount: BIG_EXPENSE, currency: "COP" };
    const expense = await post(
      page,
      `${space}/expenses`,
      {
        description: "Mercado semanal en la plaza de Paloquemao con frutas verduras y otras cosas",
        date: "2026-10-30",
        occurredAt: "2026-10-30T17:00:00.000Z",
        timeZone: "America/Bogota",
        categoryId,
        amount,
        payments: [{ memberId: owner.id, accountId: bancolombiaIn(accounts), amount }],
        split: { method: "EQUAL", participants: [{ memberId: owner.id }, { memberId: guest.id }] },
      },
      { "idempotency-key": crypto.randomUUID() },
    );
    return editOf(sharedId, expense);
  };
  const screens: {
    readonly name: string;
    readonly household?: boolean;
    readonly at: (ids: Ids, page: Page) => string | Promise<string>;
    readonly prepare: (page: Page) => Promise<void>;
    readonly submit: string;
  }[] = [
    {
      name: "record form",
      at: ({ spaceId }: Ids) => `/spaces/${spaceId}/new`,
      prepare: ready,
      submit: es.ledger.form.save.EXPENSE,
    },
    // #171 on the edit route (ruling P191): the same compact form, in each context it opens in.
    {
      name: "edit form, an expense with a long description, account and amount",
      at: ({ spaceId }: Ids, page: Page) => editPathOf(page, spaceId),
      prepare: ready,
      submit: es.ledger.edit.save,
    },
    {
      name: "edit form, an income",
      at: editIncome,
      prepare: ready,
      submit: es.ledger.edit.save,
    },
    {
      name: "edit form, a shared expense with its split",
      at: editSharedSplit,
      prepare: ready,
      submit: es.ledger.edit.save,
    },
    {
      name: "new account",
      at: ({ spaceId }: Ids) => `/spaces/${spaceId}/accounts/new`,
      // A credit card asks for the most attributes, so the form is the longest it gets.
      prepare: async (page: Page) => {
        await page.getByRole("radio", { name: es.accounts.type.CREDIT_CARD }).click();
      },
      submit: es.accounts.create,
    },
    {
      // #142 (ruling P235): the question the form asks before an expense that takes its line over.
      name: "record form, line warning confirmation",
      household: true,
      at: ({ household }: Ids) => `/spaces/${household}/new`,
      prepare: askBeforeSaving,
      submit: es.ledger.lineWarning.confirm,
    },
  ];

  for (const viewport of [PHONE, SMALL_PHONE]) {
    for (const screen of screens) {
      test(`${screen.name}: the primary button is fully visible and uncovered at ${viewport.width} px`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        // A phone with a home indicator: the bar grows by the safe area, and so must the room under the page.
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { bottom: 34 } });
        const { spaceId, sharedId } = await session(page, "bottom-bar");
        const household = screen.household
          ? await seedAdditions(page, spaceId, test.info().testId)
          : undefined;
        await page.goto(await screen.at({ spaceId, sharedId, ...(household ? { household } : {}) }, page));
        await screen.prepare(page);
        const submit = page.getByRole("button", { name: screen.submit, exact: true });
        await expect(submit).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
        const seen = await submit.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const bar = document.querySelector("nav")?.getBoundingClientRect();
          const hit = (x: number, y: number) => {
            const top = document.elementFromPoint(x, y);
            return top !== null && el.contains(top);
          };
          return {
            bottom: r.bottom,
            top: r.top,
            barTop: bar ? bar.top : window.innerHeight,
            barHeight: bar ? bar.height : 0,
            barInset: parseFloat(getComputedStyle(document.querySelector("nav")!).paddingBottom),
            // How far the document extends below the button: the room the page keeps for the bar.
            below: document.documentElement.scrollHeight - (r.bottom + window.scrollY),
            viewport: window.innerHeight,
            // Rounded corners are not painted by the button, so the probes sit inside its straight edges.
            probes: [
              hit(r.left + r.width / 4, r.top + 3),
              hit(r.right - r.width / 4, r.top + 3),
              hit(r.left + r.width / 4, r.bottom - 3),
              hit(r.right - r.width / 4, r.bottom - 3),
              hit(r.left + r.width / 2, r.top + r.height / 2),
            ],
          };
        });
        expect(seen.barInset, "the emulated safe area reaches the bar").toBe(34);
        expect(seen.barHeight, "the bar keeps its 76 px of room above the safe area").toBeGreaterThanOrEqual(
          76 + 34,
        );
        expect(seen.below, "the page keeps room for the bar and the safe area").toBeGreaterThanOrEqual(
          seen.barHeight,
        );
        expect(seen.top, "the button starts on screen").toBeGreaterThanOrEqual(0);
        expect(seen.bottom, "the button ends above the bottom bar").toBeLessThanOrEqual(seen.barTop);
        expect(
          seen.probes,
          "the top and bottom edges and the center of the button are painted by it",
        ).toEqual([true, true, true, true, true]);
      });
    }
  }
});

test.describe("a shared row names who paid in full (UX review, S1)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`a long payer name wraps on its own line instead of being cut at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { sharedId } = await session(page, "payer-row");
      const space = `/api/v1/spaces/${sharedId}`;
      const guest = await post(page, `${space}/guests`, { displayName: HISTORY_GUEST });
      const { items: members } = await get(page, `${space}/members`);
      const owner = members.find((m: { kind: string }) => m.kind === "USER");
      const { items: groups } = await get(page, `${space}/categories`);
      const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
      const amount = { amount: "30000000", currency: "COP" };
      await post(
        page,
        `${space}/expenses`,
        {
          description: "Mercado",
          date: "2026-10-30",
          occurredAt: "2026-10-30T17:00:00.000Z",
          timeZone: "America/Bogota",
          categoryId,
          amount,
          payments: [{ memberId: guest.id, accountId: null, amount }],
          split: { method: "EQUAL", participants: [{ memberId: owner.id }, { memberId: guest.id }] },
        },
        { "idempotency-key": crypto.randomUUID() },
      );
      await page.goto(`/spaces/${sharedId}/transactions`);
      const payer = page.getByText(/^pagó Carlos Alberto/);
      await expect(payer).toBeVisible();
      const read = await payer.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          text: el.textContent,
          clipped: el.scrollWidth > el.clientWidth + 1,
          truncates: style.textOverflow === "ellipsis" || style.overflow === "hidden",
          right: r.right,
          page: document.documentElement.scrollWidth,
        };
      });
      expect(read.text).toContain(HISTORY_GUEST);
      expect(read.truncates, "the payer line never truncates").toBe(false);
      expect(read.clipped, "the payer name is fully visible").toBe(false);
      expect(read.right).toBeLessThanOrEqual(viewport.width);
      expect(read.page, "no horizontal scroll").toBeLessThanOrEqual(viewport.width);
    });
  }
});

test.describe("the app has an icon, so no page asks for a missing one (UX review, S6)", () => {
  test("the sign-in screen links an SVG icon and an apple-touch icon that load without a session", async ({
    page,
  }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    await page.goto("/sign-in");
    const icon = page.locator("link[rel='icon'][type='image/svg+xml']");
    const apple = page.locator("link[rel='apple-touch-icon']");
    await expect(icon).toHaveAttribute("href", /^\/icon\.svg/);
    await expect(apple).toHaveAttribute("href", /^\/apple-icon\.png/);
    const svg = await page.request.get((await icon.getAttribute("href"))!);
    expect(svg.status()).toBe(200);
    expect(svg.headers()["content-type"]).toContain("image/svg+xml");
    expect(await svg.text()).toContain("<svg");
    const png = await page.request.get((await apple.getAttribute("href"))!);
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toContain("image/png");
    expect((await png.body()).subarray(1, 4).toString("latin1")).toBe("PNG");
    await page.waitForLoadState("networkidle");
    expect(failed, "no request to a missing file").toEqual([]);
  });

  test("a signed-in page links the same icons and loads cleanly", async ({ page }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    });
    const { spaceId } = await session(page, "icons");
    await page.goto(`/spaces/${spaceId}`);
    await expect(page.locator("link[rel='icon'][type='image/svg+xml']")).toBeAttached();
    await page.waitForLoadState("networkidle");
    expect(failed, "no request to a missing file").toEqual([]);
  });
});

test.describe("every screen below the navigation has a way back (UX: no dead ends)", () => {
  /** Where each screen's Volver link must land: the parent route, never the browser history. */
  const screens = (ids: { spaceId: string; sharedId: string; history: string; edit: string }) => [
    { name: "accounts", at: `/spaces/${ids.spaceId}/accounts`, parent: `/spaces/${ids.spaceId}` },
    {
      name: "new account",
      at: `/spaces/${ids.spaceId}/accounts/new`,
      parent: `/spaces/${ids.spaceId}/accounts`,
    },
    { name: "record form", at: `/spaces/${ids.spaceId}/new`, parent: `/spaces/${ids.spaceId}` },
    { name: "settings", at: "/settings", parent: `/spaces/${ids.spaceId}` },
    {
      name: "settings, from a shared space",
      at: `/settings?from=${ids.sharedId}`,
      parent: `/spaces/${ids.sharedId}`,
    },
    { name: "members", at: `/spaces/${ids.sharedId}/members`, parent: `/spaces/${ids.sharedId}` },
    { name: "balance history", at: ids.history, parent: `/spaces/${ids.sharedId}/balances` },
    { name: "new shared space", at: "/spaces/new", parent: `/spaces/${ids.spaceId}` },
    // Ruling P191: Volver opens the sheet it came from, on the list (the query brings the sheet back).
    { name: "edit a transaction", at: ids.edit, parent: `/spaces/${ids.spaceId}/transactions` },
    {
      name: "new shared space, from a shared space",
      at: `/spaces/new?from=${ids.sharedId}`,
      parent: `/spaces/${ids.sharedId}`,
    },
  ];

  const back = (page: Page) => page.getByRole("link", { name: es.common.back, exact: true });

  test("a Volver link is visible, uncovered and at least 44 px, and it lands on the parent route", async ({
    page,
  }) => {
    const { spaceId, sharedId } = await session(page, "back");
    const history = await historyPath(page, spaceId, sharedId);
    const edit = await editPathOf(page, spaceId);
    for (const screen of screens({ spaceId, sharedId, history, edit })) {
      await page.goto(screen.at);
      await settle(page);
      const link = back(page);
      await expect(link, `${screen.name}: Volver is visible`).toBeVisible();
      const box = await link.boundingBox();
      expect.soft(box!.width, `${screen.name}: width`).toBeGreaterThanOrEqual(TARGET);
      expect.soft(box!.height, `${screen.name}: height`).toBeGreaterThanOrEqual(TARGET);
      const covered = await link.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = window.paintedAt(r.left + r.width / 2, r.top + r.height / 2);
        return top !== null && el.contains(top) ? "ok" : `covered by <${top?.tagName ?? "nothing"}>`;
      });
      expect.soft(covered, `${screen.name}: Volver is the topmost element at its center`).toBe("ok");
      await link.click();
      await page.waitForURL((url) => url.pathname === screen.parent, { timeout: 10_000 });
      expect(new URL(page.url()).pathname, `${screen.name}: the parent route`).toBe(screen.parent);
    }
  });

  test("Volver works on a deep link, with no history to go back to", async ({ page }) => {
    const { sharedId } = await session(page, "deep");
    await page.goto(`/spaces/${sharedId}/members`);
    expect(await page.evaluate(() => window.history.length)).toBeLessThanOrEqual(2);
    await back(page).click();
    await page.waitForURL(`**/spaces/${sharedId}`);
  });

  test("the profile sheet's Ajustes and the space switcher's create link carry the space to return to", async ({
    page,
  }) => {
    const { sharedId } = await session(page, "from");
    await page.goto(`/spaces/${sharedId}`);
    await settle(page);
    await page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click();
    await page.getByRole("link", { name: new RegExp(es.shell.profile.settings) }).click();
    await page.waitForURL("**/settings?from=*");
    await back(page).click();
    await page.waitForURL(`**/spaces/${sharedId}`);
    await page.getByRole("button", { name: es.shell.space.current.replace("{name}", "Casa") }).click();
    await page.getByRole("link", { name: es.shell.space.create }).click();
    await page.waitForURL("**/spaces/new?from=*");
    await back(page).click();
    await page.waitForURL(`**/spaces/${sharedId}`);
  });
});

test.describe("the app's own not-found page (N1)", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`in ${scheme} mode`, () => {
      test.use({ colorScheme: scheme });

      for (const [what, path] of [
        ["an address that matches no page", "/nope"],
        ["a space that does not exist", "/spaces/does-not-exist/accounts"],
      ] as const) {
        test(`${what}: the way out is a full target, the page wears the theme and the way out leads home`, async ({
          page,
        }) => {
          const { spaceId } = await session(page, `notfound-${scheme}-${what.length}`);
          const response = await page.goto(path);
          expect(response?.status()).toBe(404);
          await settle(page);
          await expect(page.getByRole("heading", { level: 1, name: es.notFound.title })).toBeVisible();
          // The theme reached the page, including the one Next renders on the client after a layout's notFound().
          await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
          const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          expect(background).toBe(scheme === "dark" ? "rgb(18, 22, 20)" : "rgb(246, 244, 239)");
          const out = page.getByRole("link", { name: es.common.toStart });
          const box = (await out.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(TARGET);
          expect(box.height).toBeGreaterThanOrEqual(TARGET);
          await out.click();
          await page.waitForURL(new RegExp(`/spaces/${spaceId}$`));
        });
      }
    });
  }
});

test.describe("Settings and New space keep the space they were opened from (N3)", () => {
  test("the header names it, the navigation points to it and Inicio stays in it", async ({ page }) => {
    const { spaceId, sharedId } = await session(page, "shell-from");
    const nav = page.getByRole("navigation", { name: es.shell.nav.main });
    for (const path of [`/settings?from=${sharedId}`, `/spaces/new?from=${sharedId}`]) {
      await page.goto(path);
      await settle(page);
      await expect(
        page.getByRole("button", { name: es.shell.space.current.replace("{name}", "Casa") }),
        path,
      ).toBeVisible();
      await expect(nav.getByRole("link", { name: es.shell.nav.home, exact: true }), path).toHaveAttribute(
        "href",
        `/spaces/${sharedId}`,
      );
      await expect(nav.getByRole("link", { name: es.shell.nav.balances }), `${path}: Saldos`).toBeVisible();
    }
    // A space that is not hers, or none, keeps the personal shell.
    for (const path of ["/settings", "/settings?from=00000000-0000-0000-0000-000000000000"]) {
      await page.goto(path);
      await expect(
        page.getByRole("button", { name: es.shell.space.current.replace("{name}", "Personal") }),
        path,
      ).toBeVisible();
      await expect(nav.getByRole("link", { name: es.shell.nav.home, exact: true }), path).toHaveAttribute(
        "href",
        `/spaces/${spaceId}`,
      );
    }
  });
});

test.describe("the members entry of a shared space is findable (N10)", () => {
  test("the home and Saldos lead to the members with full targets", async ({ page }) => {
    const { sharedId } = await session(page, "members-entry");
    for (const [path, names] of [
      [`/spaces/${sharedId}`, [es.home.members, es.home.invite]],
      [`/spaces/${sharedId}/balances`, [es.home.members]],
    ] as const) {
      await page.goto(path);
      await settle(page);
      for (const name of names) {
        const link = page.getByRole("link", { name, exact: true });
        await expect(link, `${path}: ${name}`).toBeVisible();
        const box = (await link.boundingBox())!;
        expect.soft(box.height, `${path}: height of ${name}`).toBeGreaterThanOrEqual(TARGET);
        expect.soft(box.x + box.width, `${path}: ${name} stays on screen`).toBeLessThanOrEqual(PHONE.width);
      }
      await page.getByRole("link", { name: es.home.members, exact: true }).click();
      await page.waitForURL(`**/spaces/${sharedId}/members`);
    }
  });
});

test.describe("query-only changes replace the entry (N8)", () => {
  test("dismissing the saved notice leaves the history as long as it was", async ({ page }) => {
    const { sharedId } = await session(page, "notice-replace");
    const warned = await warnedList(page, sharedId);
    await page.goto(warned);
    await settle(page);
    const before = await page.evaluate(() => window.history.length);
    await page.getByRole("link", { name: es.ledger.saved.dismiss }).click();
    await page.waitForURL(`**/spaces/${sharedId}/transactions`);
    expect(await page.evaluate(() => window.history.length)).toBe(before);
    await expect(page.locator("main").getByRole("status")).toHaveCount(0);
  });
});

test.describe("Movimientos names a shared or direct space (U7)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`the direct space that a split created is named under the title at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId } = await session(page, `direct-title-${viewport.width}`);
      const space = `/api/v1/spaces/${spaceId}`;
      const { items: groups } = await get(page, `${space}/categories`);
      const categoryKey: string = groups.flatMap(
        (g: { categories: { key: string | null }[] }) => g.categories,
      )[0].key;
      const { items: accounts } = await get(page, `${space}/accounts`);
      const split = await post(
        page,
        "/api/v1/direct-splits",
        {
          description: "Cena",
          date: "2026-10-30",
          occurredAt: "2026-10-30T17:00:00.000Z",
          timeZone: "America/Bogota",
          counterpart: { kind: "GUEST", displayName: GUEST_NAME },
          categoryKey,
          amount: { amount: "12000000", currency: "COP" },
          accountId: bancolombiaIn(accounts),
        },
        { "idempotency-key": crypto.randomUUID() },
      );
      await page.goto(`/spaces/${split.spaceId}/transactions`);
      await settle(page);
      const title = page.getByRole("heading", { level: 1, name: es.ledger.list.title });
      // The name of the space the move landed in sits right under the title.
      await expect(title.locator("xpath=following-sibling::p")).toContainText(`& ${GUEST_NAME}`);
      const { overflow, message } = await overflowReport(page, "Movimientos of a direct space");
      expect(overflow, message).toBeLessThanOrEqual(0);
      // A personal space shows no such line.
      await page.goto(`/spaces/${spaceId}/transactions`);
      await expect(title.locator("xpath=following-sibling::p")).toHaveCount(0);
    });
  }
});

test.describe("the theme Sistema follows the system without a reload (U9)", () => {
  test("changing the colour scheme changes the page; a chosen Claro or Oscuro ignores it", async ({
    page,
  }) => {
    await session(page, "theme-live");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");
    await settle(page);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      "rgb(18, 22, 20)",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-theme", "light");
    // A device that chose Claro keeps it whatever the system does.
    await page.getByRole("radio", { name: es.settings.theme.light }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    await expect(html).toHaveAttribute("data-theme", "light");
    // And back to Sistema: the system's colour applies again, with no reload.
    await page.getByRole("radio", { name: es.settings.theme.system }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("Settings says Guardado and keeps Restablecer where it was (U5)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`saving a number format moves nothing and says so for about two seconds at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await session(page, `settings-saved-${viewport.width}`);
      await page.goto("/settings");
      await settle(page);
      const group = page.getByRole("group", { name: es.settings.field.numberFormat });
      const slot = group.getByTestId("preference-state");
      await expect(slot.getByText(es.settings.default)).toBeVisible();
      // Since Apariencia e idioma comes first (#176), the group sits near the bottom bar: centring it first keeps the
      // click from scrolling the page, so a moved box can only mean the layout moved.
      await group.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const before = {
        slot: (await slot.boundingBox())!,
        choices: (await group.getByRole("radiogroup").boundingBox())!,
        page: await page.evaluate(() => document.documentElement.scrollHeight),
      };
      await group.getByRole("radio", { name: "1,234,567.89" }).click();
      const reset = slot.getByRole("button", { name: es.settings.reset });
      await expect(reset).toBeVisible();
      const status = group.getByRole("status");
      await expect(status).toHaveText(es.common.saved);
      const after = {
        slot: (await slot.boundingBox())!,
        choices: (await group.getByRole("radiogroup").boundingBox())!,
        page: await page.evaluate(() => document.documentElement.scrollHeight),
      };
      // Nothing moves: not the slot, not the choices under it, not the page.
      expect(after.slot).toEqual(before.slot);
      expect(after.choices).toEqual(before.choices);
      expect(after.page).toBe(before.page);
      // Restablecer is a full target, inside the slot, and the status does not cover it.
      const box = (await reset.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(TARGET);
      const statusBox = (await status.boundingBox())!;
      expect(statusBox.x + statusBox.width, "Guardado stays on the screen").toBeLessThanOrEqual(
        viewport.width,
      );
      expect(statusBox.y + statusBox.height <= box.y || statusBox.x + statusBox.width <= box.x).toBe(true);
      await expect(status).toHaveCount(0, { timeout: 5000 });
      const { overflow, message } = await overflowReport(page, "Settings after saving");
      expect(overflow, message).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("the empty states of Cuentas and of a shared space explain themselves (U1, U4)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`no accounts, no funds: an action to start with, full targets and no sideways scroll at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const spaceId = await signUp(
        page,
        `empty-states-${viewport.width}`,
        `10.252.${randomInt(256)}.${randomInt(1, 255)}`,
      );
      const shared = (await post(page, "/api/v1/spaces", {
        kind: "SHARED",
        name: "Casa",
        currency: "COP",
      })) as {
        id: string;
      };
      const full = async (name: string, path: string) => {
        await page.goto(path);
        await settle(page);
        const link = page.getByRole("link", { name, exact: true });
        await expect(link, `${path}: ${name}`).toHaveCount(1);
        const box = (await link.boundingBox())!;
        expect.soft(box.height, `${path}: height of ${name}`).toBeGreaterThanOrEqual(TARGET);
        expect
          .soft(box.x + box.width, `${path}: ${name} stays on screen`)
          .toBeLessThanOrEqual(viewport.width);
        const { overflow, message } = await overflowReport(page, path);
        expect.soft(overflow, message).toBeLessThanOrEqual(0);
        return link;
      };
      // A personal space with no active account (its starter accounts archived, issue 169): one Nueva cuenta and
      // "Crear cuentas base", in the empty state, both full targets on screen.
      await archiveStarterAccounts(page, spaceId);
      const add = await full(es.accounts.new, `/spaces/${spaceId}/accounts`);
      await expect(page.getByRole("heading", { name: es.accounts.empty.noActiveTitle })).toBeVisible();
      const starter = (await page.getByRole("button", { name: es.accounts.empty.starter }).boundingBox())!;
      expect.soft(starter.height, "height of Crear cuentas base").toBeGreaterThanOrEqual(TARGET);
      expect
        .soft(starter.x + starter.width, "Crear cuentas base stays on screen")
        .toBeLessThanOrEqual(viewport.width);
      await add.click();
      await page.waitForURL(`**/spaces/${spaceId}/accounts/new?returnTo=*`);
      // A shared space with no funds: never "Agrega tu primera cuenta", the explanation and a fund to create.
      await full(es.accounts.createFund, `/spaces/${shared.id}/accounts`);
      await expect(page.getByText(es.accounts.fundsNote)).toBeVisible();
      await full(es.accounts.createFund, `/spaces/${shared.id}`);
      await expect(page.getByText(es.accounts.fundsNote)).toBeVisible();
      await expect(page.getByText(es.home.firstAccount.title)).toHaveCount(0);
    });
  }
});

test.describe("the save toast sits above the bottom navigation and never covers it (P195)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`after saving an income at ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { spaceId } = await session(page, `toast-${viewport.width}`);
      await saveIncomeFromForm(page, spaceId);
      const toast = page.getByTestId("toast");
      await expect(page.getByRole("region", { name: es.toast.region }).getByRole("status")).toContainText(
        es.ledger.toast.saved.INCOME,
      );
      // Hovering holds the toast on screen (WCAG 2.2.1) while it is measured; it ends above the navigation.
      await toast.hover();
      const nav = (await page.locator("nav[aria-label]").boundingBox())!;
      const box = (await toast.boundingBox())!;
      expect(box.y + box.height, "the toast ends above the navigation").toBeLessThanOrEqual(nav.y);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "the toast stays inside the width").toBeLessThanOrEqual(viewport.width);
      const record = (await page.getByRole("link", { name: es.shell.nav.record }).boundingBox())!;
      expect(record.y, "Registrar is under the toast's bottom edge, not covered").toBeGreaterThanOrEqual(
        box.y + box.height,
      );
      const close = (await page.getByRole("button", { name: es.toast.dismiss }).boundingBox())!;
      expect(close.width).toBeGreaterThanOrEqual(TARGET);
      expect(close.height).toBeGreaterThanOrEqual(TARGET);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // A tap on the toast's close button reaches it and removes the toast.
      await page.getByRole("button", { name: es.toast.dismiss }).click();
      await expect(toast).toHaveCount(0);
    });
  }
});

test.describe("the toast after a delete never hides or crowds the navigation (P195, P198)", () => {
  /** True when the element is the topmost one at its own centre: nothing paints over it. */
  const topmostAtCentre = (control: Locator) =>
    control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = window.paintedAt(r.left + r.width / 2, r.top + r.height / 2);
      return top !== null && el.contains(top) ? "ok" : `covered by <${top?.tagName ?? "nothing"}>`;
    });

  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`Deshacer and the close button are full targets, uncovered, and Registrar stays free at ${viewport.width} px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId } = await session(page, `toast-delete-${viewport.width}`);
      await page.goto(`/spaces/${spaceId}/transactions`);
      await settle(page);
      await page.getByRole("link", { name: MARKET }).click();
      await page.getByRole("button", { name: es.ledger.detail.delete }).click();
      const toast = page.getByTestId("toast");
      await expect(toast).toBeVisible();
      // Hovering holds the toast on screen (WCAG 2.2.1) while it is measured.
      await toast.hover();
      const box = (await toast.boundingBox())!;
      const nav = (await page.locator("nav[aria-label]").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
      for (const name of [es.ledger.toast.undo, es.toast.dismiss]) {
        const control = toast.getByRole("button", { name });
        const target = (await control.boundingBox())!;
        expect.soft(target.width, `${name}: width`).toBeGreaterThanOrEqual(TARGET);
        expect.soft(target.height, `${name}: height`).toBeGreaterThanOrEqual(TARGET);
        expect.soft(await topmostAtCentre(control), `${name}: the topmost element at its centre`).toBe("ok");
      }
      const record = page.getByRole("navigation", { name: es.shell.nav.main }).getByRole("link", {
        name: es.shell.nav.record,
      });
      const fab = (await record.boundingBox())!;
      expect(fab.y, "Registrar is under the toast's bottom edge, not covered").toBeGreaterThanOrEqual(
        box.y + box.height,
      );
      expect(await topmostAtCentre(record), "Registrar is the topmost element at its centre").toBe("ok");
      const { overflow, message } = await overflowReport(page, "the toast");
      expect(overflow, message).toBeLessThanOrEqual(0);
    });

    test(`a long message in English wraps inside the width instead of widening the page at ${viewport.width} px`, async ({
      page,
      errors,
    }) => {
      await page.setViewportSize(viewport);
      const { spaceId } = await session(page, `toast-long-${viewport.width}`);
      await patch(page, "/api/v1/me", { locale: "en" });
      // The undo is refused with the longest English message the catalog has: the failure toast carries it.
      await page.route("**/restore", (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "urn:hearth:problem:InvalidRecurrence",
            title: "",
            status: 422,
            code: "InvalidRecurrence",
          }),
        }),
      );
      await page.goto(`/spaces/${spaceId}/transactions`);
      await settle(page);
      await page.getByRole("link", { name: MARKET }).click();
      await page.getByRole("button", { name: en.ledger.detail.delete }).click();
      const region = page.getByRole("region", { name: en.toast.region });
      await expect(region.getByRole("status")).toContainText(en.ledger.toast.deleted.EXPENSE);
      await region.getByRole("button", { name: en.ledger.toast.undo }).click();
      const alert = region.getByRole("alert");
      await expect(alert).toContainText(en.errors.InvalidRecurrence);
      // The browser logs the refusal it was handed on purpose; any other console error still fails the test.
      errors.splice(0, errors.length, ...errors.filter((e) => !/status of 422 .*\/restore$/.test(e)));
      const toast = page.locator("[data-toast='alert']").getByTestId("toast");
      await toast.hover();
      const box = (await toast.boundingBox())!;
      const nav = (await page.locator("nav[aria-label]").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "the long message stays inside the width").toBeLessThanOrEqual(
        viewport.width,
      );
      expect(box.y + box.height, "the long message ends above the navigation").toBeLessThanOrEqual(nav.y);
      // The text itself, not its boxes: it must wrap onto several lines and end inside the screen's width.
      const text = await alert.locator("p").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return {
          lines: new Set(rects.map((r) => Math.round(r.top))).size,
          right: Math.max(...rects.map((r) => r.right)),
          spills: el.scrollWidth > el.clientWidth,
        };
      });
      expect(text.lines, "the message wraps onto more than one line").toBeGreaterThan(1);
      expect(text.right, "the text ends inside the width").toBeLessThanOrEqual(viewport.width);
      expect(text.spills, "the text does not spill out of its paragraph").toBe(false);
      const { overflow, message } = await overflowReport(page, "the long toast");
      expect(overflow, message).toBeLessThanOrEqual(0);
    });
  }
});
