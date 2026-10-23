# Batch 2 UX critique

- **Status:** Draft, pass 1 (2026-10-23), written before the Penpot measurements
- **Scope:** the Batch 2 canvas (HU-E9-05, 06, 07, 08, 10, 11), read alongside the Batch 1 canvas
- **Owner's bar:** clean and compact; almost never scroll to find something; fewest taps; every option reachable; going back is always possible.

This is a deliberately harsh review. Each complaint names the evidence, why it hurts the user, and the fix the Penpot design will apply.

## Rubric

| ID | Rule |
|---|---|
| R1 | Every screen that is not a tab root has a visible back or close (≥44 px). System back does the same. A dirty form asks before discarding. |
| R2 | The main information and the primary action fit in the 844 px viewport without scrolling. |
| R3 | Core jobs (record, settle, check the plan, see what I owe) take ≤3 taps. Secondary jobs take ≤4. |
| R4 | Touch targets are ≥44 px. |
| R5 | Text contrast is ≥4.5:1. |
| R6 | No option hides behind a horizontal scroll. |
| R7 | Copy uses the household's words, not the data model's. |

## Complaints

### 1. You cannot leave the expense form (R1, blocker)

The "Registrar gasto en Hogar" screen has no close, no back, and no bottom nav. In the shipped app, the shell nav is the only way out.

**Fix:** add an X at the top left. If nothing was typed, it closes at once. If something was typed, it asks "¿Descartar este gasto?" with the choices Descartar and Seguir editando. The system back gesture behaves the same way.

### 2. The app speaks budget-engine, not household (R7, major)

These are the labels a household member has to decode:

- "Capacidad"
- "Asignación"
- "Línea"
- "De dónde sale: Directo · Fondo · Ahorro"
- "Al cambiar de mes: Reinicia · Acumula · Ajusta"
- "Consumo" vs "Salidas"
- "Sin asignar"
- "Liquidar"

These are model terms. Ana does not think "my capacity is 1,600,000". She thinks "I can put in 1,600,000 this month".

**Fix:** rename them as follows. Every rename keeps a one-line helper, and the API codes stay the same.

| Current | Proposed |
|---|---|
| Capacidad | Cuánto aporta cada uno |
| Línea | Rubro |
| Directo | Cada uno paga |
| Fondo | Sale del fondo común |
| Ahorro | Va al ahorro |
| Reinicia | Empieza de cero |
| Acumula | Lo que sobra pasa al mes siguiente |
| Ajusta | Lo que falta o sobra se compensa |
| Consumo | Lo que gastaste tú |
| Salidas | Lo que pagaste |
| Liquidar | Saldar |

### 3. Two verbs for one action on Saldos (R7, major)

"Liquidar" sits on the suggestion card and "Registrar pago" on each member row. Both open the same form.

**Fix:** use one verb, "Saldar", everywhere, including the Inicio card that today says "Pagar".

**Status:** applied in Penpot on 2026-10-23 (proposal P2, approved by the owner) to Saldos, Inicio and the guest sheet, in both the design pages and the prototype.

### 4. "Plan" means two different things (information architecture, major)

In Hogar, the Plan tab shows these views, with Líneas first:

> Líneas · Miembros · Fondo · Por grupo · Tendencia

In Personal, the same tab shows a different set, with Líneas last:

> Mi consumo · Por grupo · Tendencia · Líneas

"Mi consumo" is not a plan, and the view order changes between spaces.

**Fix:** the same order in every space, always starting with the current month. Hogar shows Líneas · Por grupo · Miembros · Fondo · Tendencia. Personal shows Líneas · Por grupo · Tendencia, and "Mi consumo" moves to Inicio.

### 5. Personal first, but the personal picture is three taps away (R3, major)

PRODUCT.md promises personal first. Today the unified view costs three taps: open the space pill, choose Personal, then open the Plan tab.

**Fix:** a "Tu mes" card on Inicio of every space shows what I spent across all spaces and what I owe. One tap opens the unified view.

### 6. The line editor is the densest screen in the app (R2, minor after measuring)

**Measured in Penpot:** it fits the 844 px viewport. Only the last helper caption is cut by about 6 px, and "Guardar línea" stays visible. It is not a scroll trap, but it is the densest screen, so the fix below is still worth applying.

**Original concern:**

One screen stacks six sections:

1. name
2. planned amount
3. funding
4. categories
5. rollover
6. who answers for it, with per-member percentages

It cannot fit in 844 px.

**Fix:** use progressive disclosure. The top shows name, amount, funding and categories. The rollover and allocation rules collapse into "Más opciones", which shows its current value ("Empieza de cero · según aportes"). The default allocation follows capacity, so most people never open it.

### 7. Building the first plan takes 20+ taps (R3, major)

The golden plan has 4 lines, and each line costs about 4 taps, on top of the capacities. The backlog target is "under 5 minutes", which this meets, but it is far from compact.

**Fix:** "Crear plan" opens a starter with Arriendo, Mercado y casa, Ahorro and Libre already in place. Each one is prefilled with an amount derived from capacity, and only the amounts need editing. "Copiar plan anterior" stays the default from the second month on.

### 8a. Amounts break across lines (readability, major)

**Measured in Penpot:** on Saldos, "Juan le paga a Ana $ / 100.000" splits the currency sign from the number at the line end. In FundWarning, "−$ / 500.000" does the same.

**Fix:** an amount is one unbreakable unit. Use a no-break space between the sign, the symbol and the digits. On suggestion cards, put the amount on its own line in semibold.

**Status:** fixed in Penpot on 2026-10-23. Suggestion cards put the amount on its own line with a no-break space. FundWarning also needed a word joiner (U+2060) between "−" and "$", because the renderer breaks after the minus sign; the UI should use the same pair of characters.

### 8. Saldos mixes spaces (R7, downgraded to cosmetic after measuring)

**Measured in Penpot:** the cross-space line already sits in its own tinted card with a chevron, so it reads as separate. The only remaining suggestion is a heading, "En otros espacios", once there are two or more such cards.

**Original concern:**

The screen reads "Tu saldo en Viaje 2026" and then, at the bottom, "En Hogar: debes $ 120.000". Two spaces share one screen with no visual boundary.

**Fix:** the cross-space line becomes its own card headed "En otros espacios", and one tap switches to that space's Saldos.

### 9. Members hide behind the avatar (findability, minor)

When Ana wants to invite Juan to Hogar, she looks at Hogar's own control, the space pill, not at her avatar.

**Fix:** in the space sheet, each shared space row shows its member count and an "Invitar" action. The avatar path stays.

### 10. Dashboard chips are 36 px and overflow (R4 and R6, major after measuring)

**Measured in Penpot:**

- **Space dashboards:** on all six mobile boards (Líneas, Sin plan, Miembros, Fondo, Por grupo and its drill-down), the "Tendencia" chip ends at x = 448 on a 390 px screen. One of five views is hidden.
- **Personal dashboards:** the "Líneas" chip ends at about 389, with no right margin.
- **LineTrend:** the active chip itself is clipped.

**Original concern:**

Five chips at 390 px push the last one off-screen behind a hidden scrollbar.

**Fix:** chips become 44 px tall. With the reordered sets from complaint 4, Hogar's five chips fit when their labels are short, and they wrap to a second row instead of scrolling.

### 10b. The split editor cuts its own options (R6, major)

**Evidence (measured in Penpot):** in "Editor de división con vista previa en vivo", the payer row "Ana (tú) · Juan · Pedro (invitado) · Fondo H…" and the method row "Según el plan · Iguales · Porcentaje · Montos…" both run off the 390px edge. "Fondo Hogar", "Montos" and "Partes" are only reachable by a horizontal swipe that nothing announces.

**Why it hurts:** the household fund is a common payer. A method you cannot see is a method nobody uses.

**Fix:**
- **Payer:** wrap the chips to two rows. When there are more than four, show the last one used plus "Otro…".
- **Method:** keep "Según el plan" as the preselected chip and put the other four (Iguales, Porcentaje, Montos, Partes) in a 2×2 grid underneath.

### 11. Two big numbers on the unified view (cognitive load, minor)

"Consumo" and "Salidas" compete as equal heroes.

**Fix:** one hero, "Lo que gastaste tú". "Lo que pagaste" becomes a secondary line with a one-tap explanation of the difference.

### 12. Ajustes is the one long scroll (R2, major; Batch 1)

**Measured in Penpot:** the Ajustes screen runs to about 1238 px. Moneda, Tema and Idioma sit below the 844 px fold, behind eleven segmented controls stacked in one column.

**Fix:** group the options into three short rows that each show their current value:

- "Números y fechas · 1.234,56 · 16/10/2026"
- "Zona y moneda · Bogotá · COP"
- "Apariencia e idioma · Sistema · Español"

Each row opens its own sheet. The screen fits in one view, and every setting stays two taps from the profile.

### 13. Sign-in and sign-up lead nowhere (R1, minor; Batch 1)

**Evidence:** "Iniciar sesión" and "Crear cuenta" have no destination in the canvas.

**Fix (prototype wiring):** both go to Inicio. When the user arrived from an invitation, both return to that invitation.

### 14. "Dividir con alguien" has no way in (findability, major)

**Found while wiring the prototype:** the screen "Dividir con alguien desde Personal" exists, but no tap anywhere leads to it. The personal record form (Registro rápido) has no control to split the expense with someone. So the "I paid dinner with Pedro" scenario (HU-E1-13, HU-E9-06) cannot start.

**Fix:** add one row under the category in the personal record form: "¿Lo compartiste? Dividir con alguien". It opens "Dividir con alguien" and comes back to the form with the split applied. That makes it one extra tap, and only when needed.

### 15. Each tested case needed an explicit ending (storytelling, major)

**Found while testing case 8 in the viewer:** after "Guardar pago", the app returned to the same Saldos screen, still showing "Juan le paga a Ana $ 100.000". Nothing confirmed that the debt was settled.

**Fix, applied in the prototype:** a "Saldos después de saldar" state with a toast ("Pago de Juan registrado · $ 100.000"), Juan shown as "a paz y salvo", and the remaining suggestion only.

**Rule for the implementation:** every save confirms with a toast and shows the changed state, never the unchanged previous screen.

## What already works (keep it)

- **Settling a debt takes 3 taps:** Saldos → Saldar on a suggestion → Guardar. The form is prefilled and the amount editable.
- **Recording a shared expense takes 3 taps plus the amount:** the split by plan is preselected and its preview is visible before saving.
- **A negative fund balance warns after saving instead of blocking.** The user is never stopped for something that is not an error.
- **Every bottom sheet has a close button, and every stacked screen has a back button.**
- **Roles hide the controls the user cannot use,** instead of showing them disabled.
- **The invitation page states (visitor, signed in, claim, expired, revoked, wrong account) all name the recovery.**

## Contrast check

Every color pair used for text passes 4.5:1 except one. Owe text (#B5562F) on owe-soft (#F6E9E1) measures 4.07, so text on owe-soft uses owe-ink (#96441F), which measures 5.62. Text never sits on the scrim (3.18).

## Next pass

Measure R2 on the Penpot boards: content height against the viewport for every screen. Then count taps per story chapter on the wired prototype.
