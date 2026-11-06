# UX audit of production, pass 2

- **Status:** Diagnosis, pass 2 (2026-11-06). M4 and M6 are fixed and released (main `f84f69c1`). H13 is on the board as #264, waiting for the owner to pick its solution. The other recommendations need the owner's decision before they reach the board.
- **Build audited:** production at https://hearth-test.duckdns.org/ on 2026-11-06, before the release of main `f84f69c1` that same day, which fixed M4 and M6.
- **Method:** heuristic and task-based audit of the live app, signed in as the owner's own account. The numbers on screen were checked against `/api/v1`, and each root cause against the code. Desktop pass in Chrome at 1536×730; mobile pass in the desktop app's built-in browser with viewport emulation at 390×844, 375×667 and 320×640 (dark theme). DOM measurements per screen: horizontal overflow, targets under 44 px, the save button against the fold, a way back.
- **Nothing was written:** every form was walked up to its save button and closed. Sign-up, onboarding and invitations were not audited, because they need signing out or creating accounts.
- **Related:** [pass 1, 2026-10-28](2026-10-28-ux-audit.md) audited `development` locally with seeded personas. This pass checks what reached production and what changed since.

## How to read this

Same tags as pass 1:

- **Verified**: reproduced in production, with a measurement or the API's answer, and where it matters the line of code.
- **Hypothesis**: the behavior is verified, but whether it hurts real people needs data this audit does not have.
- **Opportunity**: no defect; something worth exploring.

Priority weighs impact × frequency × severity × confidence in the evidence, against effort. P1 = fix next; P2 = plan it; P3 = when convenient.

## Who and what was audited

| Account | Spaces | What it holds |
|---|---|---|
| Camilo (the owner, `locale: es`, America/Bogota) | Personal (OWNER) | Five starter accounts with English names, three movements this month, a November plan in DRAFT with two lines (Arriendo, Ahorrro). |
| | Milo's store (DIRECT, with guest Raurto) | A 7,000,000 expense in October split 50/50 and paid from the Credit card, a 3,500,000 settlement from Raurto in November, a 5,000 expense split 22/78. |

The data reads as the owner's own testing (amounts of $5, an account named "Ahorrro"). **There is no evidence of real users**, and no analytics: frequency, retention, abandonment and business value cannot be measured, only inferred.

## 1. Executive summary

Production is fast and stable: TTFB 90 ms, the nine API reads of the home in 136–218 ms, no console errors, no screen scrolls sideways at 390 or 320 px. Two of pass 1's trust findings are fixed: the paying account (F2) and the two answers to "how much did I spend" (F3, now "Mi consumo" with "¿Por qué es distinto?").

The weak points are again about **trust in the numbers**:

1. A settlement the person receives **lands in no account by default**, and on a small phone the choice sits below the fold (H1, M2). The owner's net worth reads 3,500,000 lower than it is.
2. On a 375×667 phone, **"Guardar gasto" is below the fold** of the record sheet (M1).
3. The Plan answers "how much is left" with **three different figures** (H2).
4. The planner **traps the person in a loop** between itself and the contributions sheet (M6). Fixed and released on 2026-11-06 (main `f84f69c1`).
5. **A plan's lines count no expense** when they have no category, and nothing says so (H13).

## 2. Strengths to keep

| Strength | Evidence |
|---|---|
| Speed | TTFB 90 ms; API reads 136–218 ms; no console errors (desktop, broadband). |
| Mi consumo explains itself | "Lo que gastaste tú $ 3.605" beside "Lo que pagaste $ 7.505", with "¿Por qué es distinto?". Fixes pass 1's F3. |
| Settling up | Saldos suggests "Raurto le paga $ 3.900 a Camilo"; Saldar prefills the exact amount, says "Raurto es invitado: pagó fuera de la app", and keeps "Guardar pago" pinned above the bar at 320×640. Direction is in words, not color alone. |
| Reflow and targets | No horizontal overflow on any screen at 390 or 320 px; no target under 44 px (the planner's line names are stretched links over a 145 px row). |
| Ways back | Cuentas, Mi consumo, Ajustes and the planner all have Volver. |
| Record form | The amount accepts the physical keyboard; "Monto" is the input's label and the example is its description. |
| Vocabulary | "Rubros", "Aportes", "Saldar", "al día": U1 and U2 reached production. |
| Detail sheet | A settlement's detail says why it cannot be edited and where to record it again. |

## 3. Findings

Ordered by priority. H = found on desktop, M = found on the mobile pass. Fields follow the audit brief: problem, who, context, evidence, root cause (certainty), consequence, solution, priority, effort, metric, validation.

### H1. A settlement the person receives lands in no account · P1 · Verified

- **Problem:** Saldar preselects "Llega a (opcional): Ninguna".
- **Who:** whoever receives a settlement; always when a guest pays, since a guest has no account.
- **Context:** settling up from Saldos.
- **Evidence:** Raurto's 3,500,000 settlement has `destinationAccountId: null`, while the October 7,000,000 expense left the Credit card. Cuentas shows "Patrimonio neto −$ 7.023.005", 3,500,000 too low.
- **Root cause (high certainty):** the form's default is no account.
- **Consequence:** available money and net worth drift silently, the same class as pass 1's F2; the error surfaces far from its cause.
- **Solution:** preselect the account the person usually receives into, and say where the money goes: "Bank account quedará en …".
- **Effort:** low to medium (which account is "usual" needs a rule: last settlement or income account).
- **Metric:** share of settlements where the viewer is the receiver and no account is set.
- **Validation:** a query over settlements before and after; a component test of the default.

### M1. On a 375×667 phone, "Guardar gasto" is below the fold · P1 · Verified

- **Problem:** the save button sits at 714–770 px on a 667 px screen; the sheet scrolls (762 px of content in 643 px), and the "000 / 0" key row is hidden too.
- **Who:** everyone on an iPhone SE/8-class phone, on the most frequent job.
- **Context:** recording at the moment of paying.
- **Evidence:** DOM measurement at 375×667; at 390×844 the button ends at 828 and fits.
- **Root cause (high certainty, measured):** at 375 px "¿Lo compartiste? Dividir con alguien" wraps to two lines and the "Personal" chip drops to its own row, which pushes the keypad and the button down.
- **Consequence:** an extra scroll to save, and the risk of believing an expense was saved when it was not.
- **Solution:** pin the save button at the bottom of the sheet, as Saldar already does, and keep the account, date and space chips on one row.
- **Effort:** low.
- **Metric:** records started and not saved, by screen height.
- **Validation:** an e2e test at 375×667 that the button is inside the viewport.

### M2. On a small phone, Saldar hides "Llega a · Ninguna" below the fold · P1 · Verified

- **Problem:** at 320×640 the destination account sits inside the sheet's scroll (367 px visible of 558), under the guest notice, while "Guardar pago" is pinned in view.
- **Who:** whoever receives a settlement on a small phone.
- **Context:** settling up.
- **Evidence:** DOM measurement at 320×640.
- **Root cause (high certainty):** the pinned button sits above an optional field that defaults to none.
- **Consequence:** the person saves without ever seeing that the money reaches no account; it makes H1 worse.
- **Solution:** H1's default, plus the chosen account beside the button: "Llega a Bank account · Cambiar".
- **Effort:** low.
- **Metric:** as H1.
- **Validation:** as H1, at 320×640.

### H13. A plan's lines count no expense, and nothing says so · P1 · Verified

- **Problem:** a line counts the expenses of the categories mapped to it, but creating a line never asks for categories, and the screens never say a line has none. The owner's November plan has four lines (Arriendo, Ahorrro, Mercado, "No sé xd"), none with a category and none marked "Todo lo demás", so every expense lands in "Sin presupuesto". The owner asked on 2026-11-06: "tengo un plan creado, como sabe qué cosa va en qué cosa? … que el rubro que se cree vaya por categoría?"
- **Who:** everyone who sets up a plan, personal or shared.
- **Context:** setting up the month's plan, then reading it.
- **Evidence:** `GET /plans/{id}` answers `categoryIds: []` and `isCatchAll: false` for all four lines. A new line with no category sends no mapping and saves without a word ([`line-editor.tsx:257-265`](https://github.com/Facabore/Hearth/blob/development/src/modules/budgeting/ui/line-editor/line-editor.tsx#L257-L265)). The planner's line row reads "Cada uno paga · Según aportes · Empieza de cero", with no mention of categories. "Sin presupuesto" names the orphan category ("Gastado $ 2.505 en categorías sin rubro · Pharmacy") but offers no way to map it.
- **Root cause (high certainty):** the mapping is an optional card inside the line form, not a step of creating a line, and no screen reports an empty mapping.
- **Consequence:** the plan never moves, so it reads as broken; the person cannot tell what goes where, which is the plan's whole job.
- **Decision:** the owner chose (b) and (c) first (ruling P304); both live in the planner, since the Plan tab's script has no room left. (a) waits for their metrics.
- **Solution:** options: (a) creating a line asks for its categories, or for "Todo lo demás", before saving; (b) the planner marks a line with no category: "Sin categorías: no cuenta ningún gasto · Elegir"; (c) "Sin presupuesto" offers "Asignar a un rubro" for each orphan category. (b) and (c) are cheap and fix existing plans; (a) prevents new ones.
- **Effort:** low for (b) and (c); medium for (a).
- **Metric:** share of active lines with no category and not the catch-all; share of the period's spending that lands in "Sin presupuesto".
- **Validation:** a database query for both metrics before and after; a task test: "Haz que tus gastos de mercado cuenten en el rubro Mercado".

### M6. The planner traps the person in a loop · P1 · Verified, fixed on `development`

- **Problem:** after closing (or saving) the contributions sheet, the planner's Volver reopens the sheet; closing it returns to the planner, and so on. The planner has no bottom bar in production, so there is no other way out. Reported by the owner on 2026-11-06 ("no puedo salir de allí de ninguna forma").
- **Who:** everyone who edits a plan; saving a line does the same.
- **Context:** Plan › Editar plan › Editar aportes › Cerrar › Volver.
- **Evidence:** reproduced at 390×844 without saving: "Cerrar → /plans/ID", then "Volver → /plans/ID/capacities".
- **Root cause (high certainty):** saving or closing the sheet returned to the planner with a push, so the history held the sheet before the planner, and Volver (`goBack`) and Back went to it.
- **Consequence:** the person cannot leave the plan without closing the app.
- **Solution:** `176007a5` (Refs #240): the sheet and the line form leave through `leaveSheet` (P189), and the planner keeps the main bar (P303). Six e2e scenarios cover Volver and Back after saving or closing the contributions and after adding a line.
- **Status:** released on 2026-11-06 (PR #263, main `f84f69c1`). In production at 390×844, Editar aportes › Cerrar › Volver lands on Plan, and Back after Cerrar does too.
- **Metric:** sessions that end on a planner screen.

### H2. The Plan gives three answers to "how much is left" · P1 · Figures verified, confusion a hypothesis

- **Problem:** the Plan tab heads "Disponible $ 1.797.495", which includes the 600,000 savings line, right above "Gastado $ 2.505 de $ 1.200.000"; the planner says "Por repartir $ 2.200.000".
- **Who:** whoever sets up and follows a plan.
- **Context:** checking the month.
- **Evidence:** `reports/lines?period=2026-11` matches the screen: 1,200,000 + 600,000 − 2,505.
- **Root cause (medium certainty):** the summary adds spending and savings lines under one label.
- **Consequence:** the headline figure cannot be reconciled with anything else on the screen, and trust in the plan erodes.
- **Solution:** head with what is left to spend (spending lines minus spent) and show savings on its own line.
- **Effort:** low.
- **Metric:** correct answers to "¿cuánto puedes gastar todavía?".
- **Validation:** a five-second test with five people.

### H3. The personal plan speaks like a household · P2 · Verified

- **Problem:** in Personal the planner says "Lo que aportan entre todos", "Camilo $ 4.000.000 · 100,00 %", "Cada uno paga · Según aportes", and "Activar plan: En borrador el plan no cambia la división de los gastos". On 6 November the plan is still a draft, the "Borrador" chip explains nothing when tapped, and the first step "Arma el plan del mes" shows as done.
- **Who:** everyone who uses Hearth alone.
- **Context:** setting up or reading the personal plan.
- **Evidence:** the screens' copy; [`firstStepsOf`](https://github.com/Facabore/Hearth/blob/development/src/modules/ledger/ui/home/first-steps.tsx) counts a plan "whatever its status".
- **Root cause (medium-high certainty):** the shared planner is reused with no personal variant.
- **Consequence:** cognitive load, and activating a personal plan changes nothing the person can see.
- **Solution:** copy by space kind; in Personal, hide the draft state or activate on creation.
- **Effort:** low to medium.
- **Metric:** share of personal plans activated.
- **Validation:** a component test per space kind; a task test.

### H4. Movimientos never says what the money was spent on · P2 · Verified, accessibility

- **Problem:** without a description each row reads "Gasto · 09:19 · Credit card". The category shows only as the icon, which is `aria-hidden` ([`category-icon.tsx:19`](https://github.com/Facabore/Hearth/blob/development/src/modules/categories/ui/category-icon.tsx#L19)), so **a screen reader never announces it**.
- **Who:** everyone reviewing their history; most of all screen-reader users.
- **Context:** looking for an expense in Movimientos.
- **Evidence:** the page text; ruling P284 in [`transaction-row.tsx`](https://github.com/Facabore/Hearth/blob/development/src/modules/ledger/ui/transaction-row.tsx).
- **Root cause (high certainty):** without a description the row's title is the movement type.
- **Consequence:** slower scanning, and lost information for whoever cannot see the icon.
- **Solution:** title the row with its category when it has no description.
- **Effort:** low.
- **Metric:** details opened before the sought expense is found.
- **Validation:** a component test; a screen-reader check.

### H5. A shared space's Inicio shows a settlement as "→" with no names, and no balance · P2 · Verified (bug)

- **Problem:** Inicio reads "Hoy · 06:56 · →" where Movimientos reads "Raurto → Camilo"; at 320 px the title also truncates to "Pago entre mie…" (M3). "Te toca recibir $ 3.900" appears only in the space picker and Saldos.
- **Who:** members of shared and direct spaces.
- **Context:** opening a space's Inicio.
- **Evidence:** "Milo's store" at 1536 and 320 px.
- **Root cause (high certainty):** Inicio passes the row an empty `memberNames`.
- **Consequence:** the most important figure of a shared space is missing from its main screen.
- **Solution:** pass the member names to the row; add a balance card to a space's Inicio.
- **Effort:** low.
- **Metric:** Saldos visits that end in a settlement.
- **Validation:** a component test.

### H6. Accounts and categories in English while the app is in Spanish · P2 · Behavior verified, cause of low certainty

- **Problem:** "Bank account", "Pharmacy", "Groceries", "Salary" for a person whose `locale` is `es`.
- **Who:** whoever signed up in another language, or changed it later.
- **Context:** Inicio, Cuentas, Registrar.
- **Evidence:** starter names are seeded in the sign-up language ([`starter-accounts.ts:17`](https://github.com/Facabore/Hearth/blob/development/src/modules/accounts/domain/starter-accounts.ts#L17)) and are data from then on.
- **Root cause (low certainty):** probably a sign-up with an English browser.
- **Consequence:** the app feels half translated.
- **Solution:** when the language changes and seeded names are untouched, offer to translate them.
- **Effort:** medium.
- **Metric:** people with `locale: es` and English seeded names.
- **Validation:** a database query.

### H7. Negative balances in accounts that cannot go negative · P2 · Hypothesis

- **Problem:** Savings −$ 4.000 and Digital wallet −$ 20.000, while the first step "¿Cuánto tienes hoy en tus cuentas?" shows as done because one account moved.
- **Who:** new people.
- **Context:** the first weeks of use.
- **Evidence:** Cuentas; `firstStepsOf`.
- **Root cause (medium certainty):** opening balances were never set, and nothing says so.
- **Consequence:** "Disponible" means nothing.
- **Solution:** on a non-credit account below zero, ask "¿Falta el saldo inicial?".
- **Effort:** low.
- **Metric:** share of non-credit accounts below zero.
- **Validation:** a database query; interviews.

### M4. In Personal, Registrar sits off center · P2 · Verified, fixed on `development`

- **Problem:** the personal bar has four items and "+" sits at x = 243 on a 390 px screen, whose center is 195.
- **Who:** every personal user, on every screen with the bar.
- **Evidence:** DOM measurement at 390×844.
- **Root cause (high certainty):** a four-item bar with the button third.
- **Solution:** `547059b6` and `176007a5`: the personal bar has five slots, Saldos included.
- **Status:** released on 2026-11-06 (main `f84f69c1`); in production "+" now sits at x = 195 of 390.

### H8. Quick categories follow the browser, not the person · P3 · Verified

- **Problem:** the three quick picks are Groceries, Restaurants and Medical, while every expense the person recorded is Pharmacy.
- **Who:** people who record from more than one device.
- **Context:** the record form.
- **Evidence:** recents live in each browser's `localStorage` ([`recent-categories.ts`](https://github.com/Facabore/Hearth/blob/development/src/modules/ledger/ui/record/recent-categories.ts)).
- **Root cause (high certainty):** a per-browser convenience by design (issue #173).
- **Consequence:** more taps to record.
- **Solution:** derive the recents from the person's movements.
- **Effort:** low to medium.
- **Metric:** share of expenses recorded with a quick pick.
- **Validation:** event analytics.

### H9. "Dividir con alguien" contradicts itself · P3 · Verified

- **Problem:** the sheet lists "Raurto (invitado) · De «Milo's store»" and right below says "Los invitados de un espacio compartido no aparecen aquí". It also explains internals ("se crea en COP, la moneda de tu espacio Personal"), and its button reads "Seguir con" with no name.
- **Who:** whoever splits an expense with one person.
- **Context:** the record form's split sheet.
- **Root cause (high certainty):** the copy assumes guests of a SHARED space; Raurto belongs to a DIRECT one.
- **Consequence:** confusion at the moment of choosing who to split with.
- **Solution:** copy by the guest's space kind; drop the currency explanation.
- **Effort:** low.
- **Metric:** sheet abandonment.
- **Validation:** a copy comprehension test.

### H10. "Comparte con tu hogar" stays pending while the person shares · P3 · Verified, deliberate

- **Problem:** a DIRECT space does not count as a household, so the step stays open.
- **Who:** people who only split with one person.
- **Evidence:** the comment in `firstStepsOf`.
- **Root cause (high certainty):** a design choice.
- **Solution:** rename the step "Crea el espacio de tu hogar".
- **Effort:** low.
- **Metric:** first-steps card dismissals.
- **Validation:** an interview question.

### H11. On desktop the app is the phone layout, stretched · P3 · Hypothesis

- **Problem:** Inicio leaves half the screen empty; Registrar is a phone sheet with a keypad and its own scroll (706 of 710 px at 1536×730); Volver renders as the 64×44 drag handle, with no visible close.
- **Who:** desktop users, if there are any.
- **Root cause (medium certainty):** mobile-first with no desktop composition.
- **Solution:** measure first; then a two-column layout and a visible close.
- **Effort:** medium to high.
- **Metric:** share of desktop sessions.
- **Validation:** analytics.

### M5. Layout breaks at 320 px · P3 · Verified

- **Movimientos:** the "Recurrentes" button covers 9 px of the title (the text ends at x = 169, the button starts at 160). Fine at 390 px.
- **Ajustes:** the "Predeterminado" chip sits outside the time-zone card and squeezes it until it reads "Bogota (GMT-" over "5)".
- **Plan:** the "Próximos" tab drops to a second row.
- **Solution:** the chip inside the card; Recurrentes as an icon below about 360 px.
- **Effort:** low.

### H12. Saldar's "A · Camilo (tú)" reads as an avatar · P3 · Verified

- **Problem:** the "A" means "to" but looks like an initial.
- **Solution:** "Recibe".
- **Effort:** low.

## 4. Unmet needs

1. Accounts that match the real money without thinking about it (H1, M2, H7).
2. One answer to "how much can I still spend" (H2).
3. Seeing what the money went on without opening each movement (H4).
4. An app in the person's language, their own seeded data included (H6).

## 5. Validation plan

- **Without users, this week:** database queries for H1, H6 and H7 (how many people are affected); component tests for H4, H5 and H9; an e2e at 375×667 for M1.
- **With five people:** tasks "¿Cuánto te queda este mes?" (H2), "Busca el gasto de farmacia" (H4), "Raurto te pagó en efectivo, regístralo" (H1).
- **Minimum event analytics** (none today): record started and saved, settlement started and saved, plan activated, device class. Without them retention, abandonment and business value cannot be measured.

## 6. What would raise the certainty

- Whether there are real users besides the owner, how many, and of which kind (household, couple, trip).
- Whether desktop is a supported context or the product is mobile and PWA only.
- Any support log or feedback.
- A pass over sign-up, onboarding and invitations with a test account, the light theme, and a real screen reader.
