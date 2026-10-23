# Hearth prototype: Ana's story

- **Status:** Script, 2026-10-23. This is the backbone of the Penpot "Prototipo" page: each chapter becomes a named flow that starts on its first screen and has a narration board before it.
- **Screens:** titles match the Penpot boards. **(B1)** marks a Batch 1 screen, **(B2)** a Batch 2 screen, and **(new)** a screen created to close a dead end (see [navigation-map.md](navigation-map.md)).
- **Taps:** counts include only the taps needed to reach the goal, not typing. **Fixes** point to [batch2-ux-critique.md](batch2-ux-critique.md).

## Verified routes in the Penpot prototype

To play a case, open the Penpot viewer on the page "Prototipo · la historia de Ana" and choose its flow. Each flow starts on a narration board, and the "Empezar" button jumps to the case's first screen.

Every route below was checked on 2026-10-23 against the prototype's real interactions. Each step is tap-wired to the next screen, 25 of 25 steps.

| Case | Starts at | Route (taps) | Ends at |
|---|---|---|---|
| 1 | Iniciar sesión | Crear una cuenta → Crear cuenta | Inicio |
| 2 | Inicio | + → Guardar gasto → Movimientos | Movimientos |
| 3 | Inicio | Espacio → Crear un espacio compartido → Crear espacio → Invitar | Invitar (link ready) |
| 4 | Invitación a Hogar | Crear cuenta y unirme → Crear cuenta | Inicio |
| 5 | Período sin plan | Crear plan → Capacidad total → Guardar capacidades → Activar plan → Activar plan | Plan › Líneas (active) |
| 6 | Plan › Líneas | + → Guardar gasto (X → ¿Descartar este gasto?) | Guardado con aviso |
| 7 | Miembros | Agregar invitado → Agregar invitado → Pedro (invitado) | Invitado: Pedro |
| 8 | Saldos | Saldar (Juan) → Guardar pago | Saldos a paz y salvo |
| 9 | Mi consumo | Por grupo → Tendencia | Mi tendencia |

The narration boards differ from the screen-by-screen script below in two places:

- **Case 6** starts on Plan › Líneas of Hogar, because the + there opens the Hogar expense form.
- **Case 9** starts directly on Mi consumo. Reaching it costs 3 taps today; proposal P4 brings it down to 1.

## Cast

- **Ana** lives with Juan. She is the OWNER of Hogar and pays from Bancolombia.
- **Juan** is a MEMBER of Hogar and earns more, so he contributes 60%.
- **Pedro** is Juan's brother. He joins a trip and does not use the app, so he is a guest.

---

## Chapter 1: Ana discovers Hearth and creates her account

> Ana is tired of splitting the rent on a spreadsheet. Juan sends her a link to Hearth.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Iniciar sesión (B1) | Taps "Crear una cuenta" | Crear cuenta |
| 2 | Crear cuenta (B1) | Types her name, email and password, then taps "Crear cuenta" | Inicio |
| 3 | Inicio (B1) | Sees her empty personal space, with categories already in place | — |

**Taps:** 2. **Back:** Crear cuenta has a back button to Iniciar sesión. **Shows off:** an error in plain words ("Ya existe una cuenta con este correo. Inicia sesión") that also offers the way out.

## Chapter 2: Her personal space and her first expenses

> Before sharing anything, Ana uses Hearth for her own money.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Inicio (B1) | Taps the + | Registro rápido |
| 2 | Registro rápido (B1) | Types 85.000, picks Mercado, keeps "Hoy · 14:32", taps Guardar | Inicio |
| 3 | Inicio (B1) | Sees "Disponible en octubre" go down and the expense under Recientes | Movimientos |
| 4 | Movimientos por día y hora (B1) | Checks the day's total | — |

**Taps:** 2 to record, 1 to review. **Shows off:** she can create a category without leaving the form, and the draft survives the trip.

## Chapter 3: She moves in with Juan, creates Hogar and invites him

> They sign the lease. Ana creates a shared space for the household.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Inicio (B1) | Taps the space pill | Cambiar de espacio |
| 2 | Cambiar de espacio (B1) | Taps "Crear espacio compartido" | Crear espacio compartido |
| 3 | Crear espacio compartido (B2) | Types "Hogar" with COP, monthly, cut-off on the 1st, then taps "Crear espacio" | Miembros |
| 4 | Miembros (B2) | Taps "Invitar" | Invitar |
| 5 | Invitar (B2) | Keeps Enlace and Miembro, then taps "Copiar" and sends it to Juan by chat | Miembros |

**Taps:** 5. **Fix:** in the space sheet, each shared space shows its member count and an "Invitar" action, so a later invite costs 2 taps instead of 4.

## Chapter 4: Juan accepts the invitation

> Juan opens the link on his phone.

| # | Screen | Juan does | Goes to |
|---|---|---|---|
| 1 | Página pública de invitación (B2) | Reads "Ana te invita a Hogar · Entras como Miembro", then taps "Crear cuenta y unirme" | Crear cuenta |
| 2 | Crear cuenta (B1) | Signs up | Back to the invitation, now signed in |
| 3 | Página pública de invitación, signed in (B2) | Taps "Aceptar y entrar a Hogar" | Inicio of Hogar |

**Taps:** 3. **Shows off:** after signing up, he returns to the same invitation. The expired, revoked and wrong-account states each name their recovery.

## Chapter 5: They build the month's plan by contribution (40/60)

> Ana earns 1.6M and Juan 2.4M. They agree that each pays in proportion.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Período sin plan (B2) | Taps "Crear plan" | Planeador |
| 2 | Planeador (B2) | Taps total capacity | Capacidades |
| 3 | Capacidades (B2) | Types 1.600.000 and 2.400.000 (or taps "Usar sugerencia"), then Guardar | Planeador |
| 4 | Planeador (B2) | Sees 40,00% and 60,00%. Opens each line (Arriendo, Casa, Ahorro, Libre) | Editar línea |
| 5 | Editar línea (B2) | Sets the amount, funding and categories, then Guardar | Planeador |
| 6 | Planeador (B2) | Taps "Activar plan" | Confirmation (new), then the Líneas dashboard |

**Taps:** about 20 today. **Fixes:**
- "Crear plan" opens a starter plan prefilled from the contributions, which brings it down to about 8 taps.
- The line editor shows the essentials first and hides the rest under "Más opciones".
- From the second month on, "Copiar plan anterior" is the default (Plan copiado).

## Chapter 6: Day to day, shared expenses with the split already worked out

> Ana does the big grocery shop for 2.000.000 and pays from Bancolombia.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Inicio of Hogar | Taps the + | Gasto en Hogar |
| 2 | Gasto en Hogar (B2) | Types 2.000.000 and picks Mercado. Sees "Según el plan (Casa) · Ana $ 800.000 · Juan $ 1.200.000" already chosen, then taps "Guardar gasto" | Movimientos |
| 2b | (optional) Gasto en Hogar → División | Switches to EQUAL in the split editor and watches the live preview | Back to the form |

**Taps:** 2, plus the amount. **Fix (blocker):** the form gets an X and asks "¿Descartar este gasto?" when something was typed. **Variant:** paying from the household fund beyond its balance saves and then warns "Guardado con aviso: fondo en negativo"; it never blocks.

## Chapter 7: Pedro arrives, and he doesn't use the app

> For Viaje 2026, Juan's brother pays for the hotel. Pedro does not want another app.

| # | Screen | Juan does | Goes to |
|---|---|---|---|
| 1 | Miembros (B2) | Taps "Agregar invitado" | Agregar invitado |
| 2 | Agregar invitado (B2) | Types "Pedro", then taps "Agregar invitado" | Miembros, which lists "Pedro (invitado)" |
| 3 | Gasto (B2) | Records the 300.000 hotel paid by Pedro (guest, no account), split three ways | — |
| 4 | Invitado (B2) | Later, copies the claim link so Pedro can keep his history if he ever signs up | — |

**Taps:** 2 to add him. **Shows off:** a guest pays, owes and settles like anyone else, and you can't remove him while he has a balance (the screen says so and offers "Registrar pago").

## Chapter 8: End of the month, who owes whom, and they settle up

> November closes. Juan wants to know where he stands.

| # | Screen | Juan does | Goes to |
|---|---|---|---|
| 1 | Any screen | Taps the Saldos tab | Saldos |
| 2 | Saldos (B2) | Reads "Para quedar a paz y salvo: Juan le paga a Ana $ 100.000", then taps "Saldar" | Registrar pago |
| 3 | Registrar pago (B2) | Everything is prefilled, so he taps "Guardar pago" | Saldos at 0 |
| 4 | Historial de saldo (B2) | Optional: taps his own row to see how it went from −150.000 to 0 | — |

**Taps:** 3. **Fixed 2026-10-23:** a single verb, "Saldar", everywhere. The suggestion button and the Inicio card say "Saldar", and the member-list link says "Saldar otro monto"; "Registrar pago" stays only as the form title.

## Chapter 9: Ana looks at her personal picture

> Ana wants to know how much she really spent, counting her money and her share of Hogar.

| # | Screen | Ana does | Goes to |
|---|---|---|---|
| 1 | Inicio | Taps the "Tu mes" card (new) | Mi consumo |
| 2 | Mi consumo: vista unificada (B2) | Sees one figure for "Lo que gastaste tú" and Mercado merged across Personal and Hogar | Por grupo |
| 3 | Mi consumo por grupo (B2) | Taps Comida, then Mercado, and comes back with the breadcrumb | Mi tendencia |
| 4 | Mi tendencia de 6 períodos (B2) | Sees the curve from June to November | — |

**Taps:** 1 with the fix (3 today). **Shows off:** personal first. Nobody in Hogar sees her accounts, and she sees everything that is hers.

---

## Chapter scorecard

| Chapter | Taps today | Taps with fixes | Main risk |
|---|---|---|---|
| 1 Account | 2 | 2 | — |
| 2 First expenses | 2 | 2 | — |
| 3 Create and invite | 5 | 5 (2 for later invites) | Members are hard to find |
| 4 Accept | 3 | 3 | — |
| 5 Plan | ~20 | ~8 | Model jargon, scroll in the line editor |
| 6 Shared expense | 2 | 2 | No way out of the form (blocker) |
| 7 Guest | 2 | 2 | — |
| 8 Settle | 3 | 3 | Three verbs for one action |
| 9 Personal picture | 3 | 1 | Contradicts "personal first" |
