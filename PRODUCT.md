# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Households first: people who live together (a couple or a family) and share expenses and a monthly plan, while each one keeps managing their own money. Trips and groups of friends are secondary audiences that use the same shared-space mechanics. Guests (people who do not use the app) take part in shared spaces without signing in.

## Product Purpose

Hearth is a complete personal finance manager that also lets a household share expenses, a budget plan and balances. Success means each member knows their real consumption and cash out across every space, the household sees how the month goes against its plan, and debts between members are clear and settled quickly.

## Positioning

Independent first, shared by choice. Every user is a full personal manager on their own; sharing is an opt-in, private overlay. A shared expense is recorded once, by anyone, and lands in each participant's personal picture through their share, while no member ever sees another member's accounts or balances ("paid by Ana", never her bank).

## Operating Context

- Used almost entirely on the phone: recording an expense at the moment it happens, checking who owes whom, settling up. Desktop is a secondary surface for the same flows.
- Amounts are in the space's currency (COP first) and are rendered from each user's formatting preferences, not from the locale.
- Spanish is the default language, English the second; UI copy addresses the user with "tú".

## Capabilities and Constraints

- Personal space per user; shared spaces with roles OWNER, ADMIN, MEMBER and VIEWER; link and email invitations that expire after 7 days; guest members and guest claim links.
- Split methods: EQUAL, PERCENT, EXACT, SHARES and BY_ALLOCATION (from the active plan). One payer per expense in v1.
- Budget plans per period with member capacities, lines funded by SHARED_FUND, DIRECT or SAVINGS, allocation rules, rollover and a DRAFT → ACTIVE → CLOSED lifecycle.
- Balances, settlement suggestions and settlements; space dashboards (lines, member matrix, fund tracking, spending by group); personal unified view and trends.
- The API returns stable codes; the UI translates every error, warning and reason code through i18n keys.
- Source of functional truth: `docs/product/functional-overview.md`, `docs/specs/2026-10-11-hearth-design.md`, `docs/backlog/`.

## Brand Commitments

- Name: Hearth. Batch 1 web UI design (shell, auth, i18n, personal ledger, categories, settings, white-label rules) was approved by the owner on 2026-10-19 and is shipped; new screens extend it.
- White-label installation rules exist (HU-E9-14), so the brand layer must stay swappable.

## Evidence on Hand

- Product docs and acceptance scenarios with real example figures in `docs/backlog/` (for example the reference plan of 4,000,000 COP split 40/60).
- No testimonials, customers or usage metrics exist; future work must not fabricate them.

## Product Principles

1. Personal first: a member's own picture is never diluted or exposed by sharing.
2. Record once, land everywhere: one shared entry updates every participant's view.
3. Fairness is visible: shares, allocations and debts are always shown as clear sentences and previews before saving.
4. Phone speed: the frequent jobs (record, check balance, settle) finish in a few taps.
5. Truth from the server: the UI previews, the API decides, and the UI never recomputes reported figures.

## Accessibility & Inclusion

Bilingual (es, en) with every user-facing string translated; light and dark themes; keyboard focus visible on every control.
