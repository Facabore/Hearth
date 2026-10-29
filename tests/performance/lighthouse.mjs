import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { chromium, request } from "@playwright/test";
import lighthouse from "lighthouse";
import { seedPlanRoutes } from "./seed-plan.mjs";

// The mjs lint block declares only process, console, Buffer and URL as globals.
const { fetch } = globalThis;
const E2E_PORT = process.env.E2E_PORT ?? "3100";
const API = `http://127.0.0.1:${E2E_PORT}`;
/**
 * ADR 0004 (amended 2026-10-28): the front a person opens, as production serves it: the SPA's build from Caddy over
 * HTTPS and HTTP/2, /api/* to the server above (`Caddyfile.perf`). 8443 for the default server port, shifted with it.
 */
const FRONT_PORT = String(8443 + (Number(E2E_PORT) - 3100));
const BASE = `https://localhost:${FRONT_PORT}`;
const RUNS = 5;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * ADR 0004 (amended 2026-10-28): a visitor's screen (sign-in, sign-up, an invitation or a claim) reads no session data
 * before it paints, so it keeps a tighter LCP limit than a signed-in one.
 */
export const lcpLimitFor = (route, metrics) =>
  isVisitorRoute(route) ? (metrics.visitorLcpMs ?? metrics.lcpMs) : metrics.lcpMs;

/** Ruling P134: every route and metric over its budget; a route without a budget fails rather than passes. */
export const budgetFailures = (results, budgets) =>
  results.flatMap(({ route, lcp, cls, tbt, scriptKb }) => {
    const limit = budgets.scriptKb[route];
    if (limit === undefined) return [`${route}: no script budget in tests/performance/budgets.json`];
    const { cls: maxCls, tbtMs } = budgets.metrics;
    const lcpMs = lcpLimitFor(route, budgets.metrics);
    return [
      lcp > lcpMs && `${route}: LCP ${lcp} ms > ${lcpMs} ms`,
      cls > maxCls && `${route}: CLS ${cls} > ${maxCls}`,
      tbt > tbtMs && `${route}: TBT ${tbt} ms > ${tbtMs} ms`,
      scriptKb > limit && `${route}: script ${scriptKb} KiB > ${limit} KiB`,
    ].filter(Boolean);
  });

/** Ruling P177: the path a budget's route measures, its `:name` segments filled from the seeded ids. */
export const routeUrl = (route, ids) =>
  route.replace(/:(\w+)/g, (_, name) => {
    if (!(name in ids)) throw new Error(`No id for :${name} in ${route}`);
    return ids[name];
  });

/** The pages a visitor opens: measured without the session cookie. */
export const isVisitorRoute = (route) => /^\/(sign-in|sign-up|invitations|claims)(\/|$)/.test(route);

/**
 * `docker run` for the measured front (`Caddyfile.perf`). On Linux (CI) Caddy shares the host's network and reaches the
 * server on 127.0.0.1; Docker Desktop publishes the port and reaches the host as host.docker.internal.
 */
export const frontContainer = ({ platform, cwd, frontPort, api, name }) => [
  "run",
  "--rm",
  "--detach",
  "--name",
  name,
  ...(platform === "linux" ? ["--network", "host"] : ["-p", `${frontPort}:${frontPort}`]),
  "-e",
  `HEARTH_FRONT_PORT=${frontPort}`,
  "-e",
  `HEARTH_API=${platform === "linux" ? "127.0.0.1" : "host.docker.internal"}:${api}`,
  "-v",
  `${cwd}/tests/performance/Caddyfile.perf:/etc/caddy/Caddyfile:ro`,
  "-v",
  `${cwd}/dist/spa:/srv/app:ro`,
  "caddy:2.11.7-alpine",
];

/** The Chromium debug port of a run: 9223 for the default server port, shifted with it so parallel runs never meet. */
export const debugPortFor = (e2ePort) => 9223 + (Number(e2ePort ?? 3100) - 3100);

/** Lighthouse 13.5.0 with its mobile defaults: slow 4G and a 4× slower CPU, simulated (ADR 0004). */
export const lighthouseFlags = (port, cookie) => ({
  port,
  output: "json",
  logLevel: "error",
  onlyCategories: ["performance"],
  extraHeaders: cookie ? { cookie } : {},
});

/**
 * ADR 0005 (amends ADR 0004): LCP is timed with the same slow 4G and 4× slower CPU applied to the load itself. The
 * simulation re-times an unthrottled load, where the stylesheet and the framework chunks arrive together, so whether
 * those chunks counted toward LCP was a race that swung the same page between 1.8 and 2.5 s.
 */
export const lcpFlags = (port, cookie) => ({
  ...lighthouseFlags(port, cookie),
  throttlingMethod: "devtools",
});

/** One Lighthouse run of `url`, failing closed: a missing audit must never read as "0 KiB of script" or "no LCP". */
const run = async (url, flags) => {
  const { lhr } = await lighthouse(url, flags);
  const requests = lhr.audits["network-requests"]?.details?.items;
  if (!Array.isArray(requests)) throw new Error(`Lighthouse returned no network-requests audit for ${url}`);
  if (!lhr.audits["largest-contentful-paint"]?.numericValue)
    throw new Error(`Lighthouse measured no LCP for ${url}`);
  return { lhr, requests };
};

/**
 * ADR 0005: one applied run per route, since it varies by about ±50 ms and takes about 20 s on CI. A run over the
 * budget is confirmed by two more and the median of the three counts, so one stall of the runner never fails the gate.
 */
export const appliedLcp = async (sample, limitMs) => {
  const first = await sample();
  if (first.lcp <= limitMs) return first;
  const samples = [first, await sample(), await sample()];
  return [...samples].sort((a, b) => a.lcp - b.lcp)[1];
};

/** One route: the medians of RUNS simulated runs for CLS, TBT and script, and the applied LCP (ADR 0005). */
const measure = async (port, url, cookie, lcpMs) => {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const { lhr, requests } = await run(url, lighthouseFlags(port, cookie));
    const scripts = requests.filter((r) => r.resourceType === "Script");
    runs.push({
      // Issue #182: the simulated LCP, printed for diagnosis and never budgeted (ADR 0005).
      simulatedLcp: Math.round(lhr.audits["largest-contentful-paint"].numericValue),
      cls: Number((lhr.audits["cumulative-layout-shift"].numericValue ?? 0).toFixed(3)),
      tbt: Math.round(lhr.audits["total-blocking-time"].numericValue ?? 0),
      scriptKb: Math.round(scripts.reduce((sum, r) => sum + (r.transferSize ?? 0), 0) / 1024),
      // Issue #182: the server's share of LCP and the document's size (its inline RSC payload grows it, and every
      // extra round trip of slow 4G adds about 150 ms simulated), printed for diagnosis and never budgeted.
      ttfb: Math.round(lhr.audits["server-response-time"]?.numericValue ?? 0),
      htmlKb: Math.round(
        requests
          .filter((r) => r.resourceType === "Document")
          .reduce((sum, r) => sum + (r.transferSize ?? 0), 0) / 1024,
      ),
    });
  }
  const applied = await appliedLcp(async () => {
    const { lhr } = await run(url, lcpFlags(port, cookie));
    // Issue #182: which element is the LCP, for diagnosis only.
    const node = lhr.audits["lcp-breakdown-insight"]?.details?.items?.find((item) => item.type === "node");
    return {
      lcp: Math.round(lhr.audits["largest-contentful-paint"].numericValue),
      lcpElement: node?.nodeLabel ?? node?.snippet ?? null,
    };
  }, lcpMs);
  return {
    ...Object.fromEntries(
      ["cls", "tbt", "scriptKb", "simulatedLcp", "ttfb", "htmlKb"].map((k) => [
        k,
        median(runs.map((r) => r[k])),
      ]),
    ),
    ...applied,
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const budgets = JSON.parse(readFileSync("tests/performance/budgets.json", "utf8"));
  const server = spawn(process.execPath, ["scripts/e2e-server.mjs"], { stdio: "inherit" });
  // The SPA's build (`pnpm spa:build`) behind Caddy, as production serves it.
  const front = `hearth-perf-front-${E2E_PORT}`;
  const docker = (args) => spawnSync("docker", args, { encoding: "utf8" });
  const failures = [];
  const probe = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const up = (url) =>
      probe.get(url).then(
        (r) => r.ok(),
        () => false,
      );
    for (let deadline = Date.now() + 180_000; !(await up(`${API}/api/v1/health`)); await sleep(1000))
      if (Date.now() > deadline) throw new Error("The server did not start within 180 s");
    docker(["rm", "--force", front]);
    const started = docker(
      frontContainer({
        platform: process.platform,
        cwd: process.cwd().replaceAll("\\", "/"),
        frontPort: FRONT_PORT,
        api: E2E_PORT,
        name: front,
      }),
    );
    if (started.status !== 0)
      throw new Error(`The front did not start: ${started.error?.message ?? started.stderr}`);
    // Both halves of the front: the API behind it, and the SPA's build (an empty dist/spa would serve nothing).
    const serves = async () =>
      (await up(`${BASE}/api/v1/health`)) &&
      (await probe.get(`${BASE}/`).then(
        async (r) => r.ok() && (await r.text()).includes('id="root"'),
        () => false,
      ));
    for (let deadline = Date.now() + 60_000; !(await serves()); await sleep(1000))
      if (Date.now() > deadline)
        throw new Error("The front did not serve the API and the SPA's build over HTTPS within 60 s");
    // A person with data, so the screens render what a household sees (an account, a category, a few expenses).
    const headers = { "content-type": "application/json", "x-forwarded-for": "10.250.0.1" };
    const signUp = await fetch(`${API}/api/v1/auth/sign-up`, {
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
    // Plan writes carry `If-Match: "<version>"` of the last answer (ruling P206).
    const call = async (who, method, path, body, ifMatch) => {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: {
          ...who.headers,
          cookie: who.cookie,
          "idempotency-key": randomUUID(),
          ...(ifMatch === undefined ? {} : { "if-match": `"${ifMatch}"` }),
        },
        body: body && JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
      return response.json();
    };
    const api = (method, path, body, ifMatch) => call({ headers, cookie }, method, path, body, ifMatch);
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
    // The first expense's id is the `:tx` of the edit route (ruling P198).
    let tx;
    for (let i = 0; i < 20; i += 1) {
      const recorded = await api("POST", `/api/v1/spaces/${space.id}/expenses`, {
        description: `Item ${i}`,
        date: "2026-10-31",
        occurredAt: new Date(Date.UTC(2026, 9, 31, 13, i)).toISOString(),
        timeZone: "America/Bogota",
        categoryId,
        amount: { amount: "1500000", currency: "COP" },
        accountId: account.id,
      });
      tx ??= recorded.id;
    }
    // Ruling P177: a household with a second member, a guest with a claim link, a pending invitation (the visitor's
    // page) and one shared expense, so the household screens render what a household sees.
    const tokenOf = ({ url }) => new URL(url, BASE).pathname.split("/").at(-1);
    const household = await api("POST", "/api/v1/spaces", {
      kind: "SHARED",
      name: "Household",
      currency: "COP",
    });
    const shared = household.id;
    const second = { headers: { ...headers, "x-forwarded-for": "10.250.0.2" } };
    const secondSignUp = await fetch(`${API}/api/v1/auth/sign-up`, {
      method: "POST",
      headers: second.headers,
      body: JSON.stringify({
        name: "Juan",
        email: `perf-juan-${Date.now()}@example.com`,
        password: "123456789012",
        timezone: "America/Bogota",
      }),
    });
    second.cookie = secondSignUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const joinLink = await api("POST", `/api/v1/spaces/${shared}/invitations`, {
      kind: "LINK",
      role: "MEMBER",
    });
    await call(second, "POST", `/api/v1/invitations/${tokenOf(joinLink)}/accept`, {});
    const guest = await api("POST", `/api/v1/spaces/${shared}/guests`, { displayName: "Pedro" });
    const claim = tokenOf(await api("POST", `/api/v1/spaces/${shared}/guests/${guest.id}/claim-links`));
    const token = tokenOf(
      await api("POST", `/api/v1/spaces/${shared}/invitations`, { kind: "LINK", role: "MEMBER" }),
    );
    const { items: members } = await api("GET", `/api/v1/spaces/${shared}/members`);
    const [ana, juan] = ["Perf", "Juan"].map((name) => members.find((m) => m.displayName === name).id);
    const { items: sharedGroups } = await api("GET", `/api/v1/spaces/${shared}/categories`);
    await api("POST", `/api/v1/spaces/${shared}/expenses`, {
      description: "Mercado",
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId: sharedGroups.flatMap((g) => g.categories)[0].id,
      amount: { amount: "30000000", currency: "COP" },
      payments: [{ memberId: ana, accountId: account.id, amount: { amount: "30000000", currency: "COP" } }],
      split: { method: "EQUAL", participants: [{ memberId: ana }, { memberId: juan }] },
    });
    // Ruling P221: the household's six-plan chain and the personal space's recurrences (`:plan`, `:line`).
    const plan = await seedPlanRoutes(api, { personal: space.id, shared, bank: account.id });
    const ids = { id: space.id, shared, member: juan, token, claim, tx, ...plan };
    const debugPort = debugPortFor(process.env.E2E_PORT);
    // The front's certificate comes from Caddy's own local CA, which this Chrome alone is told to accept.
    const browser = await chromium.launch({
      args: [`--remote-debugging-port=${debugPort}`, "--ignore-certificate-errors"],
    });
    try {
      const routes = Object.keys(budgets.scriptKb);
      const results = [];
      for (const route of routes) {
        const url = `${BASE}${routeUrl(route, ids)}`;
        const result = {
          route,
          ...(await measure(
            debugPort,
            url,
            isVisitorRoute(route) ? null : cookie,
            lcpLimitFor(route, budgets.metrics),
          )),
        };
        console.log(JSON.stringify(result));
        results.push(result);
      }
      failures.push(...budgetFailures(results, budgets));
    } finally {
      await browser.close();
    }
  } finally {
    await probe.dispose();
    docker(["rm", "--force", front]);
    server.kill("SIGTERM");
  }
  for (const failure of failures) console.error(failure);
  process.exit(failures.length > 0 ? 1 : 0);
}
