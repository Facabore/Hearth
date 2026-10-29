# Batch 2 UX decisions

- **Status:** Decided on 2026-10-23. Shipped so far: U1 and U2 as UI copy (#210, 2026-10-29), the U4 shortcut on the personal home only (#209), and U12. The [UX audit of 2026-10-28](2026-10-28-ux-audit.md) found the rest unbuilt. U1 left two words as they were, because no decision names them: the rollover modes "Acumula" and "Ajusta", and the allocation rule "Sin asignar" (`NONE`).
- **Origin:** proposals P1–P10 on the Penpot page "Propuestas UX · antes → después" and findings #14 and #15 of [batch2-ux-critique.md](batch2-ux-critique.md)
- **How they were decided:** the owner approved P1–P4 one by one, then asked Claude to take the recommended option for the rest without waiting for confirmation. Each decision below records that recommendation and its reason.
- **What they change:** UI copy and layout only. Code, API codes and the spec keep their names (`capacity`, `line`, `allocation`); [Glossary](#glossary-ui-word--model-term) maps the UI words to the model terms.

| ID | Decision | Applies to | Decided by |
|---|---|---|---|
| U1 | Household vocabulary in the UI: "Cuánto aporta cada uno" (capacity), "Rubro" (line), "Por repartir" (unallocated), "Cada uno paga / Sale del fondo común / Va al ahorro" (DIRECT / SHARED_FUND / SAVINGS), "según aportes" (proportional), "Empieza de cero" (rollover RESET), "% de lo aportado". | Planner, line editor, dashboards, every label using these terms | Owner (P1) |
| U2 | One verb for settling: "Saldar" everywhere (suggestions, member list, Inicio card); the partial form is "Saldar otro monto". An amount is an unbreakable unit (no-break spaces between sign, symbol and digits); on suggestion cards it sits on its own line. | Saldos, Inicio, settle-up | Owner (P2) |
| U3 | View chips are 44 px tall and wrap to a second row; no option hides behind a horizontal scroll. Same order in every space: Rubros · Por grupo · Miembros · Fondo · Tendencia (Personal: Rubros · Por grupo · Tendencia). | Every dashboard | Owner (P3, with U1's "Rubros") |
| U4 | Inicio of every space shows a one-line shortcut "Tu mes en todos tus espacios: $ … ›" that opens the unified view in 1 tap. Accounts collapse into one "Tus cuentas" row. The debt card's action is "Saldar". | Inicio | Owner (P4, lighter version) |
| U5 | The line editor shows name, planned amount, funding (as a list with one explanatory line per option) and categories. Rollover and allocation collapse into "Más opciones", whose summary always shows the real current value (for example "Empieza de cero · 42 / 58"), never a default. | Line editor | Recommended (P5): the full screen fits without scrolling, and a collapsed money setting must never hide a custom value. |
| U6 | "Crear plan" opens a suggested plan: contributions plus four rubros (Arriendo, Mercado y casa, Ahorro, Libre) prefilled from the total, each tappable to edit, with "Usar este plan" leading to the activation confirmation. "Copiar plan anterior" stays the default from the second month on. | Period without a plan, planner | Recommended (P6): the first plan drops from about 20 taps to about 8. |
| U7 | In the split editor, payer chips wrap to two rows, and the method is "Según el plan" plus a 2×2 grid (Iguales, Porcentaje, Montos, Partes). | Split editor | Recommended (P7): the household fund and two methods were hidden off-screen. |
| U8 | Ajustes shows three summary rows ("Números y fechas", "Zona y moneda", "Apariencia e idioma"), each opening its own sheet and showing its current values. The preview and the row values must use the same sample figure. | Ajustes | Recommended (P8): the screen went from about 1238 px to one view. |
| U9 | In the space sheet, each shared space shows its member count and an "Invitar" button, and the sheet has a close X. | Space switcher | Recommended (P9): a later invitation drops from 4 taps to 2. |
| U10 | The unified view has one hero figure, "Lo que gastaste tú". "Lo que pagaste" is a secondary line with "¿Por qué es distinto?". The view opens as a stacked screen from the U4 shortcut, with a back button. | Mi consumo | Recommended (P10): two equal heroes competed. The stacked screen matches U4. |
| U11 | The personal record form gets a row "¿Lo compartiste? Dividir con alguien" under the category, opening "Dividir con alguien" and returning with the split applied. | Registro rápido (Personal) | Recommended (critique #14): the screen existed but had no way in. |
| U12 | Every save confirms with a toast and shows the changed state, never the unchanged previous screen. | Every form that saves | Recommended (critique #15): found while testing case 8, where saving a payment showed the old debt. |
| U13 | An expense that leaves its line above 90 % saves at once, and the toast says where the line is left ("Gasto guardado. Home quedó en 94 % de lo planeado y le quedan $ 85.000."). Only an expense that goes over its line asks "¿Guardar de todos modos?", and that question brings its buttons into view above the bottom bar. A line's share is a whole percent, rounded down. Amends rulings P235 and P237 (#142). | Record form | Owner (2026-10-29, #211), from finding F4 of the [UX audit](2026-10-28-ux-audit.md): asking from 90 % stopped the most frequent job late in the month and hid its own button. |

## Glossary: UI word → model term

| UI (es) | Model / API |
|---|---|
| Cuánto aporta cada uno | capacity |
| Rubro | budget line (`line`) |
| Por repartir | unallocated capacity |
| Cada uno paga | funding `DIRECT` |
| Sale del fondo común | funding `SHARED_FUND` |
| Va al ahorro | funding `SAVINGS` |
| según aportes | allocation `PROPORTIONAL` (by capacity) |
| Empieza de cero | rollover `RESET` |
| Saldar | settlement (`RecordSettlement`) |

## Fixes the proposals still need in Penpot

These changes were not yet applied to the boards on 2026-10-23, because the Penpot plugin had disconnected. They are tracked here until the boards are updated.

- P3: rename the first chip "Rubros", and change "sin línea" to "sin rubro".
- P4: replace the "Tu mes" card with the one-line shortcut.
- P5: show the real value in the "Más opciones" summary ("Empieza de cero · 42 / 58").
- P6: re-apply the Inter font. The board rendered in a serif fallback.
- P8: make the preview figure match the row value.
- P10: fill the "[ESPACIO]" placeholder.
