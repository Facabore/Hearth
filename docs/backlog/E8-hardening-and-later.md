# E8 — Hardening and later

**Goal:** make the self-hosted deployment safe to rely on (backups, observability) and capture post-v1 capabilities so they are designed for, not designed out.

**Modules involved:** deployment/operations, `shared/infrastructure`, `shared/http`, `ledger` (imports), cross-cutting for deferred items.

**Delivery (spec D18):** backend stories here are done at API level like E0–E7. HU-E8-07 is a web UI story kept here as a Won't-v1 placeholder; it depends on E9 and follows the UI Definition of Done.

---

## HU-E8-01 — Nightly backups and restore drill

- **Milestone:** M5 · **Priority:** Must · **Size:** M · **Depends on:** HU-E0-07 · **Module(s):** deployment

**User story:** As the owner, I want nightly database backups and a rehearsed restore, so that the household never loses its financial history.

```gherkin
Feature: Backups and restore

  Scenario: Nightly dump is produced
    Given the stack is running on the VPS
    When the clock reaches 02:00 America/Bogota
    Then a compressed "pg_dump" file named with the date, such as "hearth-2026-11-12.sql.gz", is written to the backup volume

  Scenario: Old backups are pruned
    Given backups exist for the last 20 days and the retention is 14 days
    When the nightly backup job finishes
    Then only the 14 most recent backups remain

  Scenario: Backup failure is visible
    Given the database is unreachable at 02:00
    When the backup job runs
    Then it exits with a non-zero status and logs an error with the job name "nightly-backup"

  Scenario: Restore drill succeeds
    Given the latest backup file
    When the owner runs "scripts/restore-drill.sh"
    Then the dump is restored into a scratch database
    And a smoke query returns the same transaction count as production at backup time
    And the scratch database is removed
```

**Technical notes:**
- Backup container or cron sidecar in Docker Compose; retention configurable (`BACKUP_RETENTION_DAYS`, default 14).
- Off-site copy target documented in `docs/operations/backups.md`; restore drill performed at least once before declaring M5 done.
- Built in M5 (plan `2026-10-19-m5-nightly-backups.md`, rulings P107–P116): the `backup` service (`postgres:18.6-alpine`, busybox `crond`, 02:00 in `APP_TIMEZONE`) runs `scripts/backup.sh`, which writes `hearth-YYYY-MM-DD.sql.gz` with its snapshot's transaction count on the first line and then keeps the newest `BACKUP_RETENTION_DAYS` files; `scripts/restore-drill.sh` restores into `hearth_restore_drill`, compares the count and drops it; the optional `backup-offsite` service (`rclone/rclone:1.75.2`, profile `offsite`) copies the files to any rclone remote at 03:00. Logs are JSON lines with the `job` `nightly-backup`, `restore-drill` or `offsite-copy`. The drill on the VPS is recorded in `docs/operations/backups.md`.

---

## HU-E8-02 — Structured logging and health check

- **Milestone:** M5 · **Priority:** Should · **Size:** M · **Depends on:** HU-E0-07 · **Module(s):** `shared/infrastructure`, `app`

**User story:** As the owner, I want structured logs with request ids and a health endpoint, so that I can diagnose failures and know when the app is down.

```gherkin
Feature: Observability

  Scenario: Every request is logged with a request id
    When a client calls "GET /api/v1/spaces/{spaceId}/transactions"
    Then a JSON log line is written with "level", "requestId", "route", "durationMs" and "status"

  Scenario: Unexpected errors return a generic problem with the request id
    Given a use case fails with an unexpected database error
    When a client calls its endpoint
    Then the response is a status 500 problem+json with the code "InternalError" and the requestId
    And the log line for that request id contains the error stack

  Scenario: Health check reports healthy
    When a client requests "GET /api/v1/health"
    Then the response status is 200 and the body reports "db": "ok"

  Scenario: Health check reports database failure
    Given PostgreSQL is unreachable
    When a client requests "GET /api/v1/health"
    Then the response status is 503 and the body reports "db": "unreachable"

  Scenario: Sensitive data is not logged
    When a client signs in through "POST /api/v1/auth/sign-in"
    Then no log line contains the password, session token or email address
```

**Technical notes:**
- `Logger` port in `shared/infrastructure` (pino adapter); request id from header or generated.
- Extends the liveness-only `GET /api/v1/health` of HU-E0-07 with the database check; the Docker health check uses it and Caddy only routes to healthy containers.
- The generic 500 problem comes from the HU-E0-09 mapper; this story adds the stack trace to the log line of that request id.

**As built (issue #62, ruling P252):**

- **Access log.** `defineRoute` writes one `info` line per answer: `requestId`, `method`, `route`, `status` and `durationMs`. Refused answers get one too.
  - `route` is the path with each route parameter written as its name, for example `/api/v1/invitations/[token]/accept`. A catch-all parameter writes each of its values as its name, and a malformed percent-escape is logged as it came. Writing the access line never changes the answer. The log groups by route and never carries an id or a token from the path.
  - The query string and the body are never logged.
- **Error stack.** An unhandled error's line gains `stack`: its frames (`at …`) without the first line, which repeats the message. The message stays reduced to its first line without the `params:` tail, as before.
- **Health.** `GET /api/v1/health` runs `SELECT 1` on the pool. It answers 200 `{ status: "ok", db: "ok" }`, or 503 `{ status: "unavailable", db: "unreachable" }` on any failure, so the Docker HEALTHCHECK's `wget` fails and Caddy stops routing. `db` is optional in the 200 schema, for older clients. The probe gives up after 2 s, so a hung database answers 503 within the HEALTHCHECK's 3 s timeout. The pending `SELECT 1` is not cancelled: against a hung database each probe keeps waiting on a pool connection until PostgreSQL answers or drops it.
- **LOG_LEVEL.** `LOG_LEVEL` is now honoured: `info` and `debug` write the access log, while `warn` and `error` keep only errors. The tests run at `error`.
- **No pino.** The `Logger` port keeps its JSON-lines console adapter. A pino adapter would add a dependency for no behaviour the scenarios need. It can be added behind the same port later.

---

## HU-E8-03 — Recurring transactions (moved)

Moved on 2026-10-11 to M3 and split into HU-E4-11, HU-E4-12 and HU-E4-13 in [E4-ledger.md](E4-ledger.md). This ID is retired and never reused.

---

## HU-E8-04 — Import transactions from CSV

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E4-01, HU-E4-02 · **Module(s):** `ledger`

**User story:** As a user moving from another app, I want to import my history from a CSV file, so that my reports include past months.

```gherkin
Feature: CSV import

  Scenario: Preview and import valid rows
    Given a CSV with columns "date,description,amount,category" and 3 valid rows totalling 245,000 COP
    When "Ana" uploads it for the account "Bancolombia" and confirms the preview
    Then 3 expenses totalling 245,000 COP are recorded in her personal space

  Scenario: Invalid rows are reported and skipped
    Given a CSV where row 2 has the date "31/02/2026"
    When "Ana" uploads it
    Then the preview marks row 2 as invalid with the reason "InvalidDate"
    And only valid rows are imported on confirmation

  Scenario: Unknown categories are mapped before import
    Given a CSV row with the category "Supermercado" that does not exist
    When "Ana" maps "Supermercado" to "Groceries" in the preview
    Then the imported row uses "Groceries"

  Scenario: Likely duplicates are flagged
    Given an existing expense "Market" of 85,000 COP on 2026-10-05
    When "Ana" uploads a CSV containing the same date, description and amount
    Then that row is flagged as a likely duplicate and excluded unless "Ana" includes it
```

**Technical notes:**
- Use case: `ImportTransactionsFromCsv` with a `CsvParser` port; whole import runs in one database transaction.
- Endpoints: `POST /api/v1/spaces/{spaceId}/imports/csv` (multipart upload, returns the preview with per-row status), `POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm` (category mappings and included duplicates).
- Upload file size limit 5 MB; parsing happens server-side.
- Imported rows have no time unless the file has a time column, which is read in the importing user's time zone (HU-E4-14).

---

## HU-E8-05 — Import from Splitwise

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E4-08, HU-E5-01, HU-E1-10 · **Module(s):** `ledger`

**User story:** As a household moving from Splitwise, I want to import a group's export, so that our shared history and balances carry over.

```gherkin
Feature: Splitwise import

  Scenario: Import a group export with member mapping
    Given a Splitwise group export with members "Ana Gómez" and "Juan Pérez" and 40 expenses
    When "Ana" maps "Ana Gómez" to "Ana" and "Juan Pérez" to "Juan" and confirms
    Then 40 shared expenses are recorded in "Household" with splitMethod "EXACT"

  Scenario: Imported balances match the export
    Given the export's final balance states "Juan Pérez" owes "Ana Gómez" 230,500 COP
    When the import completes
    Then "Juan" owes "Ana" 230,500 COP in "Household"

  Scenario: Unmapped member blocks the import
    Given the export contains "Luis Rojas" who is not mapped to a member
    When "Ana" confirms the import
    Then the result is the error "UnmappedImportMember"

  Scenario: Export in another currency is rejected
    Given a Splitwise export in "USD" for a "COP" space
    When "Ana" uploads it
    Then the result is the error "CurrencyMismatch"
```

**Technical notes:**
- Use case: `ImportSplitwiseGroup`; adapter parses the Splitwise CSV export format. Endpoints: `POST /api/v1/spaces/{spaceId}/imports/splitwise` (preview), `POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm` (member mapping).
- Settlements in the export become `SETTLEMENT` transactions.
- A Splitwise member may be mapped to an existing or new guest (HU-E1-10); payments imported for a guest carry no account.
- Imported expenses and settlements keep their date and have no time (HU-E4-14).

---

## HU-E8-06 — Multi-currency spaces

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** M · **Depends on:** HU-E0-03 · **Module(s):** `ledger`, `shared/kernel`

**User story:** As a traveller, I want to record expenses in a foreign currency converted to the space currency, so that trips abroad fit in the same ledger.

```gherkin
Feature: Foreign-currency expenses

  Scenario: Expense converted at a recorded rate
    Given the space "Trip 2027" uses "COP"
    When "Ana" records an expense of 50 USD with the rate 4,000 COP per USD
    Then the expense amount is 200,000 COP and the original 50 USD and rate are stored

  Scenario: Missing rate is rejected
    When "Ana" records an expense of 50 USD without a rate
    Then the result is the error "ExchangeRateRequired"
```

**Technical notes:**
- Deferred by spec non-goals and D6; kept so the Money API does not preclude it.
- Would extend `POST /api/v1/spaces/{spaceId}/expenses` with an optional `original` Money and `rate`; the space-currency `amount` stays the minor-units string of HU-E0-09.
- **Currency per account (decided 2026-10-16):** every account keeps its space's currency (HU-E2-01, HU-E2-05); a currency per account is future work only, because it breaks the invariant "account currency = space currency". The design it would follow:
  - `account.currency` (ISO 4217); each movement keeps `amount` in the account's currency plus `amountInSpaceCurrency`, `fxRate`, `fxSource` and `fxDate`;
  - a transfer between currencies stores both amounts and derives the rate;
  - splits, budgets and balances between members always use the space currency;
  - available money and net worth (HU-E2-07, HU-E8-17) convert with the rate of their date;
  - rate source: the TRM certified by the Superintendencia Financiera, open data on datos.gov.co (dataset `32sa-8pi3`); the TRM of 2026-10-16 was 3,170.46 COP per USD. A card purchase abroad can be adjusted to the amount billed in COP.

---

## HU-E8-07 — Installable PWA with offline read

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** M · **Depends on:** HU-E7-04, HU-E9-01, HU-E9-11 · **Module(s):** `app`

**User story:** As a mobile user, I want to install the app and read my latest figures offline, so that I can check balances without a connection.

```gherkin
Feature: PWA offline read

  Scenario: App is installable
    When a user opens the app in a mobile browser
    Then a valid web app manifest and service worker are available

  Scenario: Last-synced dashboard is readable offline
    Given the user opened the dashboard online at 2026-11-12 18:00
    When the user opens the dashboard offline
    Then the cached dashboard is shown with the label "Last updated 2026-11-12 18:00"
    And recording new transactions is disabled
```

**Technical notes:**
- Read-only offline cache; offline writes are explicitly out of scope.
- Web UI story kept in E8 as a placeholder: it builds on the E9 app shell (HU-E9-01) and personal dashboards (HU-E9-11) and follows the UI Definition of Done, so its scenarios run with Playwright like E9 stories.

---

## HU-E8-08 — Notifications

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** M · **Depends on:** HU-E1-07, HU-E5-02 · **Module(s):** `spaces`, `ledger`

**User story:** As a household member, I want to be notified when I am added to an expense or receive a settlement, so that I stay informed without opening the app.

```gherkin
Feature: Notifications

  Scenario: Participant is notified of a new shared expense
    Given "Juan" has email notifications enabled
    When "Ana" records an expense of 300,000 COP split "EQUAL" with "Juan"
    Then "Juan" receives a notification stating his share of 150,000 COP

  Scenario: Opted-out user receives nothing
    Given "Juan" disabled notifications
    When "Ana" records an expense split with "Juan"
    Then no notification is sent to "Juan"

  Scenario: Settlement receipt notification
    When "Juan" records a settlement of 1,200,000 COP to "Ana"
    Then "Ana" receives a notification of the 1,200,000 COP settlement
```

**Technical notes:**
- `Notifier` port fed by domain events (`ExpenseRecorded`, `SettlementRecorded`); reuses the `EmailSender` adapter.
- The preference is part of the user profile (`PATCH /api/v1/me`); its toggle would join the settings screen (HU-E9-13).

---

## HU-E8-09 — Weekly and biweekly period policies

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** S · **Depends on:** HU-E0-04, HU-E1-03 · **Module(s):** `shared/kernel`, `spaces`

**User story:** As a household paid every week or every two weeks, I want weekly or biweekly periods, so that budgets follow our actual pay cycle.

```gherkin
Feature: Weekly and biweekly period policies

  Scenario: Weekly periods start on the chosen weekday
    Given a space with the period policy WEEKLY(MONDAY)
    When the period is derived for the date 2026-11-10
    Then the period runs from 2026-11-09 to 2026-11-15
    And its label is "2026-W46"

  Scenario: Biweekly periods repeat every 14 days from the anchor date
    Given a space with the period policy BIWEEKLY(2026-11-06)
    When the period is derived for the date 2026-11-25
    Then the period runs from 2026-11-20 to 2026-12-03
```

**Technical notes:**
- Deferred by spec 5.2 and D14; kept so the `PeriodPolicy` union (HU-E0-04) stays open to new cadences.
- Weekly labels use ISO week numbering; plan boundaries remain stored, so switching to these cadences follows the same overlap rule as HU-E1-03.
- Set through `PATCH /api/v1/spaces/{spaceId}` (HU-E1-03); the `periodPolicy` contract gains the `WEEKLY` and `BIWEEKLY` variants.

---

## HU-E8-10 — Keycloak as an external OIDC identity provider

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** M · **Depends on:** HU-E1-01, HU-E1-02 · **Module(s):** `identity`

**User story:** As the owner, I want to sign in through a self-hosted Keycloak, so that Hearth shares single sign-on, MFA and social login with my other self-hosted services.

```gherkin
Feature: Keycloak sign-in through OIDC

  Scenario: First Keycloak sign-in provisions the user and the personal space
    Given a Keycloak realm "home" with the user "ana@example.com"
    When "Ana" signs in to Hearth through Keycloak for the first time
    Then a Hearth user linked to her Keycloak subject is created
    And exactly one PERSONAL space exists for her with the period policy MONTHLY(1)

  Scenario: An existing email account is linked, not duplicated
    Given "ana@example.com" already signed up with email and password
    When she signs in through Keycloak with the same verified email
    Then the Keycloak identity is linked to her existing user
    And no second user or personal space is created
```

**Technical notes:**
- Implemented as a Better Auth generic OAuth/OIDC provider behind the existing `AuthProvider` and `SessionResolver` ports; the domain does not change.
- Personal-space creation becomes idempotent "ensure on first authenticated session" for OIDC sign-ins, because registration happens outside Hearth.
- Adds a `keycloak` service (and its database) to the Compose files; the Keycloak login theme is configured in Keycloak, not in the Hearth web UI.

---

## HU-E8-11 — Credit card purchases in installments with interest

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E2-06, HU-E2-07, HU-E4-01, HU-E4-13 · **Module(s):** `ledger`, `accounts`

**User story:** As a cardholder, I want to record a card purchase in installments with its monthly rate, so that I see each statement's estimated minimum and total payment and the interest I avoid by paying in full.

```gherkin
Feature: Installment purchases on a credit card

  Background:
    Given "Ana" has the account "Visa" of type "CREDIT_CARD" with cut-off day 20, payment day 5 and monthly rate "2.0" % M.V.

  Scenario: The installment plan follows French amortization
    When "Ana" records an expense "Laptop" of 1,200,000 COP in "Technology" paid from "Visa" on 2026-11-03 in 12 installments
    Then one expense of 1,200,000 COP dated 2026-11-03 counts as spending in "Technology"
    And its installment plan has a fixed installment of 113,472 COP
    And the first row, at the cut-off of 2026-11-20, has interest 24,000 COP, principal 89,472 COP and balance 1,110,528 COP
    And the last row, at the cut-off of 2027-10-20, pays 113,467 COP and leaves a balance of 0 COP
    And the plan's total interest is 161,659 COP

  Scenario: Statement estimate with minimum and total payment
    Given the "Laptop" plan and a one-installment purchase "Shoes" of 150,000 COP on 2026-11-08 paid from "Visa"
    When "Ana" requests the "Visa" statement estimate for the cut-off of 2026-11-20
    Then the estimated minimum payment is 263,472 COP and the total payment is 1,374,000 COP, both due 2026-12-05
    And the estimate states that paying the total avoids about 137,659 COP of interest

  Scenario: Interest becomes an expense when it is charged
    Given the "Laptop" plan
    When the cut-off of 2026-11-20 passes
    Then a pending charge "Visa interest" of 24,000 COP in "Financial costs" paid from "Visa" waits for confirmation
    When "Ana" adjusts it to the statement amount of 24,310 COP and confirms it
    Then an expense of 24,310 COP dated 2026-11-20 is recorded in "Financial costs"

  Scenario: A rate above the usury cap is recorded with a warning
    Given the usury cap for consumer credit valid in October 2026 is "28.59" % E.A. ("2.1176" % M.V.)
    When "Ana" records a purchase of 600,000 COP paid from "Visa" on 2026-10-10 in 6 installments at "2.2" % M.V. ("29.8407" % E.A.)
    Then the purchase is recorded
    And the response "warnings" array contains "RateAboveUsuryCap" with the cap "28.59" % E.A.

  Scenario: Interest-free installments
    When "Ana" records a purchase of 900,000 COP paid from "Visa" in 3 installments with a 0 % promotion
    Then its three rows are 300,000 COP each with no interest

  Scenario: The split applies to the purchase, never to the card payment
    Given "Ana" records a shared expense of 300,000 COP in "Household" paid from "Visa" in 6 installments, split "EQUAL" with "Juan"
    Then "Juan" owes "Ana" 150,000 COP from the purchase date
    And the interest charges of its plan are expenses of "Ana" in her personal space
    And the transfer that pays "Visa" changes no balance between "Ana" and "Juan"
```

**Technical notes:**
- Rates: `i_m = (1 + EA)^(1/12) − 1`, `EA = (1 + i_m)^12 − 1`, `N.M.V. = 12 · i_m`. For example, 2.0 % M.V. is 26.82 % E.A.
- French amortization with a fixed installment `C = P · i / (1 − (1 + i)^−n)`. For each row k: `interest_k = round(balance_{k−1} · i)` to the peso (the COP rounding unit), `principal_k = C − interest_k` and `balance_k = balance_{k−1} − principal_k`. The last row takes the remaining balance, which is why it pays 113,467 COP. Rows are dated at the cut-offs that follow the purchase.
- Statement estimate:
  - `minimum = Σ principal of the plan rows at this cut-off + interest of the period + one-installment purchases + fees and insurance recorded in the period`;
  - `total = balance owed at the cut-off`;
  - `interest avoided = Σ interest of the remaining rows after this cut-off`.

  "Adjust to the statement" always replaces an estimate with the real figure.
- When interest starts (`interestFrom`) depends on the bank and the card: the purchase date or the second cut-off. Bancolombia charges no interest on one installment for most cards, but some (Mastercard Ideal, Amex Libre) charge it from the first month. Cash advances accrue interest from the first day and are deferred automatically.
- Data: `InstallmentPlan` (expense, principal, n, monthly rate, `interestFrom`, zero-rate promotion, first cut-off). Its `InstallmentRow`s (k, cut-off date, interest, principal, balance) are computed on read from the plan (D7). `UsuryRate` (modality, rate E.A., valid from, valid to) is a table loaded from the Superintendencia Financiera's monthly certification, never a constant. For October 2026 the certified current banking interest for consumer credit is 19.06 % E.A. (Resolución 1472 de 2026), so the usury cap is 1.5 × 19.06 = 28.59 % E.A., that is 2.1176 % M.V. (25.41 % N.M.V.).
- The purchase is the expense, at its full amount, on its date and with its category; the installments only shape what the card owes. Interest and fees become new expenses in "Financial costs" when they are charged: the charge waits as a pending item that the user confirms with the statement amount (the confirm flow of HU-E4-13). Paying the card is a transfer (HU-E2-07).
- Endpoints: `POST /api/v1/spaces/{spaceId}/expenses` gains an optional `installments` object (count, monthly rate defaulting to the card's, `interestFrom`, zero-rate promotion), allowed only when the payment comes from a CREDIT_CARD; `GET .../accounts/{accountId}/statements?cutOff=<date>` returns the estimate.
- Regulatory: charging above the usury cap is illegal in Colombia, but Hearth only records and warns; it never blocks. Projections are estimates and say so; Hearth gives no financial advice and recommends no products or entities.
- **Spec impact:** 5.2 (new `InstallmentPlan` and `UsuryRate`), 5.2 **Transaction** (installments on an expense paid by card), D3 (single entry is kept: purchase, interest and fees are expenses and the card payment is a transfer).

---

## HU-E8-12 — CDT yield projection with withholding tax

- **Milestone:** M5 · **Priority:** Could · **Size:** S · **Depends on:** HU-E2-06, HU-E2-07 · **Module(s):** `accounts`, `ledger`

**User story:** As a saver, I want each CDT's value at maturity projected net of the 4 % withholding tax, so that I know what I will actually receive and what counts in my net worth meanwhile.

```gherkin
Feature: CDT projection

  Background:
    Given "Ana" has the SAVINGS account "CDT Davivienda" with 10,000,000 COP at "9.5" % E.A., term 180 days, start 2026-10-16 and maturity 2027-04-14

  Scenario: Net value at maturity
    When "Ana" requests the projection of "CDT Davivienda"
    Then the period rate is "4.577" %
    And the gross interest is 457,722 COP, the withholding 18,309 COP and the value at maturity 10,439,413 COP

  Scenario: Interest paid every 30 days
    Given "CDT Davivienda" pays interest every 30 days
    When "Ana" requests its projection
    Then each payment is 74,872 COP gross, 2,995 COP of withholding and 71,877 COP net

  Scenario: A certificate on a 360-day base
    Given "CDT Davivienda" uses a 360-day base
    When "Ana" requests its projection
    Then the period rate is "4.642" %
    And the gross interest is 464,225 COP, the withholding 18,569 COP and the value at maturity 10,445,656 COP

  Scenario: Net worth counts the accrued net interest
    Given today is 2027-01-14, 90 days after the start
    When "Ana" requests her accounts
    Then "CDT Davivienda" counts 10,217,248 COP in her net worth

  Scenario: Recording the proceeds at maturity
    When "Ana" settles "CDT Davivienda" into "Bancolombia" on 2027-04-14 accepting the projection
    Then an income "CDT interest" of 439,413 COP into "CDT Davivienda" in "Other income" is recorded
    And a transfer of 10,439,413 COP from "CDT Davivienda" to "Bancolombia" is recorded
    And "CDT Davivienda" has a balance of 0 COP
```

**Technical notes:**
- Formulas, with `base` = 365 (default) or 360 per certificate:
  - period rate `i_p = (1 + EA)^(days / base) − 1`;
  - gross interest `B = C · i_p`;
  - withholding `R = 4 % · B`;
  - value at maturity `VF = C + B − R`;
  - with interest paid every p days, each payment is `C · ((1 + EA)^(p / base) − 1)`;
  - accrued net interest after t days (capped at the term), counted in net worth: `C · ((1 + EA)^(t / base) − 1) · 0.96`.

  Amounts round to the peso; rates keep 6 decimal places as a fraction.
- If the bank uses another base or rounds differently, the certificate prevails: settling the CDT lets the user adjust both amounts before saving.
- At maturity Hearth proposes two choices: "renew", which starts a new term on the same account from the maturity date, or "move to an account", the scenario above. The reminder 7 days before maturity is HU-E8-16.
- New SAVINGS attributes: `dayCountBase` (365 or 360), `interestEveryDays` (null when interest is paid at maturity) and `autoRenew`.
- Regulatory: the 4 % withholding on financial yields is an advance on income tax. Decreto 700 de 1997 set 7 %, and Decreto 2418 de 2013 lowered it to 4 % for fixed-income titles, which the DIAN applies to CDTs. The inflationary component (the non-taxable share of yields) is set by decree every year: 50.88 % for tax year 2024. Hearth reports these values and never liquidates taxes. Projections are estimates, not advice.
- **Spec impact:** 5.2 **Account** (SAVINGS: day-count base, interest periodicity, renewal), 5.4 `netWorth` (term deposits count their accrued net interest).

---

## HU-E8-13 — Loan amortization schedule and extra payments

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E2-06, HU-E4-01, HU-E4-03 · **Module(s):** `accounts`, `ledger`

**User story:** As a borrower, I want my loan's amortization schedule and a simulator for extra payments, so that I know how much interest each installment carries and how much an extra payment saves.

```gherkin
Feature: Loan schedule and extra payments

  Background:
    Given "Ana" has the LOAN "Crédito libre inversión" with principal 20,000,000 COP, rate "18" % E.A., term 36 months, first payment on 2026-11-15 and insurance of 25,000 COP per month

  Scenario: Amortization schedule
    When "Ana" requests the schedule of "Crédito libre inversión"
    Then the monthly rate is "1.3888" % M.V. and the installment is 709,736 COP plus 25,000 COP of insurance
    And the first row has interest 277,769 COP, principal 431,967 COP and balance 19,568,033 COP
    And the 36th row pays 709,719 COP and the total interest is 5,550,479 COP

  Scenario: Paying an installment separates principal from cost
    When "Ana" pays installment 1 from "Bancolombia" on 2026-11-15
    Then a transfer of 431,967 COP from "Bancolombia" to "Crédito libre inversión" is recorded
    And an expense of 302,769 COP (interest 277,769 COP and insurance 25,000 COP) in "Financial costs" paid from "Bancolombia" is recorded
    And "Crédito libre inversión" has a balance of -19,568,033 COP and "Bancolombia" decreased by 734,736 COP

  Scenario: An extra payment that shortens the term
    Given 12 installments are paid and the outstanding balance is 14,401,518 COP
    When "Ana" simulates an extra payment of 2,000,000 COP that reduces the term
    Then 21 installments remain instead of 24
    And the interest saved is 729,721 COP

  Scenario: An extra payment that lowers the installment
    Given 12 installments are paid and the outstanding balance is 14,401,518 COP
    When "Ana" simulates an extra payment of 2,000,000 COP that reduces the installment
    Then the new installment is 611,171 COP for the remaining 24 months
    And the interest saved is 365,530 COP

  Scenario: Recording an extra payment recomputes the schedule
    Given 12 installments are paid
    When "Ana" records an extra payment of 2,000,000 COP from "Bancolombia" that reduces the term
    Then a transfer of 2,000,000 COP to "Crédito libre inversión" is recorded
    And the schedule restarts from 12,401,518 COP with 21 rows left

  Scenario: UVR loans are estimates
    Given "Ana" has the mortgage "Crédito vivienda" in UVR
    When "Ana" requests its schedule
    Then every installment is flagged as estimated
```

**Technical notes:**
- The installment and the rows follow the French formula of HU-E8-11 (`C = P · i / (1 − (1 + i)^−n)`, interest rounded to the peso, the last row takes the remaining balance), with `i = (1 + EA)^(1/12) − 1`. Insurance is a fixed charge outside the installment.
- Extra payments, after the new balance `B' = B − extra`:
  - reduce the term: keep `C` and pay until the balance is 0, that is `n' = ⌈−ln(1 − B' · i / C) / ln(1 + i)⌉`;
  - reduce the installment: `C' = B' · i / (1 − (1 + i)^−n_remaining)`;
  - interest saved = interest of the old remaining rows − interest of the new rows.
- Paying an installment records, in one database transaction, a transfer of the principal to the loan (a liability whose negative balance shrinks) and an expense of interest plus insurance in "Financial costs". Only the cost counts as spending (D3).
- The schedule is computed on read from the loan's terms and its recorded payments (D7); a payment that differs from the schedule moves the remaining rows.
- Endpoints: `GET .../accounts/{accountId}/schedule`; `POST .../accounts/{accountId}/schedule/simulations` (amount, mode `REDUCE_TERM` or `REDUCE_INSTALLMENT`, nothing recorded); `POST /api/v1/spaces/{spaceId}/loan-payments` (installment or extra payment, honours `Idempotency-Key`).
- New LOAN attributes: `firstPaymentDate`, `monthlyInsurance`, `indexedToUvr`.
- Regulatory: Ley 1555 de 2012 lets borrowers prepay without penalty on credits up to 880 SMMLV and choose between a shorter term and a lower installment; mortgage loans have their own regime. UVR installments are estimates, and the bank's statement prevails. Projections are not advice.
- Debt payoff strategies (snowball, avalanche) need several debts and are not part of this story.
- **Spec impact:** 5.2 **Account** (LOAN: first payment date, insurance, UVR flag), D3 (a loan payment is a transfer of principal plus an expense of cost).

---

## HU-E8-14 — Personal and shared savings goals

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E2-05, HU-E4-03, HU-E4-11 · **Module(s):** `accounts`, `ledger`

**User story:** As a saver, or a household saving together, I want goals with a target amount and date funded from linked accounts, so that we see progress, the monthly contribution needed and whether we are on track.

```gherkin
Feature: Savings goals

  Scenario: Progress and suggested monthly contribution
    Given "Ana" has the goal "Viaje Cartagena" with a target of 6,000,000 COP by 2027-06-30, linked to her SAVINGS account "Ahorro viaje"
    And 1,500,000 COP are saved on 2026-10-31
    When "Ana" requests the goal
    Then its progress is 25 %
    And the suggested contribution is 562,500 COP per period for the 8 periods from 2026-11 to 2027-06

  Scenario: The suggestion counts the account's yield
    Given the goal "Viaje Cartagena" with 1,500,000 COP saved on 2026-10-31
    And "Ahorro viaje" yields "9.5" % E.A.
    When "Ana" requests the goal
    Then the suggested contribution is 536,336 COP per period

  Scenario: A goal that is behind
    Given the goal "Viaje Cartagena" started on 2026-07-01 with 1,500,000 COP saved on 2026-10-31
    When "Ana" requests the goal on 2026-10-31
    Then the expected amount by that day is 2,010,989 COP
    And the goal is "BEHIND" by 510,989 COP

  Scenario: A shared goal shows contributions per member
    Given "Household" has the goal "Colchón" with a target of 3,000,000 COP linked to savings accounts of "Ana" and "Juan"
    And since its start "Ana" transferred 900,000 COP and "Juan" 600,000 COP into those accounts
    When "Juan" requests the goal
    Then it shows 1,500,000 COP saved, with 900,000 COP from "Ana" and 600,000 COP from "Juan"
    And it does not show the balance of the personal account of "Ana"

  Scenario: Scheduled contributions reuse recurrences
    When "Ana" schedules 562,500 COP per month for "Viaje Cartagena" from "Bancolombia" starting 2026-11-01
    Then a recurring transfer from "Bancolombia" to "Ahorro viaje" with schedule MONTHLY(1) is defined

  Scenario: Viewers cannot create shared goals
    Given "Sofi" is VIEWER of "Household"
    When "Sofi" creates a goal in "Household"
    Then the result is the error "InsufficientRole"
```

**Technical notes:**
- `Goal`: name, emoji or photo, target amount, optional target date, space (personal or shared) and source: one or more linked accounts, or a virtual earmark inside one account. Whether it lives in `accounts` or in a new `goals` module is decided at design time.
- Formulas:
  - `saved = starting amount + Σ transfers into the linked accounts since the start − Σ transfers out of them`;
  - `progress = saved / target`;
  - suggested contribution `= (target − saved) / periods left`, where the periods left are those of the space's period policy from the next period through the one that contains the target date;
  - with a yield `i_m` per period: `contribution = (FV − S · (1 + i_m)^n) · i_m / ((1 + i_m)^n − 1)`, with `FV` the target, `S` the amount saved and `n` the periods left (9.5 % E.A. is 0.7592 % per month);
  - status `ON_TRACK` when `saved ≥ target · (days elapsed / total days)`, `BEHIND` otherwise, `REACHED` when `saved ≥ target`.
- In a shared goal each member's contribution is the sum of their transfers into the linked accounts. Other members see contributions only, never the balance of someone's personal account (D9).
- Scheduled contributions are recurring transfers (HU-E4-11). A SAVINGS budget line (spec 5.2 `savingsAccountIds`) may point to the goal's accounts.
- Endpoints: `POST /api/v1/spaces/{spaceId}/goals`, `GET .../goals`, `GET .../goals/{goalId}` (progress, suggestion, status, contributions per member), `PATCH .../goals/{goalId}`. Creating a goal in a shared space is `money.record` (OWNER, ADMIN, MEMBER).
- References: Nu's "cajitas" with a target and a deadline simulator, Nequi's goals and pockets, Monarch's shared goals over separate accounts.
- **Spec impact:** 5.2 (new `Goal` entity; `BudgetLine` with SAVINGS funding may reference a goal), 5.4 (goal metrics).

---

## HU-E8-15 — Debts with people outside my spaces

- **Milestone:** M5 · **Priority:** Could · **Size:** S · **Depends on:** HU-E2-05, HU-E2-07, HU-E4-03, HU-E5-01 · **Module(s):** `accounts`, `ledger`, `balances`

**User story:** As a user, I want to track the money I lent to or borrowed from people who are not in my spaces, so that I remember who owes me and whom I owe without inventing expenses or income.

```gherkin
Feature: Debts with outside people

  Scenario: Lending is a transfer
    When "Ana" lends 200,000 COP from "Bancolombia" to "Carlos" on 2026-10-16, expected back by 2026-12-15
    Then the account "Carlos" of type "PERSON_DEBT" with direction "OWED_TO_ME" has a balance of 200,000 COP
    And the transfer has no category and her period expense total is unchanged
    And her net worth is unchanged and her available money decreased by 200,000 COP

  Scenario: A partial repayment
    Given "Carlos" owes "Ana" 200,000 COP
    When "Ana" records that "Carlos" repaid 50,000 COP into "Bancolombia"
    Then a transfer from "Carlos" to "Bancolombia" is recorded
    And "Carlos" has a balance of 150,000 COP and no income is recorded

  Scenario: Borrowing from someone
    When "Ana" borrows 300,000 COP from "Laura" into "Bancolombia"
    Then the account "Laura" with direction "OWED_BY_ME" has a balance of -300,000 COP
    And her net worth is unchanged

  Scenario: One overview, separate rules
    Given "Carlos" owes "Ana" 150,000 COP, "Ana" owes "Laura" 300,000 COP and "Juan" owes "Ana" 230,500 COP in "Household"
    When "Ana" requests her debts
    Then they list "Carlos" (owes you 150,000 COP, expected 2026-12-15), "Laura" (you owe 300,000 COP) and her loan "Crédito libre inversión"
    And a separate section lists "Juan" owing 230,500 COP in "Household"

  Scenario: An outside person never takes part in a split
    When "Ana" records an expense in "Household" split with "Carlos"
    Then the result is the error "NotASpaceMember"
```

**Technical notes:**
- New account type `PERSON_DEBT`, personal spaces only, with `direction` (`OWED_TO_ME`, an asset, or `OWED_BY_ME`, a liability; immutable like the type), `counterpartyName` and an optional `expectedDate` with a reminder (HU-E8-16). By default it counts in net worth and not in available money (HU-E2-07).
- Lending, borrowing and repaying are transfers (HU-E4-03), so they are neither spending nor income. Forgiving the rest of a debt is an expense paid from the PERSON_DEBT account.
- Outside people are not guests: a guest (D15) is a space member who takes part in splits and balances, while an outside debt is a personal record that no other member sees. To split with someone, use a guest or a direct space (HU-E1-10, HU-E1-13).
- `GET /api/v1/me/debts` gathers the PERSON_DEBT and LOAN accounts and the in-space balances of E5 (HU-E5-01) in separate sections, each keeping its own rules.
- Habeas data: a counterparty's name is personal data of a third party (Ley 1581 de 2012). Hearth stores a display name only, with no contact data, and never shows these records to other members.
- **Spec impact:** 5.2 **Account** (type `PERSON_DEBT` with direction and counterparty), 5.4 (the debts overview as a read model).

---

## HU-E8-16 — Reminders for card dates, CDT maturity and recurrences

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E1-14, HU-E2-06, HU-E4-12, HU-E4-13, HU-E8-08 · **Module(s):** `accounts`, `ledger`, `identity`, `shared/infrastructure`

**User story:** As a user, I want reminders before my card's cut-off and payment dates, my CDT's maturity and my recurring payments, so that I never pay late or miss a decision.

```gherkin
Feature: Reminders

  Scenario: Card payment due
    Given "Ana" has the timezone "America/Bogota" and "Visa" has payment day 15
    When the reminder job runs on 2026-11-12
    Then "Ana" receives "CardPaymentDue" for "Visa", due 2026-11-15, with its balance owed, at 08:00 America/Bogota (13:00Z)

  Scenario: Cut-off reminders follow clamped days
    Given "Visa" has cut-off day 31
    When the reminder job runs on 2026-11-30
    Then "Ana" receives "CardCutOff" for "Visa" with the cut-off date 2026-11-30

  Scenario: CDT maturity a week ahead
    Given "CDT Davivienda" matures on 2027-04-14
    When the reminder job runs on 2027-04-07
    Then "Ana" receives "TermDepositMaturing" with the projected value 10,439,413 COP and the choices to renew or to move it to an account

  Scenario: Recurrences
    Given the AUTO recurrence "Rent" created by "Ana" with schedule MONTHLY(1)
    And the CONFIRM recurrence "Electricity" paid by "Ana" with schedule MONTHLY(10)
    When the reminder job runs on 2026-11-30
    Then "Ana" receives "UpcomingRecurrence" for the "Rent" of 2026-12-01
    When the "Electricity" occurrence of 2026-12-10 becomes pending
    Then "Ana" receives "PendingOccurrence" for "Electricity"

  Scenario: Each user gets the local hour
    Given "Juan" has the timezone "Europe/Madrid" and his card "Mastercard" has payment day 15
    When the reminder job runs on 2026-11-12
    Then "Juan" receives "CardPaymentDue" at 08:00 Europe/Madrid (07:00Z)

  Scenario: Exactly once, and only when wanted
    When the reminder job runs twice on 2026-11-12
    Then "Ana" receives one "CardPaymentDue" for "Visa"
    When "Ana" turns off "CardCutOff" and the reminder job runs on 2026-11-30
    Then "Ana" receives no "CardCutOff"
```

**Technical notes:**
- Kinds and default timing: `CardCutOff` (on the cut-off day), `CardPaymentDue` (3 days before the payment day), `TermDepositMaturing` (7 days before maturity), `PendingOccurrence` (when a CONFIRM occurrence becomes pending, to its payer or, for fund-paid ones, its creator), `UpcomingRecurrence` (the day before an AUTO occurrence, to its creator) and `PersonDebtExpected` (on the expected date of HU-E8-15). Lead days are editable per kind.
- Delivery at 08:00 in the recipient's time zone (HU-E1-14); billing days clamp to the month's last day (HU-E2-06). Idempotent per (user, kind, subject, due date).
- Runs on the `Scheduler` port of M3-C and sends through the `Notifier` port of HU-E8-08. Channels: Web Push (VAPID) when the user subscribed, and email (`EmailSender`) as the fallback. On iOS, Web Push works only for the web app added to the home screen (iOS 16.4 or later) and after a tap by the user, so it depends on the PWA of HU-E8-07 there.
- Messages are a code plus parameters; the channel adapter renders them in the user's locale (HU-E9-02).
- Preferences per kind (on or off, lead days) live on the profile: `PATCH /api/v1/me` (HU-E1-14, HU-E8-08).
- **Spec impact:** 5.2 **User** (reminder preferences), section 7 (Web Push subscription endpoint), section 9 (a reminders job beside the recurrence job).

---

## HU-E8-17 — Net worth over time

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E2-04, HU-E2-07 · **Module(s):** `accounts`, `ledger`

**User story:** As a user, I want my net worth at the end of each period, split into assets and debts, so that I see whether I am building wealth.

```gherkin
Feature: Net worth history

  Scenario: A series computed from the balances at each period end
    Given the personal space of "Ana" has the period policy MONTHLY(1) and these balances at each period end:
      | account                 | 2026-10-31 | 2026-11-30 | 2026-12-31 |
      | Bancolombia             | 2,000,000  | 2,400,000  | 2,900,000  |
      | Visa                    | -350,000   | -500,000   | -200,000   |
      | Ahorro                  | 10,000,000 | 10,000,000 | 10,000,000 |
      | Crédito libre inversión | -8,000,000 | -7,600,000 | -7,200,000 |
    When "Ana" requests her net worth for the 3 periods ending 2026-12
    Then the series is:
      | period end | assets     | debts     | net worth |
      | 2026-10-31 | 12,000,000 | 8,350,000 | 3,650,000 |
      | 2026-11-30 | 12,400,000 | 8,100,000 | 4,300,000 |
      | 2026-12-31 | 12,900,000 | 7,400,000 | 5,500,000 |

  Scenario: Manual valuations for investments
    Given the INVESTMENT account "FIC Bancolombia" received contributions of 1,000,000 COP before 2026-10-31
    And "Ana" valued it at 1,080,000 COP on 2026-11-30
    And she contributed 100,000 COP more on 2026-12-10
    When "Ana" requests her net worth for the 3 periods ending 2026-12
    Then "FIC Bancolombia" counts 1,000,000 COP at 2026-10-31, 1,080,000 COP at 2026-11-30 and 1,180,000 COP at 2026-12-31

  Scenario: Accounts excluded from net worth stay out
    Given "Nequi" is excluded from net worth
    When "Ana" requests her net worth history
    Then "Nequi" counts in no point of the series

  Scenario: Points follow the period policy
    Given the personal space of "Ana" has the period policy MONTHLY(25)
    When "Ana" requests her net worth for the 3 periods ending 2026-12
    Then the points are at 2026-10-24, 2026-11-24 and 2026-12-24

  Scenario: Corrections change the history
    Given the series above
    When "Ana" corrects an expense of 2026-10-05 paid from "Bancolombia" from 85,000 COP to 95,000 COP
    Then every point from 2026-10-31 on is 10,000 COP lower
```

**Technical notes:**
- Computed on read (D7) from the `asOf` balances (HU-E2-04) at each period end of the space's policy (spec 5.3), over the accounts that count in net worth now (the switches have no history). `assets = Σ balances ≥ 0`, `debts = Σ |balances < 0|`, `netWorth = assets − debts`.
- Manual valuations: `AccountValuation` (account, date, value) for INVESTMENT and OTHER accounts. The value at a date is the latest valuation on or before it, plus the net transfers into the account after that valuation; an account without a valuation counts its ledger balance. Term deposits count their accrued net interest once HU-E8-12 is done.
- Only valuations are stored. The research's monthly snapshots (`NetWorthSnapshot`) are not adopted: D7 keeps every figure on read until a materialized view is measured to be needed.
- Endpoint: `GET /api/v1/spaces/{spaceId}/reports/net-worth?endPeriod=<label>&periods=<n>`; `POST .../accounts/{accountId}/valuations`. An area chart of assets and debts is a later E9 story.
- With multi-currency (HU-E8-06), each point would convert with the TRM of its date.
- **Spec impact:** 5.2 (new `AccountValuation`), 5.4 (net worth series).

---

## HU-E8-18 — Installation rules for a white-label deployment

- **Milestone:** M5 · **Priority:** Should · **Size:** M · **Depends on:** HU-E1-14, HU-E1-15 · **Module(s):** `identity`

**User story:** As the installation administrator, I want to set the brand, the defaults and the locks of my deployment, so that Hearth runs as my own product and the people who use it start from the formats and region I chose.

```gherkin
Feature: Installation rules

  Background:
    Given the installation rules are the built-in ones: brand name "Hearth", numberFormat "DOT_COMMA", timeFormat "H24", dateFormat "DMY", weekStart "MONDAY", timezone "America/Bogota", locale "es", newSpaceCurrency "COP" and no locks
    And "Ana" is an installation administrator

  Scenario: The brand name and accent are shown to everyone
    When "Ana" sets the brand name "Casa Gómez" and the accent color "PLUM"
    Then a visitor without a session who requests "GET /api/v1/installation" receives the brand name "Casa Gómez" and the accent color "PLUM"
    And a signed-in user receives the same brand

  Scenario: A default applies to people without an override
    Given "Juan" has stored the timeFormat "H24" and "Luis" has stored no preference
    When "Ana" sets the default timeFormat to "H12" and the default numberFormat to "COMMA_DOT"
    Then the effective timeFormat is "H12" for "Luis" and "H24" for "Juan"
    And the effective numberFormat is "COMMA_DOT" for both, because neither stored one

  Scenario: Locking a field takes away the choice and keeps people on the rule
    Given "Juan" has stored the dateFormat "MDY"
    When "Ana" locks the dateFormat
    Then "Juan" has the effective dateFormat "DMY" and "GET /api/v1/me" lists "dateFormat" among his locked preferences
    And "Juan" setting his dateFormat fails with status 409 and the code "PreferenceLocked"
    When "Ana" lifts the lock
    Then "Juan" has the effective dateFormat "MDY" again

  Scenario: Only an installation administrator can change the rules
    Given "Juan" is an ordinary user
    When "Juan" updates the brand name to "Casa Juan"
    Then the result is the error "InstallationAdminRequired"
    And the brand name is unchanged
    When a visitor without a session sends the same update
    Then the request fails with status 401 and the code "Unauthenticated"

  Scenario: The currency default applies only to new spaces
    Given "Ana" has the shared space "Household" with the currency "COP"
    When "Ana" sets the default newSpaceCurrency to "USD"
    Then "Household" keeps the currency "COP"
    And "Juan" creating the shared space "Trip" without a currency gets "USD"
    And a user who signs up afterwards gets a personal space in "USD"

  Scenario: Every change is audited
    When "Ana" changes the brand name from "Hearth" to "Casa Gómez" and locks the weekStart
    Then "GET /api/v1/installation/audit" lists two entries, one per changed field and newest first, each with "Ana", the instant, the field and the values before and after
    And "Juan", an ordinary user, requesting the audit gets the error "InstallationAdminRequired"
```

**Technical notes:**
- Use cases: `GetInstallationRules` (a public query, also called by the profile query of HU-E1-15, by sign-up and by `spaces`), `UpdateInstallationRules`, `SetInstallationLogo`, `RemoveInstallationLogo`, `ListInstallationAudit` and `GrantInstallationAdmin`. Endpoints: `GET /api/v1/installation` (a public route like `GET /api/v1/health`), `PATCH /api/v1/installation` (honours `If-Match`, 412 on a stale ETag, HU-E0-10), `PUT` and `DELETE /api/v1/installation/logo`, `GET /api/v1/installation/logo` (public) and `GET /api/v1/installation/audit` (cursor pagination, HU-E0-10).
- Model: one `InstallationSettings` record, inserted by the migration with the built-in values, so the cascade works before anyone edits it:
  - brand: `brandName` (1–40 characters), `logo` (optional image) and `accentColor` (a palette key of HU-E3-05, never a hex value);
  - defaults: `numberFormat`, `timeFormat`, `dateFormat`, `weekStart` (HU-E1-15), `timezone` (an IANA zone, valid as in HU-E1-14), `locale` (the UI language, `es` or `en`) and `newSpaceCurrency` (a supported ISO 4217 currency, as in HU-E1-04);
  - `lockedFields`: the person-level fields that people may not change, any of `numberFormat`, `timeFormat`, `dateFormat`, `weekStart`, `timezone` and `locale`.
- The cascade (decided 2026-10-16): installation rules → space (currency, period policy) → person (formats, time zone, theme, language), except what the rules lock. The effective value of a person's field is the rule when the field is locked, otherwise the stored value, otherwise the rule. A lock never deletes stored values, so lifting it brings them back. This story replaces the built-in adapter of `InstallationRulesReader` (HU-E1-15), so `GET /api/v1/me` reports the real defaults and locks, and `GET /api/v1/me` also returns `installationAdmin`.
- Time zone and language are concrete values per person, not "follow the rule" values: the defaults are the sign-up fallbacks, replacing the literal `es` of HU-E1-01 and the `APP_TIMEZONE` fallback of HU-E1-14, and a lock makes the rule the effective value and ignores the browser's zone at sign-up. `APP_TIMEZONE` seeds the installation `timezone` at first boot and still drives the space-level clocks. Changing a default never rewrites stored values. The theme (light, dark or system) is a device setting of the settings screen (HU-E9-13), outside the rules and not lockable.
- Space level: `newSpaceCurrency` is the default when `POST /api/v1/spaces` omits the currency (HU-E1-04) and the currency of the personal space created at sign-up (HU-E1-02); `spaces` reads it through the public query. A space's currency stays immutable once it has transactions (HU-E1-03), and its period policy stays a space decision. The built-in values equal the literals they replace (`es`, `COP`), so HU-E1-01 and HU-E1-02 behave as delivered until an administrator edits the rules.
- Role: `User.installationRole` is `ADMIN` or null, separate from the space roles of HU-E1-05; no space role grants it, and the use cases check it (`InstallationAdminRequired`, 403), never only the handler. Proposed bootstrap: the operator grants it to an existing user by email with a script run inside the app container (`GrantInstallationAdmin`, with a revoke option); no HTTP endpoint grants it and sign-up never does. The first user is not made administrator automatically, because on a public deployment a stranger could sign up before the owner; an environment variable of emails is not used either, because sign-up does not verify email, so whoever registered that address first would gain the role.
- Placement: the story lives in `identity` and not in a new `installation` module. The role is an attribute of the user, and the profile query of `identity` reads the rules to compute effective values; a separate module would depend on `identity` for the role and `identity` on it for the rules, a cycle. `spaces` consumes the rules through the public query.
- Logo: PNG, JPEG or WebP up to 256 KB, checked by its content and not by its file name, stored in the settings record and served with an `ETag`. SVG is not accepted, because it can carry scripts. A rejected file answers `InvalidLogo` (422); other invalid input answers `ValidationFailed`, `InvalidTimeZone` or `UnsupportedCurrency`.
- Audit: every change is an entry in an append-only `installation_audit` table written through an `InstallationAuditLog` port (the `AuditLog` of HU-E4-06 belongs to `ledger`). Entries are never edited or deleted, and each keeps only the logical change: actor, instant, field, and the values before and after; a logo change records the content hash of the image, never its bytes.
- Out of scope: a brand name per language, branding per space, several installations in one database, custom domains and email templates. The screen is HU-E9-14.
- **Spec impact:** 5.2 (new `InstallationSettings`; **User** gains `installationRole`), section 3 (`APP_TIMEZONE` seeds the installation time zone), section 6 (a new decision: a rules level above spaces and people for white-label deployments, with the cascade and the locks), section 7 (the installation endpoints and a public route).

## HU-E8-19 — Regional vocabulary variants of the interface language

- **Milestone:** M5 · **Priority:** Could · **Size:** M · **Depends on:** HU-E9-02, HU-E1-15, HU-E8-18 · **Module(s):** `identity`, web UI (`src/i18n`)

**User story:** As a person who uses Hearth in my own country, I want the app to talk about money with the words people use where I live, so that settling up and splitting read naturally to me and to my household.

```gherkin
Feature: Regional vocabulary variants

  Background:
    Given the base Spanish says "Para quedar saldados" for the balances suggestions heading
    And the "es-CO" variant replaces it with "Para quedar a paz y salvo"
    And the "es-MX" variant replaces it with "Para quedar a mano"
    And the installation rules have numberFormat "DOT_COMMA" and no locks

  Scenario: A variant replaces only the words in its glossary
    Given "Ana" has the locale "es-CO"
    When "Ana" opens the balances screen
    Then the suggestions heading reads "Para quedar a paz y salvo"
    And every text the "es-CO" variant does not define reads as in the base Spanish

  Scenario: A variant never changes formats
    Given "Juan" has the locale "es-MX" and stores no numberFormat
    When "Juan" opens the balances screen
    Then the suggestions heading reads "Para quedar a mano"
    And amounts are written as "$ 100.000", following his effective numberFormat "DOT_COMMA"

  Scenario: An unsupported region falls back to its base language
    Given a visitor without a session whose browser sends "Accept-Language: es-PE, en;q=0.5"
    When the visitor opens the sign-in screen
    Then the screen is in the base Spanish

  Scenario: The browser's region chooses a supported variant
    Given a visitor without a session whose browser sends "Accept-Language: es-MX"
    When the visitor opens the sign-in screen
    Then the screen is in the "es-MX" variant

  Scenario: A person chooses a variant in Settings
    Given "Ana" has the locale "es"
    When "Ana" sets her locale to "es-CO"
    Then "GET /api/v1/me" returns the locale "es-CO"
    When "Ana" sets her locale to "es-XX"
    Then the request fails with status 422 and the code "ValidationFailed"
    And "Ana" keeps the locale "es-CO"

  Scenario: The installation default can be a variant
    Given the installation administrator has set the default locale to "es-CO"
    When "Luis" signs up without sending a locale
    Then "Luis" is created with the locale "es-CO"
```

**Technical notes:**
- Decision D24. `LOCALES` grows from `es`, `en` to `es`, `es-CO`, `es-MX`, `es-AR`, `en` in `src/i18n/locale.ts` and in identity's mirror of it; `PATCH /api/v1/me`, the sign-up body (P142) and the installation rules' `locale` (HU-E8-18) accept the new values. The stored values `es` and `en` stay valid, so no migration rewrites anyone's language.
- Messages: `es.json` stays the complete, neutral base. Each variant is a small overlay (`es-CO.json`, `es-MX.json`, `es-AR.json`) merged over the base when `src/i18n/request.ts` loads messages, so a key the overlay does not define falls back to the base.
- Glossary: the keys a variant may replace are listed in one closed glossary (money and debt verbs, settling up, splitting, everyday expressions; about 20 to 40 keys). A unit test fails when an overlay defines a key outside the glossary or a key the base does not have, so overlays stay vocabulary, never grammar.
- Grammar: every Spanish variant addresses the user with "tú" (the rule of `es.json`); `es-AR` does not use voseo, because that would rewrite the grammar of every string.
- Resolution (amends ruling P120): `resolveLocale` keeps the region of `Accept-Language` and of the cookie. A supported variant wins; an unsupported region (`es-PE`) falls back to its base language (`es`); an unsupported language keeps today's fallback to Spanish.
- Formats stay independent (D23 and ruling P121): a variant never sets a number, date or time format, and `src/shared/ui/format/` never reads the locale.
- Today's `es.json` already carries Colombian jargon ("paz y salvo"). This story moves those expressions to `es-CO.json`, writes neutral wording in the base, and sets the built-in installation default to `es-CO`, so a Colombian installation reads exactly as it does today.
- Settings (HU-E9-13): the language row lists "Español (Colombia)", "Español (México)", "Español (Argentina)", "Español (neutro)" and "English".
- Open question for the owner: the Mexican and Argentine wording of each glossary key needs a native speaker's review before those overlays ship; `es-CO` can ship first, alone.
- Out of scope: regional variants of English, a glossary per installation (rejected in D24) and per-space vocabulary.
- **Spec impact:** section 3 (UI i18n names the variants), 5.2 (**User** `locale` values), section 6 (D24, already recorded), section 7 (`locale` values of `PATCH /api/v1/me`, sign-up and the installation rules).
