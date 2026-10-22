import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import budgets from "../../performance/budgets.json" with { type: "json" };
import { BASE_URL } from "../support/base-url";

const WEB_VITALS = createRequire(import.meta.url).resolve("web-vitals"); // dist/web-vitals.umd.cjs: window.webVitals

test("INP stays within budget while editing a split on a 4× slower CPU (rulings P134, P177)", async ({
  page,
  playwright,
}) => {
  const headers = { "x-forwarded-for": "10.251.0.2" };
  await page.request.post("/api/v1/auth/sign-up", {
    headers,
    data: {
      name: "Inp",
      email: `inp-split-${Date.now()}@example.com`,
      password: "123456789012",
      timezone: "America/Bogota",
    },
  });
  const { items } = await (await page.request.get("/api/v1/spaces")).json();
  const personal = items[0];
  await page.request.post(`/api/v1/spaces/${personal.id}/accounts`, {
    data: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
  });
  const shared = await (
    await page.request.post("/api/v1/spaces", {
      data: { kind: "SHARED", name: "Household", currency: "COP" },
    })
  ).json();
  const { url } = await (
    await page.request.post(`/api/v1/spaces/${shared.id}/invitations`, {
      data: { kind: "LINK", role: "MEMBER" },
    })
  ).json();
  const other = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { "x-forwarded-for": "10.251.0.3" },
  });
  await other.post("/api/v1/auth/sign-up", {
    data: {
      name: "Juan",
      email: `inp-juan-${Date.now()}@example.com`,
      password: "123456789012",
      timezone: "America/Bogota",
    },
  });
  await other.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`);
  await other.dispose();
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
  await page.goto(`/spaces/${shared.id}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  for (const digit of ["3", "0", "0", "0", "0", "0"])
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: /Categoría/ }).click();
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: /División/ }).click();
  await page.getByRole("radio", { name: "Porcentaje" }).click();
  await page.getByLabel(/^Valor de Inp/).pressSequentially("40");
  await page.getByLabel(/^Valor de Juan/).pressSequentially("60");
  const inp = await page.evaluate(() => (window as unknown as { __inp: number }).__inp);
  console.log(`INP of the split editor ${inp} ms (budget ${budgets.metrics.inpMs} ms)`);
  expect(inp).toBeGreaterThan(0);
  expect(inp).toBeLessThanOrEqual(budgets.metrics.inpMs);
});
