# Import, export and multi-currency

**Status:** accepted 2026-11-15. The owner answered the open questions with "Lo que consideres pertinente, ya luego lo vamos viendo", so every recommendation in section 6 is the ruling, and the boards are the starting point, to be reviewed as each slice ships.
**Owner's request (2026-11-15, verbatim):** "empezá con el módulo de importar/exportar información. El de importar debe aceptar de diversar aplicaciones, esta por ejemplo es de Money Manager, has la lectura correspondiente y adapta esto a nuestro modelo y sistema. El de importar debe ir por diferentes apps, porque pues el ideal es atraer público de diferentes lados, así mismo, deberíamos empezar a ser multi-moneda en todo sentido".
**Decisions:** D28 (import and export), D29 (multi-currency), D30 (exchange rates) in [spec section 6](../specs/2026-10-11-hearth-design.md#6-key-decisions).
**Boards:** Penpot file "Hearth", page "Importar y exportar · multimoneda (2026-11-15)", drafts for approval, with exports in [`2026-11-15-import-export-and-multi-currency/`](2026-11-15-import-export-and-multi-currency/):

| # | Board | Shows |
|---|---|---|
| 1 | Importar y exportar · inicio | Sources to import from, the export, past imports |
| 2 | Importar · Money Manager · elegir archivo | How to get the backup, the destination space, that the file is not kept |
| 3 | Importar · revisar antes de importar | The dry run: counts, accounts and categories to review, time zone, duplicates and what is left out |
| 4 | Importar · cuentas | Each source account to an existing or a new account, with both closing balances |
| 5 | Importar · categorías | Proposed catalog matches, new categories and subcategories, emoji as icon |
| 6 | Importar · listo | The result and the way to undo it |
| 7 | Exportar mis datos | JSON or CSV, all spaces or one, what is included and what never is |
| 8 | Cuentas · varias monedas | Each balance in its own currency, the total converted at today's rate |
| 9 | Registrar gasto · en otra moneda | A USD expense on a COP card, the converted amount and the bank's real amount |
| 10 | Transferencia · entre monedas | "Sale de" and "Llega a" in each account's currency |
| 11 | Ajustes · moneda y tus datos | The display currency and the way into import and export |
| 12 | Nueva cuenta · moneda | A new account's currency, the space's by default, chosen before any movement and fixed after (#324) |
| 13 | Moneda · hoja | The currency sheet: search by name or code, the most used first, then every ISO 4217 currency |

The way in is Más's "Importar y exportar" tile, which reads "Próximamente" today (#279, P311), and Ajustes links to it too (board 11). Slices: #322 (MC1), #323 (MC2), #324 (MC3), #325 (MC4), #326 (IE1), #327 (IE2), #328 (IE3). The boards follow the approved medium density (P324). They are drawn at 390 px; the 320 px, dark and English checks come with each story, as #309–#313 did.
**Builds on:** HU-E8-04 (CSV import), HU-E8-05 (Splitwise import) and HU-E8-06 (multi-currency spaces) in [E8](../backlog/E8-hardening-and-later.md). This design replaces HU-E8-06's scope and gives HU-E8-04 and HU-E8-05 one shared pipeline.

## 1. What the Money Manager file holds

Money Manager (Realbyte, Android) backs up to one SQLite file (`.mmbak`, or the `.sqlite` inside it). The sample was a real export of about 1,300 movements over 18 months, 31 accounts and 2 currencies. It was read locally and read-only; no row of it is in this repository.

### 1.1 Tables

| Table | Holds | Used by the import |
|---|---|---|
| `ASSETGROUP` | The 11 fixed account groups: 1 Accounts, 2 Card, 3 Debit Card, 4 Savings, 5 Loan, 6 Top-Up/Prepaid, 7 Others, 8 Investments, 9 Overdrafts, 10 Insurance, 11 Cash | Account type |
| `ASSETS` | Accounts: `uid`, `NIC_NAME` (name), `groupUid`, `currencyUid`, `ORDERSEQ`, `CARD_DAY_FIN` / `CARD_DAY_PAY` (card cut-off and payment days), `cardAssetUid` (a card's paying account), `ZDATA1` (memo), `ZDATA` and `ZDATA2` (small flags, meaning unverified, probably "hidden" and "exclude from totals"). No delete column and no opening balance | Accounts |
| `ZCATEGORY` | Categories: `uid`, `NAME`, `TYPE` (0 income, 1 expense), `pUid` (parent; `''` or `'0'` for top level), `STATUS` (0 top level, 2 subcategory), `C_IS_DEL`, `ORDERSEQ`. Two levels at most. Built-in defaults have small numeric uids, the person's own have UUIDs. Names often start with an emoji | Categories |
| `INOUTCOME` | Every movement: see 1.2 | Movements |
| `CURRENCY` | Currencies the person enabled: `ISO`, `MAIN_ISO` (the main currency), `IS_MAIN_CURRENCY`, `RATE` (one manual rate to the main currency, undated), `DECIMAL_POINT`, `SYMBOL_POSITION` | Currency of accounts and movements (the rate is not used) |
| `TAG`, `TX_TAG` | Tags and their links to movements | Appended to the note |
| `BUDGET`, `BUDGET_AMOUNT` | Budgets by period type, total or per category, with an amount per period (`BUDGET_PERIOD` 0 = every period) | Not imported (listed in the preview) |
| `REPEATTRANSACTION` | Recurring movements (`REPEAT_TYPE`, `NEXT_DATE`, `END_DATE`, amount, accounts, category). Empty in the sample, so its codes are unverified | Recurrences, once a sample confirms the codes |
| `FAVTRANSACTION` | Saved templates | Not imported |
| `ZETC` | Settings by `dataTypeKey`: `start_day` (month start day), `week_start_day`, `carry_over`, `use_sub_category`, SMS and display options | `start_day` suggests the space's period policy |
| `PHOTO`, `MEMO`, `SMS_RAW_READ`, `MESSAGEMACRO2`, `CODE_DATA`, `CODE_LINK` | Receipts, notes, SMS parsing, internal codes | Not imported |
| `android_metadata` | Device locale | Ignored |

Every table also has `isSynced`, `syncTime` and `syncVersion` (Realbyte's own sync); they are ignored.

### 1.2 Movements (`INOUTCOME`)

| Field | Meaning |
|---|---|
| `uid` | Stable id of the row: the import's source key |
| `DO_TYPE` | `0` income, `1` expense, `3` transfer out, `4` transfer in, `7` and `8` balance adjustments ("modified balance", no category, may be zero or negative) |
| `WDATE` | Local calendar date `YYYY-MM-DD`: the date the movement counts in |
| `ZDATE` | UTC instant in epoch milliseconds. No zone is stored; in the sample every `WDATE` equals `ZDATE`'s date at UTC−5, so the person's zone recovers it |
| `UTIME` | Last edit, epoch milliseconds |
| `assetUid`, `toAssetUid` | The account, and the other account of a transfer |
| `ctgUid` | Category (empty for transfers and adjustments) |
| `ZMONEY` | Amount as a decimal string (`12345.0`); never parsed as a float |
| `currencyUid` | Currency the movement was entered in |
| `IN_ZMONEY` | Amount in `currencyUid` (the entered amount) |
| `AMOUNT_ACCOUNT` | Amount in the account's own currency (a float; differs from `ZMONEY` only when the currencies differ) |
| `txUidTrans` | Shared by both rows of a transfer: one `3` and one `4` row with the same value, mirrored accounts, same date and instant |
| `ZCONTENT`, `ZDATA` | The two free-text fields of the app (a short note and a longer description; which is which is unverified). `ASSET_NIC` and `CATEGORY_NAME` are denormalized copies, empty in the sample |
| `IS_DEL` | Deleted flag |
| `CARDDIVIDMONTH`, `cardDivideUid`, `CARD_DIVIDE_MONTH_STR` | Card installments ("cuotas"); 0 everywhere in the sample |
| `txUidFee` | A transfer's fee movement; empty in the sample |
| `MARK`, `lat`, `lng`, `gstd`, `SMS_*`, `paid`, `wtime` | Bookmarks, location, SMS origin; unused |

**Foreign-currency rule.** The account's amount is `AMOUNT_ACCOUNT` in the account's currency, and the entered amount is `IN_ZMONEY` in `currencyUid`. The sample has all three cases: an expense entered in USD on a COP account, one entered in COP on a USD account, and a COP → USD transfer, whose out row carries the COP amount and whose in row carries the USD amount.

## 2. How it maps onto Hearth

### 2.1 Accounts

| Money Manager group | Hearth type | Notes |
|---|---|---|
| 1 Accounts | `BANK` | |
| 2 Card | `CREDIT_CARD` | `CARD_DAY_FIN` → `cutOffDay`, `CARD_DAY_PAY` → `paymentDay` |
| 3 Debit Card | `BANK` | Hearth has no separate debit card |
| 4 Savings | `SAVINGS` | |
| 5 Loan | `LOAN` when its balance is negative (money owed), `OTHER` when positive (money lent) | See gap G4 |
| 6 Top-Up/Prepaid | `WALLET` | |
| 7 Others, 10 Insurance | `OTHER` | |
| 8 Investments | `INVESTMENT` | |
| 9 Overdrafts | `BANK` | A negative balance is allowed |
| 11 Cash | `CASH` | |

The name, order and memo carry over. The currency is the account's (D29). Each source account maps to a new account or to an existing one of the person's.

### 2.2 Categories

Money Manager has two levels (category → subcategory) with a kind; Hearth has three (group → category → subcategory, D20) and no kind on categories (one category serves expenses and incomes). So a top-level Money Manager category becomes a Hearth **category**, and its subcategories become **subcategories** under it. A leading emoji becomes the category's icon (D22 allows one emoji) and leaves the name.

The preview proposes a catalog category (P330) for each built-in Money Manager category, matched by name in English or Spanish once the emoji is removed; the person may change any line, and everything else is created new in a group the person picks (Otros by default):

| Money Manager | Hearth (catalog key) |
|---|---|
| Food | Alimentación › Mercado (`groceries`) |
| Social Life | Ocio › Salidas y bares (`going_out`) |
| Pets | Mascotas › Comida y cuidado (`pet_care`) |
| Transport | Transporte › Transporte público (`public_transport`) |
| Culture | Ocio › Entretenimiento (`entertainment`) |
| Household | Vivienda › Hogar y muebles (`home_goods`) |
| Apparel | Cuidado personal › Ropa y calzado (`clothing`) |
| Beauty | Cuidado personal › Peluquería y belleza (`beauty`) |
| Health | Salud › Médico (`medical`) |
| Education | Educación › Cursos y matrículas (`tuition`) |
| Gift | Regalos y donaciones › Regalos (`gifts_given`) |
| Other (expense) | new "Otros gastos" in Otros |
| Salary, Bonus | Ingresos › Salario (`salary`) |
| Allowance, Petty cash, Other (income) | Ingresos › Otros ingresos (`other_income`) |

A subcategory of a category mapped onto a catalog category is created under that catalog category, or merged into a subcategory of the same name. A deleted Money Manager category is imported only when a movement still uses it, and then archived.

### 2.3 Movements

| Money Manager | Hearth |
|---|---|
| `0` income | `INCOME` into the mapped account, received by the importing member |
| `1` expense | `EXPENSE` paid from the mapped account by the importing member, with one share (theirs) in a personal space |
| `3` + `4` with the same `txUidTrans` | One `TRANSFER`. Into a `CREDIT_CARD` it is a card payment (D21); into a `LOAN` a loan payment |
| `7`, `8` | A balance adjustment: see gap G1 |
| `IS_DEL = 1` | Skipped |
| Amount `0` | Skipped and counted in the preview |

- **Date and time:** `date` is `WDATE`. `ZDATE` becomes `occurredAt` and the zone chosen in the preview (the person's own by default) becomes `timeZone`, as HU-E4-14 allows for a file that carries a time. A row whose `WDATE` is not `ZDATE`'s date in that zone keeps `WDATE` and is listed as a warning.
- **Amounts:** decimal strings are read exactly into minor units (`Money.fromMajor`); a float field (`AMOUNT_ACCOUNT`) is converted with the kernel's rounding only (D29).
- **Description:** the two text fields, joined by " · " when both have text, plus the movement's tags as `#tag`.
- **Space:** a Money Manager file is one person's money, so it goes into the importer's personal space. A shared import (Splitwise, HU-E8-05) is its own source.

### 2.4 Gaps

| # | Gap | Proposal |
|---|---|---|
| G1 | Hearth has no balance adjustment; accounts only have an opening balance | An adjustment dated on or before the account's first movement becomes its opening balance. A later one becomes a new movement type `ADJUSTMENT` (one account, a signed amount, no category, never spending or income), which also gives Hearth its own "Ajustar saldo". Question Q4 |
| G2 | Accounts have no currency, and a space has one (D6) | D29 |
| G3 | No external id on any record, so a re-import cannot recognise what it already brought | `import_links` (D28) |
| G4 | Money lent to people outside Hearth (a positive "Loan") has no home | Imported as `OTHER` until HU-E8-15 (debts with people outside my spaces) exists |
| G5 | Card installments | Imported as one expense with a warning until HU-E8-11 exists |
| G6 | Tags | Appended to the description |
| G7 | Budgets (per category and total, by month) | Not imported in the first version; the preview says how many were left out. Question Q6 |
| G8 | A card's paying account (`cardAssetUid`) | Not stored; the card is imported without it |
| G9 | Receipts (photos), saved templates, SMS rules | Not imported |
| G10 | The kernel knows only COP, USD and EUR | D29 adds the whole ISO 4217 list |

## 3. Import and export (D28)

### 3.1 Module

A new module, `src/modules/portability`, with `domain`, `application`, `infrastructure`, `contracts` and `ui` like the others. It never writes ledger tables itself: it writes through the accounts, categories and ledger application APIs, so every domain rule, the space lock (`lockForMoneyWrite`) and the audit apply to imported rows exactly as to typed ones.

```
file ──► SourceAdapter.detect/read ──► SourceSnapshot (neutral model)
                                             │
                     ImportPlanner (proposed mappings, duplicates, warnings)
                                             │
                     preview  ◄── person edits mappings ──► confirm
                                             │
                     ImportWriter port ──► accounts / categories / ledger use cases
                                             │
                                       import_links
```

- **`SourceAdapter` port**, one adapter per app: `detect(file)` answers how sure it is that the file is its format, `read(file)` turns it into a `SourceSnapshot` with no database access. Money Manager (SQLite) is the first; the others in 3.4 follow the same port.
- **`SourceSnapshot`** is Hearth's neutral model of someone else's data: accounts, categories (with parent), movements (`INCOME`, `EXPENSE`, `TRANSFER`, `ADJUSTMENT`) with a source key, a local date, an optional instant, decimal amounts with their currency and per-account amounts, a note, and the settings worth suggesting. An adapter only translates; every decision lives in the planner.
- **`ImportPlanner`** (pure domain) proposes mappings, finds likely duplicates (same account, date, amount and type as a movement already in Hearth), computes each account's closing balance in the source and in Hearth after the import, and lists warnings and what is left out.
- **`ImportWriter` port**, implemented in composition over the existing use cases, commits a confirmed plan in one database transaction.

### 3.2 Flow and API

| Step | Endpoint | What happens |
|---|---|---|
| Upload | `POST /api/v1/spaces/{spaceId}/imports` (multipart, optional `source`) | Detects the app, reads the file, stores the batch and its snapshot, answers the preview. Nothing reaches the ledger |
| Adjust | `PATCH /api/v1/spaces/{spaceId}/imports/{importId}` | Account and category mappings, the time zone, the duplicates to include |
| Confirm | `POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm` (idempotency key) | Commits everything or nothing |
| Undo | `POST /api/v1/spaces/{spaceId}/imports/{importId}/undo` | Logically deletes every movement the batch created (D8) and archives the accounts and categories it created that nothing else uses |
| History | `GET /api/v1/spaces/{spaceId}/imports` | Past imports with counts and their undo state |

The preview is the dry run: counts by kind, the date range, every account with its proposed mapping and both closing balances, every category with its proposal, duplicates, warnings and errors per row. Only a member who records money (`money.record`) imports; a VIEWER does not.

### 3.3 Idempotent re-import

- **`import_links`** (`space_id`, `source_app`, `source_key`, `entity_type`, `entity_id`, `import_id`), unique on the first four. The source key is the source's own id: Money Manager's `uid`, and `txUidTrans` for a transfer pair.
- A movement already linked is skipped as "ya importado", whether the person edited it in Hearth or not; an import never overwrites a person's edit. A linked movement whose source changed since (`UTIME`) is listed as changed and left alone in the first version.
- A file whose hash matches an earlier batch is announced in the preview ("Ya importaste este archivo el 15 nov"), and importing it again brings only what is not linked.
- A logically deleted movement keeps its link, so a re-import never brings back what the person deleted.

### 3.4 Sources

| Source | Format | When |
|---|---|---|
| Money Manager (Android, iOS backup) | SQLite `.mmbak` | First |
| Hearth | Hearth's own JSON export (3.6) | With the export: moves data between installations |
| Generic CSV | Any CSV, with a column mapping the person confirms once (HU-E8-04) | Second |
| Splitwise | Group CSV export, with member mapping (HU-E8-05) | Third |
| Wallet by BudgetBakers, Spendee, Monefy, YNAB, Money Manager Excel | Their CSV or XLS exports | One adapter each, on demand |
| Bank statements | OFX, QIF | Later |

### 3.5 Safety

The file is untrusted: at most 20 MB, read in memory by a WebAssembly SQLite reader (`sql.js`; no native module, no file system, no extensions) or a streaming CSV parser, with a time limit. The Money Manager reader uses Node's built-in `node:sqlite` instead of `sql.js` (no new dependency): `DatabaseSync.deserialize` (Node 24.16+; `.nvmrc`, Docker and CI run 24.21) loads the uploaded bytes into an in-memory database, so nothing touches the file system, with extensions off, the defensive flag on, an authorizer that allows only reads, and the file refused when a table it reads is a view, so every query is a scan bounded by the 20 MB. The raw file is never stored: the batch keeps its hash and the neutral snapshot, and the snapshot is removed physically 7 days after the batch is confirmed or abandoned, like the other technical data D8 allows to delete. The file's contents never reach a log (`failureOf` only).

### 3.6 Export

- `GET /api/v1/me/export?format=json|csv&spaceId=…` exports what the person can see: their personal space, and each shared space they belong to (or one of them), with the same visibility as in the app. Another member's personal accounts never appear (D9); a shared movement shows the paying member's name.
- **JSON** carries a format version, spaces, accounts (with currency and terms), category groups, categories, movements with their payments and shares, recurrences, plans and their lines. It is Hearth's own import source too.
- **CSV** is a ZIP with `movements.csv`, `accounts.csv` and `categories.csv`, one row per movement, decimal amounts with a dot and their currency code, ISO dates and instants, so any spreadsheet reads it whatever the person's display formats (D23 formats stay in the interface).
- Rate-limited, and recorded in the person's security log.

## 4. Multi-currency (D29, D30)

"Multi-moneda en todo sentido" means: any account and any movement in any currency, a total in the currency each person chooses, and shared money that still adds up.

### 4.1 Model

| Concept | Today | Proposed |
|---|---|---|
| Currencies | COP, USD, EUR in the kernel | Every ISO 4217 currency with its exponent and rounding unit |
| Space | One currency (D6) | Its **base currency**: what its plans, Saldos, splits and reports are kept in. Still changeable only while the space has no money |
| Account | Takes the space's currency | Has its own currency, the space's by default; fixed once it has movements |
| Movement | `amount` in the space currency | `amount` stays in the base currency, so every existing read keeps working. New: `originalAmount` + `originalCurrency` (what was charged, when different), and on each account leg the amount in that account's currency when it differs (an expense's payment, an income's destination, both sides of a transfer) |
| Person | No currency preference (P126) | `displayCurrency`: the currency of their totals and of the unified view; their personal space's currency by default |
| Rates | None | A daily rate table (D30) |

**Why the base currency is fixed when a movement is recorded.** What a shared expense means to the group (the shares, the debts in Saldos, what it consumed of a plan line) is decided the day it happens. If it floated with the market, a debt already settled would reopen the next day. So a movement in another currency is converted once, at its date's rate or at the amount the bank actually charged, and both amounts are kept: the conversion is a fact of the record, like the date, not a stored balance (D7 stays).

**What is converted on read.** Stocks: an account in another currency keeps its balance in its own currency, exact (opening balance + its legs); "Disponible", net worth and the projection convert each account at the latest rate on or before the date asked for, and say so ("≈", with the rate's date). Flows across spaces: the unified view converts each space's figures into the person's display currency at each movement's date rate. This supersedes P37's "other currencies apart".

### 4.2 Recording

- The record form offers the account's currency first and any other on request. A movement in a currency other than the base shows "≈ $ 205.000 COP · tasa del 15 nov", from the rate table; the person may type the real converted amount instead (what the bank charged), and that amount wins.
- With no rate for the date (a currency the source does not cover, or the service down), the converted amount is required (`ExchangeRateRequired`, as HU-E8-06 already says).
- A transfer between accounts in different currencies asks both amounts ("Sale" and "Llega"), with the second suggested from the rate.
- Recurrences keep their amount in their own currency (a USD subscription) and convert each occurrence at its date.

### 4.3 Shared spaces

The base currency is the group's. Members record in any currency, and shares, Saldos and the plan stay in the base currency, converted at recording. Each member still sees their own accounts in their currencies, and their unified view in their display currency. A trip space can have USD as its base while each member's personal space stays in COP.

### 4.4 Exchange rates (D30)

- `exchange_rates` (`date`, `base`, `quote`, `rate` as an exact decimal, `source`, `fetched_at`), unique on date, base, quote and source. Global: rates are public facts, not anyone's data.
- Rates come through an `ExchangeRateSource` port, fetched once a day by the existing `Scheduler`, and kept forever (a past rate never changes). Cross rates go through a pivot currency.
- Conversion lives in the kernel (`Money.convert(rate)`), with exact decimal arithmetic and half-even rounding to the target currency's minor unit; nothing else rounds money.
- The source is the owner's decision (Q1).

### 4.5 What changes where

| Area | Change |
|---|---|
| Kernel | Full currency table; `Money.convert`; an exact decimal rate type |
| Accounts | `currency` column (migration fills it with the space's); the balance sums the account's own leg amounts |
| Ledger | Optional original amount and leg amounts; the D6 check becomes "the base amount is in the space's currency" |
| Balances, budgeting | None: they read the base amount |
| Reporting | Totals, the unified view and the cash-flow projection convert on read; P37 and P240's "other currencies out" end |
| Identity | `displayCurrency` preference, null meaning "my personal space's currency" |
| Contract | Only optional fields (`currency` on accounts, `originalAmount`, leg amounts, `displayCurrency`) and new endpoints for rates; existing clients receive what they received |

## 5. Delivery order

| Slice | Content | Depends on |
|---|---|---|
| MC1 | Kernel currencies, `Money.convert`, exact rates | — |
| MC2 | Rate table, source adapter, daily fetch | MC1, Q1 |
| MC3 | Account currency, leg amounts, recording in another currency, transfers across currencies | MC2 |
| IE1 | Portability module, Money Manager adapter, preview, mappings, confirm, undo, import history | MC3 (the sample has a USD account) |
| IE2 | Export JSON and CSV, Hearth import adapter | IE1 |
| MC4 | Display currency, converted totals, unified view across currencies | MC3 |
| IE3 | Generic CSV (HU-E8-04), then Splitwise (HU-E8-05) and other apps | IE1 |

## 6. Questions and rulings

The owner left these to the controller on 2026-11-15; the recommendation is the ruling.

| # | Question | Ruling |
|---|---|---|
| Q1 | Where do exchange rates come from? | Banco de la República's TRM (official COP rate, free, datos.gov.co) for COP, and the European Central Bank's reference rates (free, about 30 currencies) for the rest, with any rate typed on a movement winning. A paid service (Open Exchange Rates, about 170 currencies with hourly updates) only if those fall short |
| Q2 | Multi-currency first, then the Money Manager import, or the import first without foreign-currency accounts? | Multi-currency first (MC1–MC3): the sample itself has a USD account and movements across currencies |
| Q3 | Is a space's base currency fixed at recording (debts never float) the behaviour you want in shared spaces, or do you want Splitwise's style, debts kept per currency? | Base currency fixed at recording |
| Q4 | Balance adjustments: a new movement type "Ajuste de saldo" (also usable by hand in Hearth), or fold them into an income or expense in a category? | A new type: it never shows as spending or income |
| Q5 | Which apps after Money Manager? | Generic CSV, then Splitwise, then Wallet by BudgetBakers |
| Q6 | Should Money Manager budgets come in as a draft plan, or stay out? | Out in the first version; the preview says how many |
| Q7 | Money lent to people outside Hearth (a positive "Loan" in Money Manager) | Imported as an "Otro" account until debts with people outside Hearth exist |
| Q8 | Board 2 tells people where Money Manager keeps its backup ("Más › Copia de seguridad › Exportar"). Is that the path on your phone? | Confirm it before the copy ships |
