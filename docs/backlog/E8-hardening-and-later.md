# E8 — Hardening and later

**Goal:** make the self-hosted deployment safe to rely on (backups, observability) and capture post-v1 capabilities so they are designed for, not designed out.

**Modules involved:** deployment/operations, `shared/infrastructure`, `ledger` (recurring, imports), cross-cutting for deferred items.

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

---

## HU-E8-02 — Structured logging and health check

- **Milestone:** M5 · **Priority:** Should · **Size:** M · **Depends on:** HU-E0-07 · **Module(s):** `shared/infrastructure`, `app`

**User story:** As the owner, I want structured logs with request ids and a health endpoint, so that I can diagnose failures and know when the app is down.

```gherkin
Feature: Observability

  Scenario: Every request is logged with a request id
    When a user loads the dashboard
    Then a JSON log line is written with "level", "requestId", "route", "durationMs" and "status"

  Scenario: Unexpected errors show a generic message with the request id
    Given a use case fails with an unexpected database error
    When the user submits the form
    Then the user sees a generic error message containing the request id
    And the log line for that request id contains the error stack

  Scenario: Health check reports healthy
    When a client requests "GET /api/health"
    Then the response status is 200 and the body reports "db": "ok"

  Scenario: Health check reports database failure
    Given PostgreSQL is unreachable
    When a client requests "GET /api/health"
    Then the response status is 503 and the body reports "db": "unreachable"

  Scenario: Sensitive data is not logged
    When a user signs in
    Then no log line contains the password, session token or email address
```

**Technical notes:**
- `Logger` port in `shared/infrastructure` (pino adapter); request id from header or generated.
- Docker health check uses `/api/health`; Caddy only routes to healthy containers.

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
- Upload file size limit 5 MB; parsing happens server-side.

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
- Use case: `ImportSplitwiseGroup`; adapter parses the Splitwise CSV export format.
- Settlements in the export become `SETTLEMENT` transactions.
- A Splitwise member may be mapped to an existing or new guest (HU-E1-10); payments imported for a guest carry no account.

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

---

## HU-E8-07 — Installable PWA with offline read

- **Milestone:** M5 · **Priority:** Won't-v1 · **Size:** M · **Depends on:** HU-E7-04 · **Module(s):** `app`

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
