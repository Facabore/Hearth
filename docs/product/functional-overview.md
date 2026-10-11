# Hearth — Functional Overview

- **Status:** Draft for owner validation
- **Date:** 2026-10-11
- **Source of truth:** [design spec](../superpowers/specs/2026-10-11-hearth-design.md) and [backlog](../backlog/README.md). This document explains *how each feature behaves* so the owner can confirm it matches expectations before any code is written.

## 0. Guiding principle: independent first, shared by choice

Every user is a **complete personal finance manager on their own**. Sharing is an *overlay*: joining a shared space never requires anyone else to change how they manage their personal money, and nothing personal is ever visible to other members.

| Layer | What it is | Who sees it |
|---|---|---|
| Personal space | My accounts, income, expenses, categories and budgets | Only me |
| Shared space | Expenses, budgets and balances of a group (household, trip, friends) | Its members, per role |
| Unified view | Personal + my share of every shared space, in one picture | Only me |

Users **complement** each other: a shared expense is recorded once, by anyone, and automatically lands in each participant's personal picture through their share.

---

## 1. Personal manager (works with zero other users)

| Feature | How it works | Story |
|---|---|---|
| Personal space | Created automatically on sign-up. Default period policy `MONTHLY(1)`. | HU-E1-02 |
| Accounts | Cash, bank, credit card, savings. Opening balance; balance computed from movements. | HU-E2-01..04 |
| Income | Salary or other income into an account. | HU-E4-02 |
| Expenses | Amount, date, category, account it was paid from. | HU-E4-01 |
| Transfers | Between my own accounts (e.g. pay the credit card, move money to savings). | HU-E4-03 |
| Categories | Default two-level tree seeded in my language; rename, move, archive, never lose history. | HU-E3-01..03 |
| Personal budget | Same budgeting engine as groups, with one member: my capacity (what I have to spend this period), lines, rollover. | E6 (D2) |
| Periods | Monthly with any cut-off day (1–31), or semi-monthly (quincena) with two anchor days. | HU-E0-04, HU-E1-03 |
| Edit / delete | Soft delete with audit trail. | HU-E4-06 |
| Recurring transactions | Rent, utilities, subscriptions or salary repeat on a monthly (cut-off day) or semi-monthly schedule. `AUTO` records them on their date; `CONFIRM` leaves a pending item for variable bills (e.g. electricity) until someone enters the real amount or skips it. Works in personal and shared spaces. | HU-E4-11..13 |

**Example.** Ana uses Hearth alone: she records her salary (1,600,000), pays the market from Bancolombia (85,000) and moves 200,000 to savings. Her dashboard shows spending by category against her personal plan. No group needed.

---

## 2. Shared spaces (opt-in)

| Feature | How it works | Story |
|---|---|---|
| Create a shared space | Name, currency, period policy. Creator is OWNER. | HU-E1-04 |
| Invite members | By link or email; invitations expire after 7 days; cannot grant OWNER. | HU-E1-06/07 |
| Roles | OWNER, ADMIN, MEMBER, VIEWER (permission matrix in HU-E1-05). | HU-E1-05 |
| Leave / archive | Blocked while the member's balance is not zero. | HU-E1-08/09 |
| Shared fund account | Optional common pot owned by the space (e.g. "Household Fund"). | HU-E2-02 |
| Guest members | Add someone who does not use the app (name, optional email). They exist only in that space and take part in every flow: pay, owe, capacity, allocation, settlements. They cannot sign in. | E1 (D15) |
| Claim a guest place | Send the guest an invitation; when they register (or sign in), their guest place becomes their account in that space, keeping all history. | E1 (D15) |
| Split with one person | "I paid dinner with Pedro" creates (or reuses) a two-member direct space "Ana & Pedro"; Pedro can be a guest or a registered user. | E1/E4 (D16) |

**Guest example.** Ana adds guest "Pedro" to a trip space and records a 300,000 hotel paid by Pedro, split equally among Ana, Juan and Pedro. Pedro's payment has no account (it happened outside the app); Ana and Juan each owe Pedro 100,000. If Pedro later registers through his invitation, he sees exactly that history in his own unified view.

**Privacy rule (D9).** When Ana pays a shared expense from her personal Bancolombia account, Juan sees "paid by Ana" — never her account name or balance.

---

## 3. Splitting options

Every shared expense answers: **who paid** (payments) and **whose is it** (shares). Σ payments = Σ shares = amount, always.

| Method | How it works | Example (300,000 COP, Ana and Juan) | Story |
|---|---|---|---|
| `EQUAL` | Equal parts among the selected participants | 150,000 / 150,000 | HU-E4-07 |
| `PERCENT` | Any percentages summing to 100% | 40% / 60% → 120,000 / 180,000 | HU-E4-08 |
| `EXACT` | Exact amounts summing to the total | 100,000 / 200,000 | HU-E4-08 |
| `SHARES` | Units (e.g. 1 and 2) | 1:2 → 100,000 / 200,000 | HU-E4-08 |
| `BY_ALLOCATION` | Uses the budget line's allocation for that period | Home 40/60 → 120,000 / 180,000 | HU-E6-08 |

Additional rules:

- **Participants are selectable:** any subset of current members; the payer does not have to participate (Ana pays a gift only for Juan).
- **Default split:** `BY_ALLOCATION` if the category resolves to an allocated line of an active plan; otherwise `EQUAL`. The member can always override.
- **Rounding:** whole pesos; largest remainder; parts always sum exactly to the total.
- **Shares are a snapshot:** changing a plan later never rewrites recorded expenses.
- **Payers:** one payer in the v1 UI; the domain already supports several.
- **Paid from the shared fund:** no member is the payer; no debt between members is created (D5).

---

## 4. Balances and settlements

| Feature | How it works | Story |
|---|---|---|
| Who owes whom | Per shared space: Σ what each member paid − Σ their shares. Fund-paid expenses create no debt. | HU-E5-01 |
| Settle up | Record "Juan paid Ana 1,200,000", optionally between accounts. Overpaying flips the debt. | HU-E5-02 |
| Simplify debts | Suggest the minimum number of transfers in groups of 3+. | HU-E5-03 |
| History | Balance evolution per member. | HU-E5-04 |

**Example.** Ana pays a 2,000,000 Home expense alone; Home is allocated 40/60. Default split gives Ana 800,000 and Juan 1,200,000 → **Juan owes Ana 1,200,000**. No manual math.

---

## 5. Budgets (personal or shared, same engine)

### 5.1 Building blocks

| Concept | Meaning | Reference example (Household, period 2026-11) |
|---|---|---|
| Period | One plan per period, per the space's policy (monthly cut-off or semi-monthly) | 2026-11-01 → 2026-11-30 |
| Capacity | What each member puts in for the period (fixed amount, group-size agnostic) | Ana 1,600,000 · Juan 2,400,000 · total 4,000,000 |
| Budget line | An envelope with a planned amount and the categories it covers | Rent 1,200,000 · Home 1,470,000 · Savings 600,000 · Free 730,000 |
| Unallocated | Capacity not yet given a job (zero-based) | 0 |
| Allocation | Who is responsible for each line (optional) | see 5.2 |

### 5.2 Allocation rules (per line, any number of members)

| Rule | How it works | Example |
|---|---|---|
| `PROPORTIONAL` (default) | By capacity share | Home 1,470,000 → Ana 588,000 / Juan 882,000 |
| `PERCENT` | Custom percentages summing to 100% | Free 42/58 → 306,600 / 423,400 |
| `FIXED` | Fixed amount per member, summing to planned | Savings → Ana 200,000 / Juan 400,000 |
| `NONE` | Group money, no per-person responsibility | Free as pure shared money |

### 5.3 Funding types

| Funding | How spending is counted | How contribution is counted |
|---|---|---|
| `DIRECT` | Expenses in the line's categories | What each member paid on those expenses |
| `SHARED_FUND` | Expenses in the line's categories (paid from the fund) | Deposits into the fund vs expected (Σ assigned on fund lines) |
| `SAVINGS` | Transfers into the line's savings accounts | Each member's transfers into them |

### 5.4 Catch-all line

One line per plan may be the **catch-all** (e.g. Free): any shared expense whose category is not mapped elsewhere consumes it. Without a catch-all, unmapped spending shows as "Unbudgeted".

### 5.5 Rollover between periods

| Mode | Behaviour |
|---|---|
| `RESET` | Each period starts at the planned amount |
| `ROLLOVER` | Leftover carries over (overspend does not) |
| `ADJUSTED` | Overspend reduces the next period |

### 5.6 Plan lifecycle

`DRAFT` (editable, does not drive splits) → `ACTIVE` (drives default splits) → `CLOSED` (read-only; edits to its expenses rejected). A new plan can be copied from the previous period.

---

## 6. Insight

| View | What it answers | Story |
|---|---|---|
| Line dashboard | Planned / spent / available per line this period | HU-E7-01 |
| Member × line matrix | Assigned / contributed / consumed / gap per member and line | HU-E7-02 |
| Shared fund tracking | Expected vs actual deposits per member | HU-E7-03 |
| Unified personal view | My consumption (personal + my shares) and my cash out (payments + fund deposits + savings transfers), grouped by category across spaces | HU-E7-04 |
| Period-over-period trend | Change per line vs the previous period of the same policy | HU-E7-05 |

**Two numbers that matter for "how much did I spend":**

- **Consumption** = what was *for me* (my shares). Answers "how much did I spend on groceries?"
- **Cash out** = what *left my pockets*. Answers "where did my money go?". The difference with consumption is what others owe me (or I owe them).

---

## 7. Not in v1 (kept in backlog)

CSV and Splitwise import, multi-currency, PWA/offline, notifications, weekly/biweekly periods, bank sync.

---

## 8. Gaps found during this review (decisions needed)

| # | Gap | Why it matters | Proposal |
|---|---|---|---|
| G1 | ~~Splitting with one person without creating a group.~~ | | **Resolved 2026-10-11:** two-member `DIRECT` space created or reused on the first split with someone (D16). |
| G2 | ~~Participants who do not use the app.~~ | | **Resolved 2026-10-11:** guest members scoped to one space, full participants, claimable by registering (D15). |
| G3 | ~~Recurring transactions are in M5.~~ | | **Resolved 2026-10-11:** moved to M3 as HU-E4-11..13, with AUTO and CONFIRM modes. |
| G4 | ~~Capacity is typed manually.~~ | | **Resolved 2026-10-11:** suggested privately from the member's own previous-period income, always editable (D17, HU-E6-02). |
| G5 | **No "equal + adjustment" or itemized split.** | Receipts with personal items mixed in (e.g. market with one person's toiletries). | Add an `ADJUSTMENT` method (equal split plus per-person extras) as Should in M2; itemized receipts later. |
| G6 | **Personal budgets are implied, not explicit in stories.** | The engine supports them (D2), but every E6 story is written for a household. | Add one golden scenario of a personal plan to E6. |
