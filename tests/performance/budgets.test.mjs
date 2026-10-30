import { describe, expect, it } from "vitest";
import budgets from "./budgets.json" with { type: "json" };
import {
  appliedLcp,
  confirmations,
  pastDeadline,
  budgetFailures,
  debugPortFor,
  frontContainer,
  isVisitorRoute,
  lcpLimitFor,
  lcpFlags,
  lighthouseFlags,
  routeUrl,
} from "./lighthouse.mjs";

describe("performance budgets (ruling P134)", () => {
  it("names every route and metric over its budget, and passes the ones within", () => {
    const results = [
      { route: "/sign-in", lcp: 1800, cls: 0, tbt: 90, scriptKb: 120 },
      { route: "/spaces/:id/new", lcp: 6100, cls: 0.12, tbt: 250, scriptKb: 211 },
    ];
    expect(budgetFailures(results, budgets)).toEqual([
      "/spaces/:id/new: LCP 6100 ms > 5500 ms",
      "/spaces/:id/new: CLS 0.12 > 0.1",
      "/spaces/:id/new: TBT 250 ms > 200 ms",
      "/spaces/:id/new: script 211 KiB > 208 KiB",
    ]);
  });

  it("fails a route with no budget instead of passing it silently", () => {
    expect(budgetFailures([{ route: "/new-route", lcp: 1, cls: 0, tbt: 0, scriptKb: 1 }], budgets)).toEqual([
      "/new-route: no script budget in tests/performance/budgets.json",
    ]);
  });

  it("fills every route of the budgets from the seeded ids, and refuses an id it does not have (ruling P177)", () => {
    const ids = {
      id: "sp-p",
      shared: "sp-h",
      member: "m-j",
      token: "tok",
      claim: "clm",
      tx: "t-1",
      plan: "p-oct",
      line: "l-home",
    };
    for (const route of Object.keys(budgets.scriptKb)) expect(routeUrl(route, ids)).not.toContain(":");
    expect(routeUrl("/spaces/:shared/members/:member/history", ids)).toBe("/spaces/sp-h/members/m-j/history");
    expect(routeUrl("/spaces/:id/transactions/:tx/edit", ids)).toBe("/spaces/sp-p/transactions/t-1/edit");
    expect(routeUrl("/spaces/:id/transactions?tx=:tx", ids)).toBe("/spaces/sp-p/transactions?tx=t-1");
    expect(() => routeUrl("/spaces/:nope", ids)).toThrow("No id for :nope in /spaces/:nope");
  });

  it("budgets the edit route and the list with an open sheet within the caps of ruling P198", () => {
    // The edit form and Registrar raised by the owner on 2026-10-28 for the SPA's cold load (ADR 0004): 210 and 205.
    const caps = {
      "/spaces/:id/transactions?tx=:tx": 235,
      "/spaces/:id/transactions/:tx/edit": 215,
      "/spaces/:id/transactions": 205,
      "/spaces/:id/new": 210,
    };
    for (const [route, cap] of Object.entries(caps)) {
      expect(budgets.scriptKb[route], route).toBeDefined();
      expect(budgets.scriptKb[route], route).toBeLessThanOrEqual(cap);
    }
  });

  it("measures the sign-in, sign-up, invitation and claim pages without a session", () => {
    expect(
      ["/sign-in", "/sign-up", "/invitations/:token", "/claims/:claim", "/spaces/:id", "/spaces/new"].map(
        isVisitorRoute,
      ),
    ).toEqual([true, true, true, true, false, false]);
  });

  it("times LCP under applied throttling and keeps TBT, CLS and script on the simulated runs (ADR 0005)", () => {
    const simulated = {
      port: 9223,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      extraHeaders: { cookie: "session=abc" },
    };
    expect(lighthouseFlags(9223, "session=abc")).toEqual(simulated);
    expect(lcpFlags(9223, "session=abc")).toEqual({ ...simulated, throttlingMethod: "devtools" });
    expect(lighthouseFlags(9223, null).extraHeaders).toEqual({});
    expect(lcpFlags(9223, null).extraHeaders).toEqual({});
  });

  it("takes one applied LCP within the budget, and confirms one over it with two more runs (ADR 0005)", async () => {
    const sampler = (values) => {
      const calls = [];
      const sample = async () => {
        const lcp = values[calls.length];
        calls.push(lcp);
        return { lcp, lcpElement: `run ${calls.length}` };
      };
      return { sample, calls };
    };
    const within = sampler([1400]);
    expect(await appliedLcp(within.sample, 2500)).toEqual({ lcp: 1400, lcpElement: "run 1" });
    expect(within.calls).toEqual([1400]);
    const stall = sampler([3100, 1410, 1390]);
    expect(await appliedLcp(stall.sample, 2500)).toEqual({ lcp: 1410, lcpElement: "run 2" });
    expect(stall.calls).toHaveLength(3);
    const slow = sampler([2600, 2700, 2550]);
    expect(await appliedLcp(slow.sample, 2500)).toEqual({ lcp: 2600, lcpElement: "run 1" });
  });

  it("holds a visitor's screen to its own LCP limit, and a signed-in one to the general one (ADR 0004, 2026-10-28)", () => {
    const metrics = { lcpMs: 4000, visitorLcpMs: 3500, cls: 0.1, tbtMs: 200 };
    expect(lcpLimitFor("/sign-in", metrics)).toBe(3500);
    expect(lcpLimitFor("/invitations/:token", metrics)).toBe(3500);
    expect(lcpLimitFor("/spaces/:id", metrics)).toBe(4000);
    expect(lcpLimitFor("/sign-in", { lcpMs: 2500, cls: 0.1, tbtMs: 200 })).toBe(2500);
    const scriptKb = { "/sign-in": 200, "/spaces/:id": 200 };
    expect(
      budgetFailures(
        [
          { route: "/sign-in", lcp: 3600, cls: 0, tbt: 0, scriptKb: 1 },
          { route: "/spaces/:id", lcp: 3600, cls: 0, tbt: 0, scriptKb: 1 },
        ],
        { metrics, scriptKb },
      ),
    ).toEqual(["/sign-in: LCP 3600 ms > 3500 ms"]);
  });

  it("serves the measured front from Caddy beside the API: the host's network on Linux, a published port elsewhere", () => {
    const common = { cwd: "/repo", frontPort: "8443", api: "3100", name: "hearth-perf-front-3100" };
    const linux = frontContainer({ ...common, platform: "linux" });
    expect(linux).toEqual(expect.arrayContaining(["--network", "host", "HEARTH_API=127.0.0.1:3100"]));
    expect(linux).not.toContain("-p");
    const desktop = frontContainer({ ...common, platform: "win32" });
    expect(desktop).toEqual(
      expect.arrayContaining(["-p", "8443:8443", "HEARTH_API=host.docker.internal:3100"]),
    );
    for (const args of [linux, desktop]) {
      expect(args).toEqual(
        expect.arrayContaining([
          "/repo/tests/performance/Caddyfile.perf:/etc/caddy/Caddyfile:ro",
          "/repo/dist/spa:/srv/app:ro",
          "HEARTH_FRONT_PORT=8443",
          "caddy:2.11.7-alpine",
        ]),
      );
    }
  });

  it("confirms misses for a few routes only, so a slow build fails the job instead of running past its timeout", async () => {
    const budget = confirmations(1);
    const always = (lcp) => {
      const calls = [];
      return { calls, sample: async () => (calls.push(lcp), { lcp, lcpElement: null }) };
    };
    const first = always(3000);
    expect((await appliedLcp(first.sample, 2500, budget)).lcp).toBe(3000);
    expect(first.calls).toHaveLength(3);
    // The confirmations are spent: the next miss stands on its one run.
    const second = always(3000);
    expect((await appliedLcp(second.sample, 2500, budget)).lcp).toBe(3000);
    expect(second.calls).toHaveLength(1);
    // A route within its budget never spends one.
    const fresh = confirmations(1);
    await appliedLcp(always(2000).sample, 2500, fresh);
    expect(fresh.left).toBe(1);
  });

  it("stops measuring before the job's timeout and names the routes it left out", () => {
    const started = 1_000_000;
    expect(pastDeadline(started, started + 29 * 60_000)).toBe(false);
    expect(pastDeadline(started, started + 31 * 60_000)).toBe(true);
    expect(
      budgetFailures([{ route: "/spaces/:id", skipped: true }], {
        metrics: budgets.metrics,
        scriptKb: { "/spaces/:id": 1 },
      }),
    ).toEqual(["/spaces/:id: not measured, the run reached its time limit"]);
  });

  it("gives each parallel run its own Chromium debug port, derived from its server port", () => {
    expect(debugPortFor(undefined)).toBe(9223);
    expect(debugPortFor("3100")).toBe(9223);
    expect(debugPortFor("3800")).toBe(9923);
    expect(debugPortFor("3800")).not.toBe(debugPortFor("3900"));
  });
});
