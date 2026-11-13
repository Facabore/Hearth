# Medium-density cleanup of the phone app: proposal

- **Status:** approved by the owner on 2026-11-13 ("Sí, aprobado"), recorded as ruling P324 in the [decisions index](../decisions/README.md). The code follows the boards, one story per screen group.
- **Issue:** [#308](https://github.com/Facabore/Hearth/issues/308).
- **Boards:** Penpot file "Hearth", page "Propuesta · Densidad media (2026-11-12)". It holds 25 boards at 390 × 844.
- **Why:** on 2026-11-12 the owner said the UX feels "demasiado saturada" and asked for examples and a direction.
- **Owner's reaction (2026-11-13), on the boards:** "me gusta muchisimo más, es más limpio más minimalista, está muchisimo mejor". The owner then approved the boards.

## What the critique found

An Impeccable critique of `development` at `04994e69` scored the phone app 27/40. The visual review was a Sonnet agent with 390 × 844 screenshots of a seeded local build. The detector pass was a Haiku agent.

The saturation is informational, not typographic. Personal Inicio uses only 5 font sizes, 3 weights and 3 text colours above the fold. What crowds it is this:

| Finding | Evidence |
|---|---|
| Inicio has no single focus | 7 stacked blocks. The month card, "Te necesita hoy" and "Tus primeros pasos" have equal weight (`src/modules/ledger/ui/home/home-summary.tsx:153-157`). The current P311 board is 1,660 px tall, about two screens. |
| The same fact is repeated | One balance ($ 947.000) shows 7 times across Inicio, the space switcher, Hogar and Saldos. A Recientes row says the space chip, "Registraste tú" and "tu parte" in 4 lines. |
| The split sheet holds 3 decisions | Method (4 options), payer, the account it came from (6 chips) and guests share one sheet. |
| Controls crowd Movimientos | About 46 % of the viewport goes to the title, a repeated subtitle, search and 6 filter chips before the first row. |
| Placeholders in Más | 3 of its 8 tiles are disabled "Próximamente" tiles. |

The detector CLI found 0 issues. The in-page overlay was blocked by the SPA's CSP (`script-src 'self'`), so every finding above comes from screenshots and code.

## Density references

The references are App Store screenshots, estimated ±1–2 rows:

| App | Rows per screen | Density |
|---|---|---|
| Monzo | about 5 | roomy, the closest to Hearth today |
| Splitwise, Tricount | about 4–6 | medium |
| YNAB, Copilot | about 9–11 | compact |

## The proposal

The proposal is called "Densidad media". The screen gets more room by removing containers and repeats, not by shrinking type.

- **Type and rows stay as they are.** Body text stays at 16 px. Two-line rows stay at 56 px (`--row-lg`), and one-line rows at 48 px (`--row`). Touch targets stay at 44 px or more.
- **One hero number per screen,** with one action line under it ("Juan te debe $ 947.000 · Saldar").
- **Flat rows of at most two lines,** with the amount on the right and a hairline divider. There are no cards per row. Lists are grouped by day labels.
- **Each sheet carries one decision.** The split sheet keeps the method and the people. Who paid, and from which account, becomes its own row in Registrar.
- **First steps become plain rows** on a new person's Inicio, and each one disappears when it is done. They are never ticked "Hecho".
- **The shared plan gets an entry point:** Hogar's Inicio shows "de $ 4.000.000 del plan" with a thin bar. This is finding A4 of pass 3.
- **Más becomes a list of six rows** with their pending state ("1 por confirmar"), and has no placeholder tiles.
- **The plan's views** (Rubros, Por persona, Fondo, Por grupo) are chips at the top of one screen.
- **Money direction keeps a sign or a word,** for example "+$ 947.000 · te toca recibir", never colour alone.
- **Amounts never break:** a no-break space follows the symbol, and a word joiner follows the minus sign.

Expected effect: Inicio fits in one screen, and Movimientos shows about 9 rows instead of about 5.

## What the boards do not settle yet

- **The example data is illustrative.** Sofi, Rosa, Viaje Cartagena, Nequi and the contribution figures are not seeded. Some copy is new and is not yet in `es.json` or `en.json`, for example "Hola de nuevo", "Ahora no" and "Quién puede editar un movimiento".
- **The boards are checked at 390 px only.** The 320 px reflow and dark theme still need a pass.
- **No real person has used them.** This is a heuristic review, not a usability test.
- **Each story's own work:** the code changes to match its boards, per ruling P272. Each story also checks its screens at 320 px and in dark mode, and puts its copy into both catalogs.
