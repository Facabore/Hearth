import { randomInt } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { get, patch, post, seedLedger, signUp } from "./support/seed";

/**
 * Phone-width layout guards (UI Definition of Done, WCAG 1.4.10 Reflow, 2.4.11 Focus Not Obscured, 2.5.5 Target Size):
 * measured in a real browser against the standalone build, at the 390 x 844 phone of the audit and at 320 px.
 */
const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 320, height: 640 };
const TARGET = 44;

const UNBUILT_ROUTES = [/\/spaces\/[^/]+\/balances\?_rsc=/];

/** Every test fails on a `console.error` or an uncaught page error: nothing may log one on a normal visit. */
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const where = message.location().url;
        // Task 17 builds the Saldos screen: until then the shared spaces' tab prefetches a route that answers 404.
        if (UNBUILT_ROUTES.some((route) => route.test(where))) return;
        errors.push(`${message.text()} @ ${where}`);
      });
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
      await use(errors);
      expect(errors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});
test.use({ viewport: PHONE });

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

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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

/** The last control a person can act on in the open sheet, scrolled to the end of its own scroll area. */
const lastControlIsOnTop = (page: Page) =>
  page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>("[role='dialog']");
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

const sheets: { name: string; open: (page: Page, spaceId: string) => Promise<void>; path?: string }[] = [
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
    name: "transaction filters",
    path: "transactions",
    open: (page) => page.getByRole("button", { name: es.ledger.list.filterCategory }).click(),
  },
  {
    name: "time zone sheet",
    path: "settings",
    open: (page) => page.getByRole("button", { name: new RegExp(es.settings.field.timezone) }).click(),
  },
];

test.describe("no screen scrolls sideways (WCAG 1.4.10 Reflow)", () => {
  for (const viewport of [PHONE, SMALL_PHONE]) {
    test(`every screen at ${viewport.width} px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const check = async (path: string) => {
        await page.goto(path);
        await settle(page);
        expect
          .soft(await horizontalOverflow(page), `${path} overflows by this many px`)
          .toBeLessThanOrEqual(0);
      };
      for (const path of ["/sign-in?expired=1", "/sign-up", "/sign-in"]) await check(path);

      const { spaceId, sharedId } = await session(page, `reflow-${viewport.width}`);
      for (const path of [
        `/spaces/${spaceId}`,
        `/spaces/${spaceId}/transactions`,
        `/spaces/${spaceId}/accounts`,
        `/spaces/${spaceId}/accounts/new`,
        `/spaces/${spaceId}/new`,
        `/spaces/${sharedId}`,
        `/spaces/${sharedId}/members`,
        "/spaces/new",
        "/settings",
      ])
        await check(path);
    });
  }

  test("the home of a space still reflows at 320 px with an empty and a full ledger", async ({ page }) => {
    await page.setViewportSize(SMALL_PHONE);
    const { spaceId } = await session(page, "home-320");
    await page.goto(`/spaces/${spaceId}`);
    await settle(page);
    await expect(page.getByRole("heading", { name: es.home.recent })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("each open sheet leaves the page as wide as the phone", async ({ page }) => {
    const { spaceId } = await session(page, "sheet-width");
    for (const sheet of sheets) {
      await page.goto(
        sheet.path === "settings" ? "/settings" : `/spaces/${spaceId}${sheet.path ? `/${sheet.path}` : ""}`,
      );
      await sheet.open(page, spaceId);
      await expect(page.getByRole("dialog")).toBeVisible();
      expect.soft(await horizontalOverflow(page), `${sheet.name} overflows`).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
    }
  });
});

test.describe("bottom sheets sit above the bottom navigation", () => {
  test("the last control of every sheet is the topmost element at its center", async ({ page }) => {
    const { spaceId } = await session(page, "sheets");
    for (const sheet of sheets) {
      await page.goto(
        sheet.path === "settings" ? "/settings" : `/spaces/${spaceId}${sheet.path ? `/${sheet.path}` : ""}`,
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
