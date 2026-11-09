# UX audit, pass 3: main after the November release

- **Status:** Diagnosis, pass 3 (2026-11-08). No finding is on the board yet. Each recommendation needs the owner's decision first, as in passes 1 and 2.
- **Build audited:** `main` at `d6caf292` (merge of PR #280, the release of #272–#275). The tree is identical to `development` at `3d75e538`.
- **How it was served:** a local standalone build, with the API on :3500 and the SPA preview on :3600. It ran against a disposable PostgreSQL. The clock was fixed at 2026-11-08 15:00 UTC (America/Bogota).
- **Method:** a heuristic and task-based audit with seeded personas; this is not a study with real people.
  - Five real-browser passes, each run by a Haiku agent in the desktop app's built-in browser. The agent took screenshots, looked at them, and measured every screen: horizontal overflow, targets under 44 px, unlabeled controls, a way back.
  - Viewports: 390×844, 375×812, 375×667 and 320×640, dark and light. "Desktop" was the browser pane at 658×630.
  - Every root cause below was checked against the code at `main`.
- **Limitations:**
  - Claude in Chrome could not open a tab group ("No group with id"), so no pass ran at a real desktop width.
  - Mouse clicks in the pane were sometimes ignored. The agents retried those controls with references or Enter, so tap counts are approximate. The flakiness of the space switcher (A22) is not proven to be the app's.
  - In the e2e server the recurrence job is off (`RECURRENCE_JOB_INTERVAL_SECONDS=0`). For A9 the API was restarted over the same database with the job on.
  - Production was not touched, beyond reading its public `GET /api/v1/auth/sign-up` and `/health`.
- **Related:** [pass 1, 2026-10-28](2026-10-28-ux-audit.md) and [pass 2, 2026-11-06](2026-11-06-ux-audit-production.md).

## How to read this

Same tags and priorities as passes 1 and 2:

- **Verified:** reproduced in the running app, with a screenshot or a measurement, and where it matters the line of code.
- **Hypothesis:** the behavior is verified, but whether it hurts real people needs data this audit does not have.
- **Opportunity:** not a defect; something worth exploring.

Priority weighs impact × frequency × severity × confidence in the evidence, against effort. P1 = fix next; P2 = plan it; P3 = when convenient. IDs start with A, so they do not collide with pass 1's F or pass 2's H and M.

## Personas seeded

| Persona | Role | What was set up |
|---|---|---|
| Ana | OWNER of Personal, "Hogar" and "Viaje Cartagena" | Personal: Bancolombia 2,000,000, salary, four expenses (one with no description), a 200,000 transfer to Ahorros, an active November plan (Mercado, Salidas, Ahorro, Todo lo demás as catch-all), a Netflix AUTO recurrence. Hogar: a 1,500,000 fund, an active plan with capacities 1,600,000 / 2,400,000, expenses by Ana and Juan, a fund contribution, an "Energía" CONFIRM recurrence, a pending email invitation. A direct split with guest Mateo. |
| Juan | ADMIN of Hogar | His own Davivienda; two Hogar expenses. |
| Sofi | VIEWER of Hogar | Nothing recorded. |
| Luis | MEMBER of Viaje Cartagena | A three-way dinner. |
| Pedro | Guest in Viaje Cartagena | Paid the 900,000 hotel outside the app, split three ways. |
| Carla | New person | Signed up, nothing else. |
| Diana | New person | Signed up through the UI during pass 1. |

## 1. Executive summary

The app is stable and its basics are sound:

- No horizontal scroll and no target under 44 px on any measured screen at 390 or 320 px, in either theme.
- Contrast passes AA on every element measured in light.
- Undo works after a delete, and the space switcher states each balance in one line.
- Settling up reads in plain sentences.
- M6, the planner that trapped the person, stays fixed: every Volver led out.

The weak points are three, and they repeat pass 2's theme of **trust in the numbers**, plus a new one in navigation:

1. **Saving is out of reach on small phones.** On a 375×667 or 320×640 screen, the save button of the expense, income and edit forms is below the fold, and the transfer's is cut off (A1). Pass 2's M1 now covers four forms.
2. **The figures change meaning between screens.**
   - "Disponible" in the Plan counts savings not yet moved as spendable (A3, pass 2's H2, still open).
   - The same space's spending reads as Ana's share on Inicio and as the whole space's on Movimientos (A6).
   - The same person is "Al día" in one tab of the plan and short by $ 440,000 in another (A5).
   - A settlement received still lands in no account (A2, pass 2's H1).
3. **The shared plan has no door.** Since Plan left the bottom bar (P311), a shared space's plan is reached only through its ⚙ Configuración. Haiku did not find it unaided in two passes (A4).

## 2. Strengths to keep

| Strength | Evidence |
|---|---|
| Reflow and targets | No overflow and no target under 44 px at 390 and 320 px; no unlabeled control except Editar cuenta's archive icon (A19). |
| Settling up reads as sentences | "Juan le paga $ 311.400 a Ana" · "Saldar solo prellena el formulario." · "Pedro es invitado: pagó fuera de la app, así que no hay cuenta que elegir." |
| The space switcher | Each row names who is in the space and its balance: "Hogar · Ana, Juan, Sofi y Rosa · Te toca recibir $ 311.400". |
| Safe deletes | "Gasto eliminado · Deshacer" restores the movement in place ("Gasto restaurado"). |
| Confirming a variable bill | "Sugerido: $ 180.000", then "$ 7.700 menos que lo sugerido" as the real amount is typed; "Omitir salta solo esta fecha". |
| Roles explained where they are named | The invitation's role list ("Lector · Solo ve movimientos, saldos y tableros") and the guest sheet ("No inicia sesión"). |
| Way back | Every Volver led out: line → planner → Plan → Inicio. M6 stays fixed. |
| Split check | "Suma $ 60.000: cuadra con el gasto". |
| Language | English Inicio carries no Spanish UI text; switching is instant and reversible. |
| Sign-up | A short form with the 8-character hint and no email gate; first steps tick off live. |

## 3. Findings

Ordered by priority. Each field follows the audit brief: problem, who, context, evidence, root cause (with its certainty), consequence, solution, priority, effort, metric, validation.

### A1. On a small phone the save button is below the fold in four forms · P1 · Verified

- **Problem:** the save button is out of view without scrolling the sheet. Positions are in px; the screen is 667 px tall at 375×667.

  | Form | Button position | 375×667 | 320×640 |
  |---|---|---|---|
  | Registrar · Gasto | 732–788 | Hidden | Hidden |
  | Registrar · Ingreso | 672–728 | Hidden | Hidden |
  | Registrar · Transferencia | 630–686 | Shows only 37 px | Shows only about 10 px |
  | Editar movimiento | 746–802 | Hidden | Hidden |
  | Editar cuenta | 1177 | Hidden | Hidden |

  At 390×844 the three Registrar buttons fit. Editar movimiento and Editar cuenta still need a scroll there.
- **Who:** everyone on an iPhone SE / 8-class phone, or a small Android, on the most frequent job.
- **Context:** recording at the moment of paying, standing up, one hand.
- **Evidence:** pass 2 measurements at 375×667 and 320×640. Saldar's "Guardar pago" stays in view at 375×812 and 320×640 (pass 3).
- **Root cause (high certainty):** the record sheet is a single scrolling column with no footer ([`record-sheet.tsx:60`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/record-sheet.tsx#L60), `overflow-y-auto` on the whole section). Saldar's sheet passes a `footer` ([`settle-up-sheet.tsx:218`](https://github.com/Facabore/Hearth/blob/main/src/modules/balances/ui/settle-up-sheet.tsx#L218)), which stays pinned.
- **Consequence:** an extra scroll on every record. There is also a risk of leaving believing it was saved; on a 320 px phone the transfer's button is a 10 px sliver.
- **Solution:** pin each form's primary action in a sheet footer, as Saldar does, and let the fields scroll above it. Apply it to Registrar's three modes and to the edit pages.
- **Priority:** P1. It hits the most frequent task on a common class of phone, and the fix is a known pattern already in the app.
- **Effort:** low to medium. One shared sheet change, then a check of the keypad's height at 320×640.
- **Metric:** share of records started and not saved, by viewport height (needs the minimum events of §5).
- **Validation:** an e2e at 375×667 and 320×640 asserting each primary button lies inside the viewport. Then a re-run of the five-second "save this expense" task.

### A2. A settlement the person receives still lands in no account · P1 · Verified (pass 2's H1)

- **Problem:** in "Saldar otro monto", when the person receives the money, "Llega a (opcional)" is preselected as "Ninguna". When the person pays, "Sale de (opcional)" preselects an account, so the two directions behave differently.
- **Who:** whoever is paid back. When a guest pays, the person is always the receiver.
- **Context:** settling up from Saldos.
- **Evidence:** pass 3 at 375×812: suggestion sheet "Sale de · Bancolombia"; free form "Llega a · Ninguna". In code, only the source is preselected ([`settle-up-sheet.tsx:93-96`](https://github.com/Facabore/Hearth/blob/main/src/modules/balances/ui/settle-up-sheet.tsx#L93-L96): `sourceAccountId: … preferredAccountId(…)`, with no counterpart for `destinationAccountId`).
- **Root cause (high certainty):** the draft never chooses a destination.
- **Consequence:** available money and net worth drift silently, and the error shows far from its cause (pass 2 measured −3,500,000 on the owner's net worth).
- **Solution:** preselect the destination the same way as the source: the last account used, else the first non-savings one. Say where the money goes beside the button: "Llega a Bancolombia · Cambiar".
- **Priority:** P1: a money-trust defect with a one-line cause.
- **Effort:** low.
- **Metric:** share of settlements where the viewer receives and no destination is set.
- **Validation:** a component test of the default; a database query before and after.

### A3. "Disponible" counts savings not yet moved as money to spend · P1 · Verified (pass 2's H2)

- **Problem:** the Plan headline is a figure no other line on the screen adds up to.
  - **Personal:** "Disponible $ 1.039.500" included 100,000 of the Ahorro line not yet transferred. After the transfer it read $ 921,000, which is what is left across the spending lines.
  - **Hogar:** "Disponible $ 1.816.000" sits over "Gastado $ 1.884.000 de $ 3.400.000". 3,400,000 − 1,884,000 = 1,516,000; the 300,000 difference is the Ahorro line's own "Disponible $ 300.000".
  - Configuración repeats it: "Plan del mes · Quedan $ 1.816.000".
- **Who:** whoever follows a plan; the household asking "how much is left for this month".
- **Context:** checking the month before spending.
- **Evidence:** passes 2 and 3; [`line-dashboard.tsx:42-57`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/lines/line-dashboard.tsx#L42-L57). The "Gastado … de …" line reads `totals.withoutSavings` (ruling P262), while the headline reads `totals.available`, savings included.
- **Root cause (high certainty):** P262 split savings out of "Gastado" but not out of the headline.
- **Consequence:** the most prominent number cannot be reconciled with the screen, and a person may spend money meant for saving.
- **Solution:** head with what is left to spend, from `withoutSavings`. Show savings on its own line: "Ahorro: $ 300.000 de $ 600.000 por mover". Use the same figure in Configuración and Inicio.
- **Priority:** P1: the plan's whole promise is this one number. Pass 2 raised it, and it is still open.
- **Effort:** low (the API already answers `withoutSavings`).
- **Metric:** correct answers to "¿Cuánto puedes gastar todavía este mes?".
- **Validation:** a five-second test with five people; a component test of the headline.

### A4. A shared space's plan can only be found through Configuración · P1 · Verified (finding); Hypothesis (impact on people)

- **Problem:** after P311 ("Más replaces Plan in the bar", `9fdb7a19`), a shared space has no Plan in its bottom bar, its Inicio, its Más tiles or Saldos.
  - The only door is the space's ⚙ "Configuración de Hogar" › "Plan del mes": 2 taps from the space's Inicio, 5 from Personal.
  - The ⚙ is an icon with no visible text.
- **Who:** every member of a household that budgets together; the Plan is that space's reason to exist.
- **Context:** checking or editing the month's plan.
- **Evidence:** Haiku searched the bar, Más, Saldos and the switcher, and found no entry in pass 3 or pass 4; pass 3 had to type the URL. In code, the only link to a shared space's plan is the settings row ([`space-settings-screen.tsx:192`](https://github.com/Facabore/Hearth/blob/main/src/modules/spaces/ui/space-settings/space-settings-screen.tsx#L192)). Personal Inicio does have "Tu plan de noviembre".
- **Root cause (high certainty):** a deliberate navigation change, P311, that gave the plan's place to Más and gave no shared space an equivalent of Personal's "Tu plan del mes" card.
- **Consequence:** the plan is filed under settings, so a feature people use every day reads as configuration. A member who cannot find the plan cannot follow it.
- **Solution, for the owner to choose:**
  - (a) A "Plan del mes" card on a shared space's Inicio, mirroring Personal's.
  - (b) A Plan tile at the top of Más.
  - (c) Keep it in Configuración, but give the ⚙ a visible label.

  (a) restores the habit with no new bar slot.
- **Priority:** P1. It reverses the discoverability of a core job, and an agent with the task in hand failed twice. Whether real members fail is the hypothesis to test.
- **Effort:** low for (a) or (b); check the Inicio route's script budget (ADR 0004).
- **Metric:** share of shared-space sessions that open the Plan; time to reach it.
- **Validation:** a task test with three people: "¿Cuánto les queda para mercado en Hogar?".

### A5. The same person is "Al día" in one tab and short by $ 440.000 in the other · P2 · Verified

- **Problem:** in Hogar's Plan, Miembros reads "Ana · Le faltan $ 440.000" and "Juan · Le faltan $ 1.376.000". Fondo reads Ana "Al día · Esperado $ 480.000 · Aportado $ 500.000 · +$ 20.000" and Juan "Le faltan $ 720.000".
- **Who:** members of a household with a shared fund.
- **Context:** "¿Cuánto me falta poner este mes?"
- **Evidence:** pass 3 at 375×812, verbatim.
- **Root cause (medium certainty):** the tabs measure different things with the same words. Miembros is the share of the plan each member is responsible for, against what they paid; Fondo is the deposits into the fund, against what is expected. Neither tab names its base.
- **Consequence:** a member cannot tell whether they owe anything, which is the question the screen exists to answer.
- **Solution:** name the base in each status, for example "Le faltan $ 440.000 de su parte del plan" against "Al día con el fondo". Or link the Miembros row to a breakdown of the two.
- **Priority:** P2: high confusion, but only for fund households.
- **Effort:** low (copy) to medium (breakdown).
- **Metric:** correct answers to "¿Cuánto le falta poner a Ana?".
- **Validation:** a copy comprehension test with five people.

### A6. A space's figures change meaning from one screen to the next · P2 · Verified

- **Problem:** the same space's spending changes base between screens, and some changes come with no matching row.
  - **Inicio to Movimientos:** Inicio's month card lists "Con otros › Hogar $ 753.600", which is Ana's share. Tapping it opens Hogar's Movimientos headed "Gastos $ 1.884.000", the whole space's.
  - **Personal headline:** "Gastado en noviembre $ 1.409.100" adds Ana's shares from every space.
  - **Totals move with no row:** after confirming Hogar's Energía, Personal's "Con otros" rose by $ 68.920 and Personal's Movimientos gained no row.
- **Who:** anyone with personal and shared money.
- **Context:** checking "how am I doing this month".
- **Evidence:** passes 2 and 5. `GET /me/unified-view?period=2026-11` answers a consumption total of 1,465,600, Ana's shares, matching Inicio's base.
- **Root cause (medium-high certainty):** Inicio, unified since P306/P310, speaks in shares, while a space's Movimientos speaks in space totals, and the link between them does not carry the base.
- **Consequence:** two numbers for one thing; the person stops trusting either.
- **Solution:** when Inicio links into a space, land on the person's share ("Tu parte $ 753.600 de $ 1.884.000"), or label both figures where they meet.
- **Priority:** P2.
- **Effort:** low (label) to medium (a share filter in Movimientos).
- **Metric:** correct answers to "¿Cuánto has gastado tú en Hogar este mes?".
- **Validation:** a five-second test; a component test of the label.

### A7. Mi consumo has no way in · P2 · Verified

- **Problem:** the route `/spaces/{id}/my-consumption` still exists, but nothing links to it. Its "¿Por qué es distinto?", which pass 2 listed as a strength, is unreachable.
- **Who:** anyone who wants to know why "what I spent" differs from "what I paid".
- **Context:** reading Inicio's totals.
- **Evidence:** pass 2 searched Inicio, Más, the avatar menu and Configuración. In code, `myConsumptionHref` is used only by the screen itself, for its own period steps ([`my-consumption-screen.tsx:33-34`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/unified/my-consumption-screen.tsx#L33-L34)).
- **Root cause (high certainty):** P306/P310 rebuilt Inicio with "Solo tú" and "Con otros" and dropped the shortcut.
- **Consequence:** a lost explanation of the paid-versus-consumed gap (pass 1's F3). The orphan route also carries code and a script budget.
- **Solution:** either link it from Inicio's month card ("¿Por qué no coincide con lo que pagaste?") or remove the route and its screen.
- **Priority:** P2: dead surface plus a lost explanation.
- **Effort:** low either way.
- **Metric:** visits to the explanation; support questions about the totals.
- **Validation:** a route-reachability check (every SPA route has an in-app link), added to the e2e.

### A8. The default account is the first in alphabetical order, not where the money is · P2 · Verified

- **Problem:** both new people and members were offered an account they did not use.
  - Diana loaded her opening balance into Efectivo, and her first expense defaulted to "Billetera digital".
  - Juan's Hogar expense defaulted to "Pagó Juan desde Billetera digital"; he pays from Davivienda.
- **Who:** every new person, and anyone recording from a device with no stored last account.
- **Context:** the first records; any record from a new device.
- **Evidence:** passes 1 and 4. [`last-account.ts:34-39`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/last-account.ts#L34-L39): the last account stored in this browser, otherwise the first non-savings account in list order. The five starter accounts sort with "Billetera digital" first.
- **Root cause (high certainty):** the fallback ignores balances and history, and the last account lives per browser.
- **Consequence:** expenses land in the wrong account and balances drift, the same class as A2. It is most likely in the first week, when trust forms.
- **Solution:** fall back to the account with the most recent movement, else the non-savings account with the highest balance. Keep the browser's last choice first.
- **Priority:** P2.
- **Effort:** low.
- **Metric:** share of expenses whose account is edited after saving.
- **Validation:** a unit test of `preferredAccountId`; a query of edits to `accountId`.

### A9. A bill waiting for its real amount is announced only inside its space's Movimientos · P2 · Verified

- **Problem:** Energía, due today in Hogar and waiting to be confirmed, shows in three places, and only in Hogar:
  - Hogar Movimientos: a banner, "1 movimiento por confirmar · Energía · Revisar".
  - Hogar's bar: a badge on Movimientos.
  - Hogar Recurrentes: a "Para confirmar" chip.

  Personal Inicio, where Ana lands, and Hogar Inicio say nothing. Recurrentes' card also reads "Próxima: 8/12/2026" while the 8/11 occurrence is pending.
- **Who:** whoever pays variable household bills (CONFIRM mode).
- **Context:** the day a bill falls due.
- **Evidence:** pass 5, with the recurrence job on. The confirm flow itself is good (§2). Under the e2e server the job is off, so pass 3 saw only the chip and no action at all.
- **Root cause (medium certainty):** the pending list is read per space and shown in that space's ledger; the unified Inicio does not gather it.
- **Consequence:** bills stay unrecorded until someone happens to open the right space's Movimientos, so balances and the plan lag behind reality.
- **Solution:** a "Por confirmar (1)" row on Personal Inicio, gathering every space's pending occurrences. On the Recurrentes card: "Pendiente: 8/11 · Confirmar".
- **Priority:** P2.
- **Effort:** low to medium (one more read on Inicio; check its budget).
- **Metric:** median days from due date to confirmation.
- **Validation:** a database query over `pending-occurrences` before and after.

### A10. Personal Inicio shows what you owe, but not what you are owed · P2 · Verified (screen); root cause not traced

- **Problem:** Personal Inicio shows one card, "Te toca poner $ 275.000 a Pedro · En Viaje Cartagena · Saldar". The two amounts owed to Ana are missing: Hogar ($ 311.400) and Ana & Mateo ($ 30.000).
- **Who:** anyone in more than one shared space.
- **Context:** the daily glance.
- **Evidence:** pass 3. The switcher does show every balance.
- **Root cause (low certainty):** not traced in code. The card may show only the largest debt, or only debts.
- **Consequence:** money owed to the person is invisible on the screen they open every day.
- **Solution:** one compact balances card that lists every space with a balance, in both directions: "Te deben $ 341.400 · Debes $ 275.000".
- **Priority:** P2.
- **Effort:** low to medium.
- **Metric:** Saldos visits that end in a settlement.
- **Validation:** a component test with debts and credits in several spaces.

### A11. Personal speaks of roles and of a household · P2 · Verified (pass 2's H3)

- **Problem:** Personal, used alone, borrows the vocabulary of a shared space.
  - With no plan, Personal shows "Solo Propietario y Administrador ven estas acciones." to its only person.
  - The planner reads "Por repartir $ 200.000" right beside "Ana $ 1.600.000 · 100,00 %".
  - Lines say "Según aportes" and "Empieza de cero".
- **Who:** everyone who uses Hearth alone, which is the product's base case (functional overview, §0).
- **Context:** setting up and reading the personal plan.
- **Evidence:** passes 1 and 2. [`no-plan.tsx:61`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/lines/no-plan.tsx#L61) renders `managersSee` whatever the space kind.
- **Root cause (high certainty):** the shared copy is reused in Personal.
- **Consequence:** cognitive load at the first plan; roles appear in a space that has no roles.
- **Solution:** hide `managersSee` when the space is PERSONAL. In Personal, write "Por asignar" as "Te falta asignar $ 200.000 de $ 1.600.000" and drop "Según aportes".
- **Priority:** P2.
- **Effort:** low.
- **Metric:** share of personal plans created and activated.
- **Validation:** a component test per space kind.

### A12. Movimientos titles an expense with no description "Gasto" · P2 · Verified (pass 2's H4)

- **Problem:** the row reads "Gasto · Tarjeta de crédito". Its category is only the icon, which is `aria-hidden`, so a screen reader never announces it.
- **Who:** everyone scanning their history, and most of all screen-reader users.
- **Evidence:** pass 2; [`transaction-row.tsx:107`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/transaction-row.tsx#L107): `tx.description || t(\`type.${kind}\`)`.
- **Root cause (high certainty):** the title falls back to the type, not the category.
- **Solution:** fall back to the category's name ("Restaurantes").
- **Priority:** P2. Low effort, and it fixes an accessibility gap.
- **Effort:** low.
- **Metric:** details opened before the sought movement is found.
- **Validation:** a component test; a screen-reader check.

### A13. A transfer does not say which account is "from" and which is "to" · P2 · Verified

- **Problem:** the transfer form shows two chips, "Bancolombia" and "Elegir cuenta", with no "De" or "A". Only the picker's title reads "Hacia".
- **Who:** whoever moves money between their accounts (savings, paying the card).
- **Evidence:** pass 2 at 390×844.
- **Root cause (medium certainty):** the chips carry no visible label.
- **Consequence:** a reversed transfer, which drifts two balances at once.
- **Solution:** "De Bancolombia → A Elegir cuenta", or two labelled rows.
- **Priority:** P2.
- **Effort:** low.
- **Metric:** transfers edited or deleted within ten minutes.
- **Validation:** a component test of the labels.

### A14. Choosing a category is the slowest part of recording · P2 · Verified (taps); Hypothesis (impact)

- **Problem:**
  - A first expense took about 14 taps.
  - With no recents, the quick tiles are "Arriendo, Mantenimiento, Servicios", the first of the tree.
  - The parent group alone ("Transporte") is not accepted.
  - An income has no default category, although "Salario" and "Otros ingresos" are the only choices.
  - "Elige una categoría." appears only after pressing save.
- **Who:** new people above all; everyone on each record.
- **Evidence:** passes 1–3. The tiles fall back to the first categories of the tree ([`category-tiles.tsx:13-27`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/category-tiles.tsx#L13-L27)).
- **Root cause (medium certainty):** recents live per browser (#173, pass 2's H8), and the fallback has no notion of frequent categories.
- **Consequence:** a slow first record, the moment that decides whether the habit forms.
- **Solution:**
  - Seed the empty tiles with the most common starters (Mercado, Restaurantes, Transporte público).
  - Preselect "Salario" on an income with a single obvious choice.
  - Mark the category as required before saving.
- **Priority:** P2.
- **Effort:** low.
- **Metric:** taps and seconds per record; share recorded from a tile.
- **Validation:** a timed task test, "Registra un almuerzo de 18.500".

### A15. Account figures and states are never explained · P2 · Hypothesis (pass 2's H7)

- **Problem:** several terms and states on Cuentas carry no explanation.
  - "Disponible" and "Patrimonio neto" have no explanation, and neither does "fuera del disponible" on the card and savings.
  - "Efectivo −$ 30.500" sits in an account that cannot go negative, with no word about it.
  - "Saldo inicial" does not say what changing it does.
- **Who:** new people, and anyone who did not set opening balances.
- **Evidence:** passes 1 and 2. Both figures reconcile: 1,678,000 is the sum of the bank and cash accounts; 1,932,000 subtracts the card and adds savings.
- **Root cause (medium certainty):** the vocabulary is correct but assumed.
- **Solution:** a one-line help under each total ("Lo que puedes usar hoy: bancos, billeteras y efectivo"). On a non-credit account below zero: "¿Falta el saldo inicial?".
- **Priority:** P2.
- **Effort:** low.
- **Metric:** share of non-credit accounts below zero.
- **Validation:** a database query; interviews.

### A16. A Lector sees actions vanish with no reason · P3 · Verified

- **Problem:** Sofi's Hogar has no "+" in the bar, no "Invitar", and no plan editor controls, and none of it is explained. The clear sentence appears only if she types the record URL: "Tu rol en Hogar es Lector: puedes ver sus movimientos, pero no registrarlos." "Nombre y color" does explain itself, which is the pattern to copy.
- **Who:** viewers, a role that is rare today.
- **Evidence:** pass 4.
- **Root cause (high certainty):** the actions are hidden rather than explained.
- **Solution:** one line on the space's Inicio for a viewer: "Eres Lector en Hogar: ves todo, no registras".
- **Priority:** P3.
- **Effort:** low.
- **Metric:** none worth instrumenting yet.
- **Validation:** a component test.

### A17. Keyboard: no skip link, and twenty Tabs to Registrar · P3 · Verified at 658 px

- **Problem:**
  - The first Tab lands on the space switcher, with no skip link.
  - Reaching "+" takes 20 Tabs, and a whole keyboard expense about 49 key presses.
  - After saving or Escape, focus goes to the page container, not the new row or the toast.

  The focus ring was visible on every stop checked, except the bar's "+" (unconfirmed), and Escape closes Registrar cleanly.
- **Who:** keyboard and switch users; desktop users.
- **Evidence:** pass 5.
- **Root cause (medium certainty):** the bar comes last in the DOM, and there is no skip target.
- **Solution:** a "Saltar al contenido" link and a shortcut to Registrar; return focus to the new row, or announce the toast.
- **Priority:** P3 until desktop use is measured (H11).
- **Effort:** low.
- **Validation:** an axe/keyboard e2e at desktop width.

### A18. Recovering a password needs a person · P3 · Opportunity

- **Problem:** "¿Olvidaste tu contraseña?" answers "Pídele a quien administra Hearth que la restablezca." Production also has sign-up closed (`GET /api/v1/auth/sign-up` → `{"signUp":"closed"}`), so a stranger cannot discover the product at all.
- **Who:** anyone locked out; anyone not invited.
- **Evidence:** pass 1; production's public endpoint.
- **Root cause (high certainty):** a deliberate operations choice. The owner resets passwords with `scripts/reset-password.mjs`, and sign-up is gated by `HEARTH_SIGN_UP` (ruling P143).
- **Consequence:** each lockout costs the owner time; acquisition is invitation-only.
- **Solution:** none until email is in place. Then self-service reset. Keep sign-up closed until the owner decides the launch.
- **Priority:** P3 (a business decision, not a defect).
- **Effort:** medium to high (email delivery).

### A19. Copy and layout leftovers · P3 · Verified

- **Split sheet:** "Los invitados de un espacio compartido no aparecen aquí" sits right under "Mateo (invitado) · De «Ana & Mateo»". It still explains internals ("se crea en COP, la moneda de tu espacio Personal"). Pass 2's H9 is unchanged.
- **First steps:** "Comparte con tu hogar" stays open for someone who only shares with one person (pass 2's H10).
- **Saldar:** the "A" receiver label still reads as an initial (pass 2's H12).
- **Plan:** the catch-all reads "Todo lo demás / Todo lo demás". The amount at the right of each line (the remaining) has no label.
- **At 320 px:**
  - "Restaura/ntes" and "Manteni/miento" break mid-word.
  - "Transferencia" touches the edge of the segmented control.
  - The bar labels "Inicio" and "Movimientos" almost touch.
  - The Saldar cards truncate "Viaje Cart…".
- **Editar cuenta:** the archive icon has no accessible name (2 unlabeled controls).
- **Effort:** low for each.

### A20. On desktop the app is a phone column stretched · P3 · Hypothesis (pass 2's H11)

- **Problem:** at the 658 px pane, rows run 640 px wide with names far from their amounts, and the bar stays pinned. Registrar has no visible close; only its drag handle and Escape close it.
- **Evidence:** pass 5. A real desktop width could not be tested (Claude in Chrome did not connect).
- **Next step:** measure the share of desktop sessions before designing for it.

### A21. Hogar's "Inicio" opens Personal · P3 · Hypothesis

- **Problem:** inside Hogar, the bar's "Inicio" points to the person's Personal space (P310: "Inicio is always personal"). Leaving a space by tapping "Inicio" may surprise someone who expects that space's home.
- **Evidence:** pass 4 (href read only, not tapped).
- **Validation:** watch three people navigate Hogar → Inicio → back.

### A22. The space switcher sometimes needs several taps · Unverified

- **Problem:** in pass 5 the "Personal ▾" pill often did not open the dialog, either on a click or on Enter. Passes 3 and 4 opened it in two taps.
- **Evidence:** pane clicks were flaky across passes, so this may be the tool.
- **Next step:** retest on a real phone before acting.

## 4. What changed since pass 2

| Pass 2 finding | State on `main` `d6caf292` |
|---|---|
| M6 planner loop | Fixed; held in passes 2 and 3. |
| M4 Registrar off center | Fixed (five-slot bar). |
| H5 settlement "→" with no names | Fixed in `048e5262`; Saldos names both sides. |
| H13 lines with no category | (b) and (c) fixed in `b37f0186` (the planner marks "Sin categorías: no cuenta ningún gasto"); (a) still waits. |
| M1 save below the fold | **Open and wider:** four forms (A1). |
| H1 / M2 settlement with no account | **Open** (A2). |
| H2 three answers to "how much is left" | **Open** (A3). |
| H3 personal plan speaks like a household | **Open** (A11). |
| H4 rows titled "Gasto" | **Open** (A12). |
| H7 negative balances | **Open** (A15). |
| H8, H9, H10, H11, H12 | Open (A14, A19, A20). |
| Strength "Mi consumo explains itself" | **Lost**: the screen has no way in (A7). |

## 5. Journeys and screens with friction

| Journey | Friction | Findings |
|---|---|---|
| Record an expense on a small phone | Save below the fold; category in 3–4 taps; wrong default account | A1, A14, A8 |
| Follow the household plan | No door; a headline that counts savings; contradictory statuses | A4, A3, A5 |
| Get paid back | Lands in no account; credits missing from Inicio | A2, A10 |
| Read "how am I doing this month" | Shares on Inicio, totals in the space; Mi consumo unreachable | A6, A7 |
| Pay a variable bill | Announced only inside the space's Movimientos | A9 |
| First week alone | Role jargon, unexplained figures, negative cash | A11, A15 |

## 6. Unmet needs

1. **One number per question.** "¿Cuánto puedo gastar?", "¿Cuánto me falta poner?" and "¿Cuánto gasté?" each get one answer, the same on every screen (A3, A5, A6).
2. **Accounts that match the real money without thinking about it** (A2, A8, A13, A15).
3. **Everything that needs me today, on the screen I open:** what I owe, what I am owed, and the bills to confirm (A9, A10).
4. **The household plan as a place, not a setting** (A4).

## 7. Prioritized roadmap

| Order | Finding | Why first | Effort |
|---|---|---|---|
| 1 | A1 pinned save | Most frequent task, common phones, known pattern | Low–medium |
| 2 | A2 settlement destination | One-line cause, money trust | Low |
| 3 | A3 headline without savings | The plan's core figure; API ready | Low |
| 4 | A4 door to the shared plan | Core job hidden; needs the owner's choice | Low |
| 5 | A8 default account | Same class as A2; first week | Low |
| 6 | A12, A13, A11 | Copy and labels, each cheap | Low |
| 7 | A9, A10 | One "needs you today" block on Inicio | Medium |
| 8 | A5, A6, A7 | Naming bases; link or remove Mi consumo | Low–medium |
| 9 | A14, A15 | Speed and clarity of the first records | Low |
| 10 | A16–A22 | When convenient, or after measuring | Low |

## 8. Validation plan and metrics

- **This week, without users:**
  - e2e at 375×667 and 320×640, asserting every primary action is in the viewport (A1).
  - Component tests for A2, A3, A11, A12, A13.
  - A route-reachability check, so every SPA route has an in-app link (A7).
  - Database queries: settlements received with no account (A2), non-credit accounts below zero (A15), pending occurrences older than three days (A9).
- **With five people, on a phone, one task each:**
  - "¿Cuánto puedes gastar todavía este mes?" (A3)
  - "¿Cuánto le falta poner a Ana?" (A5)
  - "Abre el plan de Hogar" (A4)
  - "Registra un almuerzo de 18.500" (A1, A8, A14)
  - "Juan te pagó en efectivo, regístralo" (A2)
- **Minimum event analytics** (none today, as pass 2 noted):
  - Record started and saved, by viewport height.
  - Plan opened, by space kind.
  - Settlement saved with or without an account.
  - Pending occurrence confirmed, and its delay.
  - Device class.

  These need the opt-in consent and privacy policy the owner already has pending (Ley 1581).

## 9. What would raise the certainty

- Whether there are real users besides the owner, and of which kind (household, couple, trip). Today every frequency and retention claim is inferred.
- Whether desktop is a supported context (A17, A20).
- Whether the owner meant P311 to leave a shared space's plan only under Configuración (A4).
- A pass on a real phone with a real screen reader, to settle A12, A17 and A22 and the pane's click flakiness.
- Why the guest "Rosa" appeared in Juan's payer list but not in "Para quién" (pass 4). It was seen once and not traced; it may be a stale read after she was added.
