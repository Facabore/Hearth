# ADR 0005 — Measure LCP under applied throttling

- Status: Accepted (2026-10-26), amends [ADR 0004](0004-web-ui-testing-and-performance-gates.md)
- Issue: #182 (ruling P256)

## Context

ADR 0004 gates every route on Lighthouse's mobile defaults, which simulate slow 4G and a 4× slower CPU: Lighthouse loads the page unthrottled and re-times that load with its Lantern model. Lantern keeps a downloaded script in the LCP estimate only when the script starts evaluating before the observed first frame. On the unthrottled load, the stylesheet and the framework chunks (react-dom, 71 KB, and the Next.js runtime, 44 KB) arrive within a few milliseconds of each other, so whether those chunks count is a race against the first frame's layout and paint.

The race moved the whole app from run to run. With no code change, CI measured `/sign-up` at 1814, 2346 and 1959 ms and `/settings` at 1962, 2349 and 2371 ms. The line editor, the route with the most first-frame work, swung between 1961 and 2522 ms, so the gate failed most pushes. A median of five runs does not help when every run of a job shares the same runner. Lighthouse's own traces showed it: on one route, the same twelve requests came before the paint in every run, and the estimate still read 978, 1819 or 2359 ms.

## Decision

`tests/performance/lighthouse.mjs` passes `throttlingMethod: "devtools"`: the same slow 4G and 4× slower CPU are applied to the load itself, and LCP is the paint the browser actually reports. The budgets, the five runs, the medians and every metric stay as ADR 0004 sets them (`lighthouseFlags`, pinned by `budgets.test.mjs`).

Measured locally on the line editor's build: every route measured 1.36 to 1.46 s, a spread of about ±50 ms from run to run, with TBT at 76 to 114 ms.

## Consequences

- LCP measures what a phone on slow 4G sees: the first paint waits for the document and the stylesheet, not for the script race. A route that blocks its first paint on more bytes or more work still shows it.
- TBT now measures the runner's own CPU slowed by 4×, so a slower runner raises it. If TBT starts failing with no code change, that is the signal to revisit, never to raise its budget.
- The script budgets are unchanged. They still guard what the simulation used to penalize: script that every visitor downloads.
- Rejected: keep the simulation and cut first-frame work route by route (it lowered the line editor locally, P256, but CI still swung the whole app); raise the LCP budget (forbidden by AGENTS.md); more runs (the race is shared by every run of a job).
