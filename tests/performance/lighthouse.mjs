import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

// The mjs lint block declares only process, console, Buffer and URL as globals.
const { fetch } = globalThis;
const BASE = "http://127.0.0.1:3100";
const RUNS = 3;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Ruling P134: every route and metric over its budget; a route without a budget fails rather than passes. */
export const budgetFailures = (results, budgets) =>
  results.flatMap(({ route, lcp, cls, tbt, scriptKb }) => {
    const limit = budgets.scriptKb[route];
    if (limit === undefined) return [`${route}: no script budget in tests/performance/budgets.json`];
    const { lcpMs, cls: maxCls, tbtMs } = budgets.metrics;
    return [
      lcp > lcpMs && `${route}: LCP ${lcp} ms > ${lcpMs} ms`,
      cls > maxCls && `${route}: CLS ${cls} > ${maxCls}`,
      tbt > tbtMs && `${route}: TBT ${tbt} ms > ${tbtMs} ms`,
      scriptKb > limit && `${route}: script ${scriptKb} KiB > ${limit} KiB`,
    ].filter(Boolean);
  });

/** The medians of one route over RUNS Lighthouse runs (mobile defaults: simulated slow 4G, 4× CPU). */
const measure = async (port, url, cookie) => {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const { lhr } = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      extraHeaders: cookie ? { cookie } : {},
    });
    // Fail closed: a missing audit must never read as "0 KiB of script" or "no LCP problem".
    const requests = lhr.audits["network-requests"]?.details?.items;
    if (!Array.isArray(requests)) throw new Error(`Lighthouse returned no network-requests audit for ${url}`);
    if (!lhr.audits["largest-contentful-paint"]?.numericValue)
      throw new Error(`Lighthouse measured no LCP for ${url}`);
    const scripts = requests.filter((r) => r.resourceType === "Script");
    runs.push({
      lcp: Math.round(lhr.audits["largest-contentful-paint"].numericValue),
      cls: Number((lhr.audits["cumulative-layout-shift"].numericValue ?? 0).toFixed(3)),
      tbt: Math.round(lhr.audits["total-blocking-time"].numericValue ?? 0),
      scriptKb: Math.round(scripts.reduce((sum, r) => sum + (r.transferSize ?? 0), 0) / 1024),
    });
  }
  return Object.fromEntries(["lcp", "cls", "tbt", "scriptKb"].map((k) => [k, median(runs.map((r) => r[k]))]));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const budgets = JSON.parse(readFileSync("tests/performance/budgets.json", "utf8"));
  const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], { stdio: "inherit" });
  const failures = [];
  try {
    for (let deadline = Date.now() + 180_000; ; await sleep(1000)) {
      if (
        await fetch(`${BASE}/api/v1/health`).then(
          (r) => r.ok,
          () => false,
        )
      )
        break;
      if (Date.now() > deadline) throw new Error("The server did not start within 180 s");
    }
    // A person with data, so the screens render what a household sees (an account, a category, a few expenses).
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.250.0.1" };
    const signUp = await fetch(`${BASE}/api/v1/auth/sign-up`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Perf",
        email: `perf-${Date.now()}@example.com`,
        password: "123456789012",
        timezone: "America/Bogota",
      }),
    });
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const api = async (method, path, body) => {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: { ...headers, cookie, "idempotency-key": randomUUID() },
        body: body && JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
      return response.json();
    };
    const {
      items: [space],
    } = await api("GET", "/api/v1/spaces");
    const account = await api("POST", `/api/v1/spaces/${space.id}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: { amount: "200000000", currency: "COP" },
    });
    const { items: groups } = await api("GET", `/api/v1/spaces/${space.id}/categories`);
    const categoryId = groups.flatMap((g) => g.categories)[0].id;
    for (let i = 0; i < 20; i += 1)
      await api("POST", `/api/v1/spaces/${space.id}/expenses`, {
        description: `Item ${i}`,
        date: "2026-10-31",
        occurredAt: new Date(Date.UTC(2026, 9, 31, 13, i)).toISOString(),
        timeZone: "America/Bogota",
        categoryId,
        amount: { amount: "1500000", currency: "COP" },
        accountId: account.id,
      });
    const browser = await chromium.launch({ args: ["--remote-debugging-port=9223"] });
    try {
      const routes = Object.keys(budgets.scriptKb);
      const results = [];
      for (const route of routes) {
        const url = `${BASE}${route.replace(":id", space.id)}`;
        const result = { route, ...(await measure(9223, url, route.startsWith("/sign") ? null : cookie)) };
        console.log(JSON.stringify(result));
        results.push(result);
      }
      failures.push(...budgetFailures(results, budgets));
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
  }
  for (const failure of failures) console.error(failure);
  process.exit(failures.length > 0 ? 1 : 0);
}
