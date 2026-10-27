# ADR 0005 — Measure LCP under applied throttling

- Status: Accepted (2026-10-26), amends [ADR 0004](0004-web-ui-testing-and-performance-gates.md)
- Issue: #182 (ruling P256)

## Context

ADR 0004 gates every route on Lighthouse's mobile defaults, which simulate slow 4G and a 4× slower CPU: Lighthouse loads the page unthrottled and re-times that load with its Lantern model. Lantern keeps a downloaded script in the LCP estimate only when the script starts evaluating before the observed first frame. On the unthrottled load, the stylesheet and the framework chunks (react-dom, 71 KB, and the Next.js runtime, 44 KB) arrive within a few milliseconds of each other, so whether those chunks count is a race against the first frame's layout and paint.

The race moved the whole app from run to run. With no code change, CI measured `/sign-up` at 1814, 2346 and 1959 ms and `/settings` at 1962, 2349 and 2371 ms. The line editor, the route with the most first-frame work, swung between 1961 and 2522 ms, so the gate failed most pushes. A median of five runs does not help when every run of a job shares the same runner. Lighthouse's own traces showed it: on one route, the same twelve requests came before the paint in every run, and the estimate still read 978, 1819 or 2359 ms.

## Decision

LCP is timed with the same slow 4G and 4× slower CPU applied to the load itself (`throttlingMethod: "devtools"`, `lcpFlags` in `tests/performance/lighthouse.mjs`). That run reports the paint the browser actually makes. Each route gets one such run after its five simulated runs. Applied LCP varies by about ±50 ms between runs, and each run takes about 20 s on CI.

CLS, TBT and script stay on the five simulated runs and their medians, exactly as ADR 0004 sets them. The simulated LCP is still printed (`simulatedLcp`) for diagnosis and is never budgeted. Every budget is unchanged. `budgets.test.mjs` pins both sets of flags and how budgets fail. It does not pin the run counts.

The `performance` job's timeout goes from 30 to 45 minutes, because the applied runs add about ten minutes.

Measured locally on the line editor's build, applied LCP was 1.35 to 1.46 s on every route. On CI's first run under applied throttling it was 1286 to 1318 ms.

## Consequences

- LCP measures what a phone on slow 4G sees: the first paint waits for the document and the stylesheet, not for the script race. A route that blocks its first paint on more bytes or more work still shows it.
- TBT stays simulated. Applying the 4× slower CPU to the runner itself measured `/spaces/:id/plan/trend` at 361 to 525 ms, against 173 to 175 ms simulated. That says more about the runner than about the chart, so moving TBT would change what passes without anyone asking for it.
- The script budgets are unchanged. They still guard what every visitor downloads.
- Rejected:
  - Measuring every metric under applied throttling. It took about 100 s per route, about 52 minutes for 31 routes, and it moved TBT as above.
  - Keeping the simulation and cutting first-frame work route by route. It lowered the line editor locally (P256), but CI still swung the whole app.
  - Raising the LCP budget, which AGENTS.md forbids.
  - More simulated runs, which don't help because every run of a job shares the same runner and the same race.
