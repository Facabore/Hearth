import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";
import budgets from "../../performance/budgets.json" with { type: "json" };
import { seedPlanRoutes } from "../../performance/seed-plan.mjs";
import { BASE_URL } from "../support/base-url";

const WEB_VITALS = createRequire(import.meta.url).resolve("web-vitals"); // dist/web-vitals.umd.cjs: window.webVitals

/** `seedPlanRoutes`' request helper over a Playwright request context: a non-2xx answer fails the test. */
const apiOf =
  (request: APIRequestContext) => async (method: string, path: string, body?: unknown, ifMatch?: number) => {
    const response = await request.fetch(path, {
      method,
      headers: {
        "idempotency-key": crypto.randomUUID(),
        ...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }),
      },
      data: body,
    });
    if (!response.ok())
      throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    return response.json();
  };

test("INP stays within budget over the drill-down and the allocation editor on a 4× slower CPU (ruling P221)", async ({
  page,
  playwright,
}) => {
  test.setTimeout(180_000);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": "10.251.0.4" });
  await page.request.post("/api/v1/auth/sign-up", {
    data: {
      name: "Inp",
      email: `inp-plan-${Date.now()}@example.com`,
      password: "123456789012",
      timezone: "America/Bogota",
    },
  });
  const api = apiOf(page.request);
  const {
    items: [personal],
  } = await api("GET", "/api/v1/spaces");
  const bank = await api("POST", `/api/v1/spaces/${personal.id}/accounts`, {
    name: "Bancolombia",
    type: "BANK",
    openingBalance: { amount: "200000000", currency: "COP" },
  });
  // The perf household: the person and Juan, who joins through a link, so the allocation editor has two values.
  const shared = await api("POST", "/api/v1/spaces", { kind: "SHARED", name: "Household", currency: "COP" });
  const { url } = await api("POST", `/api/v1/spaces/${shared.id}/invitations`, {
    kind: "LINK",
    role: "MEMBER",
  });
  const juan = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": "10.251.0.5" },
  });
  await juan.post("/api/v1/auth/sign-up", {
    data: {
      name: "Juan",
      email: `inp-plan-juan-${Date.now()}@example.com`,
      password: "123456789012",
      timezone: "America/Bogota",
    },
  });
  await juan.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`);
  await juan.dispose();
  const { plan, line } = await seedPlanRoutes(api, {
    personal: personal.id,
    shared: shared.id,
    bank: bank.id,
  });

  await page.addInitScript({ path: WEB_VITALS });
  await page.addInitScript(() => {
    (window as unknown as { __inp: number }).__inp = 0;
    addEventListener("load", () =>
      (
        window as unknown as { webVitals: { onINP: (cb: (m: { value: number }) => void, o: object) => void } }
      ).webVitals.onINP(
        (metric) => {
          (window as unknown as { __inp: number }).__inp = metric.value;
        },
        { reportAllChanges: true, durationThreshold: 16 },
      ),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // web-vitals reports an interaction once the main thread is idle, so the value is read when it has arrived.
  const inpOf = async () => {
    const read = () => page.evaluate(() => (window as unknown as { __inp: number }).__inp);
    await expect.poll(read, { timeout: 5_000 }).toBeGreaterThan(0);
    return read();
  };

  // The drill-down (ruling P215): a group, its first category, then back to every group.
  await page.goto(`/spaces/${shared.id}/plan/groups`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("list", { name: "Grupos" }).getByRole("button").first().click();
  await page
    .getByRole("list", { name: /^Categorías de / })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByRole("list", { name: /^Subcategorías de / })).toBeVisible();
  await page.getByRole("navigation", { name: "Ruta" }).getByRole("button").first().click();
  await expect(page.getByRole("list", { name: "Grupos" })).toBeVisible();
  const drill = await inpOf();
  console.log(`INP of the drill-down ${drill} ms (budget ${budgets.metrics.inpMs} ms)`);

  // The allocation editor (ruling P211): Home by percentage, 42 % and 58 %.
  await page.goto(`/spaces/${shared.id}/plans/${plan}/lines/${line}`);
  await page.waitForLoadState("networkidle");
  // U5 (#224): the allocation sits folded under "Más opciones".
  await page.getByRole("button", { name: "Más opciones", exact: true }).click();
  await page.getByRole("radio", { name: "Porcentaje" }).click();
  await page.getByLabel("Valor de Inp").pressSequentially("42");
  await page.getByLabel("Valor de Juan").pressSequentially("58");
  // 42 % of Home's 1,470,000 COP: the preview has taken both values.
  await expect(page.getByText(/617\.400/)).toBeVisible();
  const allocation = await inpOf();
  console.log(`INP of the allocation editor ${allocation} ms (budget ${budgets.metrics.inpMs} ms)`);

  for (const inp of [drill, allocation]) {
    expect(inp).toBeGreaterThan(0);
    expect(inp).toBeLessThanOrEqual(budgets.metrics.inpMs);
  }
});
