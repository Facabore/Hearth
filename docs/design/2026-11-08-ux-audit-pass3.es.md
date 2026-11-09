# Auditoría de UX, pasada 3: main después del lanzamiento de noviembre

> Versión en español de [2026-11-08-ux-audit-pass3.md](2026-11-08-ux-audit-pass3.md). El contenido es el mismo; los textos de la interfaz se citan tal cual aparecen en la app.

- **Estado:** diagnóstico, pasada 3 (2026-11-08). Ningún hallazgo está todavía en el tablero. Como en las pasadas 1 y 2, cada recomendación necesita antes la decisión del dueño.
- **Versión auditada:** `main` en `d6caf292` (merge del PR #280, el lanzamiento de #272–#275). El árbol es idéntico a `development` en `3d75e538`.
- **Cómo se sirvió:** un build standalone local, con la API en :3500 y la vista previa de la SPA en :3600. Corrió contra un PostgreSQL desechable, con el reloj fijado en 2026-11-08 15:00 UTC (America/Bogota).
- **Método:** auditoría heurística y por tareas con personas sembradas; no es un estudio con personas reales.
  - Cinco pasadas en un navegador real, cada una a cargo de un agente Haiku en el navegador integrado de la app de escritorio. El agente tomó capturas, las miró y midió cada pantalla: desborde horizontal, objetivos de menos de 44 px, controles sin etiqueta y forma de volver.
  - Viewports: 390×844, 375×812, 375×667 y 320×640, en tema oscuro y claro. "Escritorio" fue el panel del navegador a 658×630.
  - Cada causa raíz de abajo se verificó en el código de `main`.
- **Límites:**
  - Claude in Chrome no pudo abrir un grupo de pestañas ("No group with id"), así que ninguna pasada corrió a un ancho real de escritorio.
  - Los clics del panel a veces se ignoraban. Los agentes reintentaron esos controles con referencias o con Enter, así que los conteos de toques son aproximados. La inestabilidad del selector de espacios (A22) no está demostrada como un problema de la app.
  - En el servidor de e2e el job de recurrencias está apagado (`RECURRENCE_JOB_INTERVAL_SECONDS=0`). Para A9 se reinició la API sobre la misma base con el job encendido.
  - No se tocó producción, salvo leer sus endpoints públicos `GET /api/v1/auth/sign-up` y `/health`.
- **Relacionado:** [pasada 1, 2026-10-28](2026-10-28-ux-audit.md) y [pasada 2, 2026-11-06](2026-11-06-ux-audit-production.md).

## Cómo leer este informe

Mismas etiquetas y prioridades que en las pasadas 1 y 2:

- **Comprobado:** se reprodujo en la app en ejecución, con una captura o una medición y, cuando importa, la línea de código.
- **Hipótesis:** el comportamiento está comprobado, pero saber si afecta a personas reales requiere datos que esta auditoría no tiene.
- **Oportunidad:** no es un defecto; es algo que vale la pena explorar.

La prioridad pondera impacto × frecuencia × gravedad × confianza en la evidencia, frente al esfuerzo. P1 = corregir ya; P2 = planificar; P3 = cuando convenga. Los IDs empiezan con A para no chocar con la F de la pasada 1 ni con la H y la M de la pasada 2.

## Personas sembradas

| Persona | Rol | Qué se preparó |
|---|---|---|
| Ana | Propietaria de Personal, "Hogar" y "Viaje Cartagena" | Personal: Bancolombia con 2.000.000, salario, cuatro gastos (uno sin descripción), una transferencia de 200.000 a Ahorros, un plan de noviembre activo (Mercado, Salidas, Ahorro y Todo lo demás como rubro comodín) y una recurrencia AUTO de Netflix. Hogar: un fondo de 1.500.000, un plan activo con capacidades de 1.600.000 / 2.400.000, gastos de Ana y de Juan, un aporte al fondo, una recurrencia CONFIRM de "Energía" y una invitación por correo pendiente. Un gasto dividido directo con el invitado Mateo. |
| Juan | Administrador de Hogar | Su propia cuenta Davivienda; dos gastos en Hogar. |
| Sofi | Lectora de Hogar | Nada registrado. |
| Luis | Miembro de Viaje Cartagena | Una cena dividida entre tres. |
| Pedro | Invitado en Viaje Cartagena | Pagó fuera de la app el hotel de 900.000, dividido entre tres. |
| Carla | Persona nueva | Se registró y nada más. |
| Diana | Persona nueva | Se registró por la interfaz durante la pasada 1. |

## 1. Resumen ejecutivo

La app es estable y sus bases son sólidas:

- Ninguna pantalla medida tiene scroll horizontal ni objetivos de menos de 44 px a 390 o 320 px, en ningún tema.
- El contraste cumple AA en todos los elementos medidos en tema claro.
- Deshacer funciona después de eliminar, y el selector de espacios muestra el saldo de cada uno en una sola línea.
- Saldar cuentas se lee en frases simples.
- M6, el planificador que atrapaba a la persona, sigue corregido: cada "Volver" llevó hacia afuera.

Los puntos débiles son tres. Repiten el tema de la pasada 2, la **confianza en los números**, y suman uno nuevo de navegación:

1. **En celulares pequeños no se alcanza a guardar.** En una pantalla de 375×667 o 320×640, el botón de guardar de los formularios de gasto, ingreso y edición queda debajo del pliegue, y el de transferencia aparece cortado (A1). El M1 de la pasada 2 ahora afecta a cuatro formularios.
2. **Las cifras cambian de significado entre pantallas.**
   - "Disponible" en el Plan cuenta como gastable el ahorro que todavía no se movió (A3, H2 de la pasada 2, sigue abierto).
   - El gasto de un mismo espacio se lee como la parte de Ana en Inicio y como el total del espacio en Movimientos (A6).
   - La misma persona está "Al día" en una pestaña del plan y le faltan $ 440.000 en otra (A5).
   - Un pago que la persona recibe sigue sin llegar a ninguna cuenta (A2, H1 de la pasada 2).
3. **El plan compartido no tiene puerta de entrada.** Desde que Plan salió de la barra inferior (P311), al plan de un espacio compartido solo se llega por su ⚙ Configuración. Haiku no lo encontró por su cuenta en dos pasadas (A4).

## 2. Fortalezas que hay que conservar

| Fortaleza | Evidencia |
|---|---|
| Reflujo y objetivos táctiles | Sin desborde ni objetivos de menos de 44 px a 390 y 320 px; ningún control sin etiqueta, salvo el ícono de archivar de Editar cuenta (A19). |
| Saldar se lee en frases | "Juan le paga $ 311.400 a Ana" · "Saldar solo prellena el formulario." · "Pedro es invitado: pagó fuera de la app, así que no hay cuenta que elegir." |
| El selector de espacios | Cada fila dice quién está en el espacio y su saldo: "Hogar · Ana, Juan, Sofi y Rosa · Te toca recibir $ 311.400". |
| Eliminar sin miedo | "Gasto eliminado · Deshacer" restaura el movimiento en su lugar ("Gasto restaurado"). |
| Confirmar una factura variable | "Sugerido: $ 180.000" y luego "$ 7.700 menos que lo sugerido" mientras se escribe el monto real; "Omitir salta solo esta fecha". |
| Roles explicados donde se nombran | La lista de roles de la invitación ("Lector · Solo ve movimientos, saldos y tableros") y la hoja de invitados ("No inicia sesión"). |
| Forma de volver | Cada "Volver" llevó hacia afuera: rubro → planificador → Plan → Inicio. M6 sigue corregido. |
| Verificación de la división | "Suma $ 60.000: cuadra con el gasto". |
| Idioma | Inicio en inglés no tiene textos de la interfaz en español; el cambio es inmediato y reversible. |
| Registro | Un formulario corto, con la pista de 8 caracteres y sin verificación de correo; los primeros pasos se marcan solos. |

## 3. Hallazgos

Ordenados por prioridad. Cada campo sigue el formato pedido: problema, usuario afectado, contexto, evidencia, causa raíz (con su nivel de certeza), consecuencia, solución, prioridad, esfuerzo, métrica y validación.

### A1. En un celular pequeño el botón de guardar queda debajo del pliegue en cuatro formularios · P1 · Comprobado

- **Problema:** el botón de guardar no se ve sin hacer scroll en la hoja. Las posiciones están en px; a 375×667 la pantalla mide 667 px de alto.

  | Formulario | Posición del botón | 375×667 | 320×640 |
  |---|---|---|---|
  | Registrar · Gasto | 732–788 | Oculto | Oculto |
  | Registrar · Ingreso | 672–728 | Oculto | Oculto |
  | Registrar · Transferencia | 630–686 | Solo se ven 37 px | Solo se ven unos 10 px |
  | Editar movimiento | 746–802 | Oculto | Oculto |
  | Editar cuenta | 1177 | Oculto | Oculto |

  A 390×844 los tres botones de Registrar caben. Editar movimiento y Editar cuenta siguen necesitando scroll ahí.
- **Usuario afectado:** todas las personas con un iPhone SE / 8 o un Android pequeño, en la tarea más frecuente.
- **Contexto:** registrar en el momento de pagar, de pie y con una mano.
- **Evidencia:** mediciones de la pasada 2 a 375×667 y 320×640. En Saldar, "Guardar pago" se mantiene a la vista a 375×812 y 320×640 (pasada 3).
- **Causa raíz (certeza alta):** la hoja de Registrar es una sola columna con scroll y sin pie ([`record-sheet.tsx:60`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/record-sheet.tsx#L60), `overflow-y-auto` en toda la sección). La hoja de Saldar recibe un `footer` ([`settle-up-sheet.tsx:218`](https://github.com/Facabore/Hearth/blob/main/src/modules/balances/ui/settle-up-sheet.tsx#L218)) que queda fijo.
- **Consecuencia:** un scroll extra en cada registro, y el riesgo de irse creyendo que se guardó. En un celular de 320 px el botón de transferencia es una franja de 10 px.
- **Solución recomendada:** fijar la acción principal de cada formulario en el pie de la hoja, como lo hace Saldar, y dejar que los campos hagan scroll encima. Aplicarlo a los tres modos de Registrar y a las páginas de edición.
- **Prioridad:** P1. Afecta la tarea más frecuente en una clase común de celulares, y la corrección es un patrón que la app ya tiene.
- **Esfuerzo:** bajo a medio. Un cambio compartido en la hoja; luego verificar la altura del teclado numérico a 320×640.
- **Métrica:** proporción de registros iniciados y no guardados, por altura de pantalla (requiere los eventos mínimos de la sección 8).
- **Validación:** una prueba e2e a 375×667 y 320×640 que verifique que cada botón principal está dentro del viewport. Después, repetir la prueba de cinco segundos "guarda este gasto".

### A2. Un pago que la persona recibe sigue sin llegar a ninguna cuenta · P1 · Comprobado (H1 de la pasada 2)

- **Problema:** en "Saldar otro monto", cuando la persona recibe el dinero, "Llega a (opcional)" aparece preseleccionado como "Ninguna". Cuando la persona paga, "Sale de (opcional)" sí preselecciona una cuenta, así que las dos direcciones se comportan distinto.
- **Usuario afectado:** quien recibe un reembolso. Cuando paga un invitado, la persona siempre es quien recibe.
- **Contexto:** saldar cuentas desde Saldos.
- **Evidencia:** pasada 3 a 375×812: la hoja de la sugerencia muestra "Sale de · Bancolombia"; el formulario libre, "Llega a · Ninguna". En el código solo se preselecciona el origen ([`settle-up-sheet.tsx:93-96`](https://github.com/Facabore/Hearth/blob/main/src/modules/balances/ui/settle-up-sheet.tsx#L93-L96): `sourceAccountId: … preferredAccountId(…)`, sin equivalente para `destinationAccountId`).
- **Causa raíz (certeza alta):** el borrador nunca elige un destino.
- **Consecuencia:** el dinero disponible y el patrimonio neto se desvían en silencio, y el error aparece lejos de su causa (la pasada 2 midió −3.500.000 en el patrimonio neto del dueño).
- **Solución recomendada:** preseleccionar el destino igual que el origen: la última cuenta usada o, si no hay, la primera que no sea de ahorro. Decir junto al botón adónde va el dinero: "Llega a Bancolombia · Cambiar".
- **Prioridad:** P1: un defecto de confianza en el dinero con una causa de una línea.
- **Esfuerzo:** bajo.
- **Métrica:** proporción de pagos en los que la persona recibe y no se elige destino.
- **Validación:** una prueba de componente del valor por defecto y una consulta a la base de datos antes y después.

### A3. "Disponible" cuenta como dinero para gastar el ahorro que todavía no se movió · P1 · Comprobado (H2 de la pasada 2)

- **Problema:** la cifra principal del Plan no coincide con la suma de ninguna otra línea de la pantalla.
  - **Personal:** "Disponible $ 1.039.500" incluía 100.000 del rubro Ahorro que todavía no se habían transferido. Después de la transferencia mostró $ 921.000, que es lo que queda en los rubros de gasto.
  - **Hogar:** "Disponible $ 1.816.000" aparece sobre "Gastado $ 1.884.000 de $ 3.400.000". 3.400.000 − 1.884.000 = 1.516.000; los 300.000 de diferencia son el propio "Disponible $ 300.000" del rubro Ahorro.
  - Configuración lo repite: "Plan del mes · Quedan $ 1.816.000".
- **Usuario afectado:** quien sigue un plan; el hogar que se pregunta "cuánto nos queda este mes".
- **Contexto:** revisar el mes antes de gastar.
- **Evidencia:** pasadas 2 y 3; [`line-dashboard.tsx:42-57`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/lines/line-dashboard.tsx#L42-L57). La línea "Gastado … de …" lee `totals.withoutSavings` (decisión P262), mientras que la cifra principal lee `totals.available`, que incluye el ahorro.
- **Causa raíz (certeza alta):** P262 separó el ahorro de "Gastado", pero no de la cifra principal.
- **Consecuencia:** el número más visible no se puede conciliar con la pantalla, y la persona puede gastar dinero que era para ahorrar.
- **Solución recomendada:** encabezar con lo que queda para gastar, a partir de `withoutSavings`. Mostrar el ahorro en su propia línea: "Ahorro: $ 300.000 de $ 600.000 por mover". Usar la misma cifra en Configuración y en Inicio.
- **Prioridad:** P1: toda la promesa del plan está en este número. La pasada 2 ya lo señaló y sigue abierto.
- **Esfuerzo:** bajo (la API ya responde `withoutSavings`).
- **Métrica:** respuestas correctas a "¿Cuánto puedes gastar todavía este mes?".
- **Validación:** una prueba de cinco segundos con cinco personas y una prueba de componente de la cifra principal.

### A4. Al plan de un espacio compartido solo se llega por Configuración · P1 · Comprobado (el hallazgo); Hipótesis (el impacto en las personas)

- **Problema:** después de P311 ("Más reemplaza a Plan en la barra", `9fdb7a19`), un espacio compartido no tiene Plan en su barra inferior, en su Inicio, en las tarjetas de Más ni en Saldos.
  - La única puerta es el ⚙ "Configuración de Hogar" del espacio › "Plan del mes": 2 toques desde el Inicio del espacio y 5 desde Personal.
  - El ⚙ es un ícono sin texto visible.
- **Usuario afectado:** todos los miembros de un hogar que presupuesta en conjunto; el Plan es la razón de ser de ese espacio.
- **Contexto:** revisar o editar el plan del mes.
- **Evidencia:** Haiku buscó en la barra, en Más, en Saldos y en el selector, y no encontró ninguna entrada ni en la pasada 3 ni en la 4; en la pasada 3 tuvo que escribir la URL. En el código, el único enlace al plan de un espacio compartido es la fila de configuración ([`space-settings-screen.tsx:192`](https://github.com/Facabore/Hearth/blob/main/src/modules/spaces/ui/space-settings/space-settings-screen.tsx#L192)). El Inicio de Personal sí tiene "Tu plan de noviembre".
- **Causa raíz (certeza alta):** un cambio de navegación deliberado, P311, que le dio a Más el lugar del plan y no le dio a ningún espacio compartido un equivalente de la tarjeta "Tu plan del mes" de Personal.
- **Consecuencia:** el plan queda archivado dentro de la configuración, así que algo que se usa todos los días se lee como un ajuste. Un miembro que no encuentra el plan no puede seguirlo.
- **Solución recomendada (a elección del dueño):**
  - (a) Una tarjeta "Plan del mes" en el Inicio de un espacio compartido, como la de Personal.
  - (b) Una tarjeta de Plan al principio de Más.
  - (c) Dejarlo en Configuración, pero darle al ⚙ una etiqueta visible.

  (a) recupera el hábito sin ocupar un lugar nuevo en la barra.
- **Prioridad:** P1. Revierte la descubribilidad de una tarea central, y un agente con la tarea en la mano falló dos veces. Si los miembros reales fallan o no es la hipótesis que hay que probar.
- **Esfuerzo:** bajo para (a) o (b); verificar el presupuesto de script de la ruta de Inicio (ADR 0004).
- **Métrica:** proporción de sesiones en espacios compartidos que abren el Plan; tiempo hasta llegar a él.
- **Validación:** una prueba de tarea con tres personas: "¿Cuánto les queda para mercado en Hogar?".

### A5. La misma persona está "Al día" en una pestaña y le faltan $ 440.000 en la otra · P2 · Comprobado

- **Problema:** en el Plan de Hogar, Miembros dice "Ana · Le faltan $ 440.000" y "Juan · Le faltan $ 1.376.000". Fondo dice de Ana "Al día · Esperado $ 480.000 · Aportado $ 500.000 · +$ 20.000" y de Juan "Le faltan $ 720.000".
- **Usuario afectado:** los miembros de un hogar con fondo compartido.
- **Contexto:** "¿Cuánto me falta poner este mes?"
- **Evidencia:** pasada 3 a 375×812, textual.
- **Causa raíz (certeza media):** las pestañas miden cosas distintas con las mismas palabras. Miembros mide la parte del plan de la que cada miembro es responsable frente a lo que pagó; Fondo mide los depósitos al fondo frente a lo esperado. Ninguna pestaña dice cuál es su base.
- **Consecuencia:** un miembro no puede saber si debe algo, que es justo la pregunta que la pantalla existe para responder.
- **Solución recomendada:** nombrar la base en cada estado, por ejemplo "Le faltan $ 440.000 de su parte del plan" frente a "Al día con el fondo". O enlazar la fila de Miembros a un desglose de las dos.
- **Prioridad:** P2: mucha confusión, pero solo para los hogares con fondo.
- **Esfuerzo:** bajo (textos) a medio (desglose).
- **Métrica:** respuestas correctas a "¿Cuánto le falta poner a Ana?".
- **Validación:** una prueba de comprensión de textos con cinco personas.

### A6. Las cifras de un espacio cambian de significado de una pantalla a otra · P2 · Comprobado

- **Problema:** el gasto de un mismo espacio cambia de base entre pantallas, y algunos cambios no tienen una fila que los explique.
  - **De Inicio a Movimientos:** la tarjeta del mes en Inicio muestra "Con otros › Hogar $ 753.600", que es la parte de Ana. Al tocarla se abre Movimientos de Hogar con el encabezado "Gastos $ 1.884.000", el total del espacio.
  - **La cifra principal de Personal:** "Gastado en noviembre $ 1.409.100" suma las partes de Ana en todos los espacios.
  - **Los totales se mueven sin fila:** al confirmar la Energía de Hogar, el "Con otros" de Personal subió $ 68.920 y Movimientos de Personal no ganó ninguna fila.
- **Usuario afectado:** cualquiera que tenga dinero personal y compartido.
- **Contexto:** revisar "cómo voy este mes".
- **Evidencia:** pasadas 2 y 5. `GET /me/unified-view?period=2026-11` responde un consumo total de 1.465.600, las partes de Ana, que coincide con la base de Inicio.
- **Causa raíz (certeza media-alta):** Inicio, unificado desde P306/P310, habla en partes; Movimientos de un espacio habla en totales del espacio, y el enlace entre las dos pantallas no lleva la base.
- **Consecuencia:** dos números para una misma cosa, y la persona deja de confiar en ambos.
- **Solución recomendada:** cuando Inicio enlaza a un espacio, llegar a la parte de la persona ("Tu parte $ 753.600 de $ 1.884.000"), o etiquetar las dos cifras donde se encuentran.
- **Prioridad:** P2.
- **Esfuerzo:** bajo (etiqueta) a medio (un filtro de "mi parte" en Movimientos).
- **Métrica:** respuestas correctas a "¿Cuánto has gastado tú en Hogar este mes?".
- **Validación:** una prueba de cinco segundos y una prueba de componente de la etiqueta.

### A7. Mi consumo no tiene ninguna entrada · P2 · Comprobado

- **Problema:** la ruta `/spaces/{id}/my-consumption` sigue existiendo, pero nada enlaza a ella. Su "¿Por qué es distinto?", que la pasada 2 contaba entre las fortalezas, quedó inalcanzable.
- **Usuario afectado:** quien quiere entender por qué "lo que gasté" no coincide con "lo que pagué".
- **Contexto:** leer los totales de Inicio.
- **Evidencia:** la pasada 2 buscó en Inicio, Más, el menú del avatar y Configuración. En el código, `myConsumptionHref` solo lo usa la propia pantalla, para pasar de un período a otro ([`my-consumption-screen.tsx:33-34`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/unified/my-consumption-screen.tsx#L33-L34)).
- **Causa raíz (certeza alta):** P306/P310 rehicieron Inicio con "Solo tú" y "Con otros" y quitaron el atajo.
- **Consecuencia:** se perdió la explicación de la diferencia entre lo pagado y lo consumido (F3 de la pasada 1). La ruta huérfana además carga con código y con un presupuesto de script.
- **Solución recomendada:** enlazarla desde la tarjeta del mes en Inicio ("¿Por qué no coincide con lo que pagaste?") o eliminar la ruta y su pantalla.
- **Prioridad:** P2: superficie muerta más una explicación perdida.
- **Esfuerzo:** bajo en cualquiera de los dos casos.
- **Métrica:** visitas a la explicación; preguntas de soporte sobre los totales.
- **Validación:** una verificación de alcanzabilidad de rutas (cada ruta de la SPA tiene un enlace dentro de la app), agregada al e2e.

### A8. La cuenta por defecto es la primera por orden alfabético, no donde está el dinero · P2 · Comprobado

- **Problema:** tanto a personas nuevas como a miembros se les ofreció una cuenta que no usaban.
  - Diana cargó su saldo inicial en Efectivo, y su primer gasto propuso "Billetera digital".
  - El gasto de Juan en Hogar propuso "Pagó Juan desde Billetera digital"; él paga desde Davivienda.
- **Usuario afectado:** toda persona nueva, y cualquiera que registre desde un dispositivo que no tiene guardada una última cuenta.
- **Contexto:** los primeros registros; cualquier registro desde un dispositivo nuevo.
- **Evidencia:** pasadas 1 y 4. [`last-account.ts:34-39`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/last-account.ts#L34-L39): la última cuenta guardada en este navegador o, si no hay, la primera que no sea de ahorro en el orden de la lista. Entre las cinco cuentas iniciales, "Billetera digital" queda primera.
- **Causa raíz (certeza alta):** el valor de respaldo ignora saldos e historial, y la última cuenta se guarda por navegador.
- **Consecuencia:** gastos registrados en la cuenta equivocada y saldos que se desvían, la misma clase de problema que A2. Es más probable en la primera semana, cuando se forma la confianza.
- **Solución recomendada:** usar como respaldo la cuenta con el movimiento más reciente y, si no hay, la cuenta que no sea de ahorro con el saldo más alto. Mantener primero la última elección del navegador.
- **Prioridad:** P2.
- **Esfuerzo:** bajo.
- **Métrica:** proporción de gastos a los que se les cambia la cuenta después de guardarlos.
- **Validación:** una prueba unitaria de `preferredAccountId` y una consulta de las ediciones a `accountId`.

### A9. Una factura que espera su monto real solo se anuncia dentro de Movimientos de su espacio · P2 · Comprobado

- **Problema:** Energía, que vence hoy en Hogar y espera confirmación, aparece en tres lugares, y todos están dentro de Hogar:
  - Movimientos de Hogar: un aviso, "1 movimiento por confirmar · Energía · Revisar".
  - La barra de Hogar: una insignia en Movimientos.
  - Recurrentes de Hogar: una etiqueta "Para confirmar".

  El Inicio de Personal, donde aterriza Ana, y el Inicio de Hogar no dicen nada. Además, la tarjeta de Recurrentes dice "Próxima: 8/12/2026" mientras la fecha del 8/11 sigue pendiente.
- **Usuario afectado:** quien paga facturas variables del hogar (modo CONFIRM).
- **Contexto:** el día en que vence una factura.
- **Evidencia:** pasada 5, con el job de recurrencias encendido. El flujo de confirmación en sí es bueno (sección 2). Con el servidor de e2e el job está apagado, así que la pasada 3 solo vio la etiqueta y ninguna acción.
- **Causa raíz (certeza media):** la lista de pendientes se lee por espacio y se muestra en el libro de ese espacio; el Inicio unificado no la reúne.
- **Consecuencia:** las facturas quedan sin registrar hasta que alguien abre, por casualidad, Movimientos del espacio correcto, así que los saldos y el plan se atrasan respecto de la realidad.
- **Solución recomendada:** una fila "Por confirmar (1)" en el Inicio de Personal que reúna las pendientes de todos los espacios. En la tarjeta de Recurrentes: "Pendiente: 8/11 · Confirmar".
- **Prioridad:** P2.
- **Esfuerzo:** bajo a medio (una lectura más en Inicio; verificar su presupuesto).
- **Métrica:** mediana de días entre el vencimiento y la confirmación.
- **Validación:** una consulta a la base de datos sobre `pending-occurrences` antes y después.

### A10. El Inicio de Personal muestra lo que debes, pero no lo que te deben · P2 · Comprobado (en pantalla); causa raíz no rastreada

- **Problema:** el Inicio de Personal muestra una sola tarjeta, "Te toca poner $ 275.000 a Pedro · En Viaje Cartagena · Saldar". Faltan los dos montos que le deben a Ana: Hogar ($ 311.400) y Ana & Mateo ($ 30.000).
- **Usuario afectado:** cualquiera que esté en más de un espacio compartido.
- **Contexto:** el vistazo diario.
- **Evidencia:** pasada 3. El selector sí muestra todos los saldos.
- **Causa raíz (certeza baja):** no se rastreó en el código. Puede que la tarjeta muestre solo la deuda más grande, o solo las deudas.
- **Consecuencia:** el dinero que le deben a la persona es invisible en la pantalla que abre todos los días.
- **Solución recomendada:** una tarjeta compacta de saldos que liste cada espacio con saldo, en las dos direcciones: "Te deben $ 341.400 · Debes $ 275.000".
- **Prioridad:** P2.
- **Esfuerzo:** bajo a medio.
- **Métrica:** visitas a Saldos que terminan en un pago.
- **Validación:** una prueba de componente con deudas y créditos en varios espacios.

### A11. Personal habla de roles y de un hogar · P2 · Comprobado (H3 de la pasada 2)

- **Problema:** Personal, que se usa a solas, toma prestado el vocabulario de un espacio compartido.
  - Sin plan, Personal le muestra "Solo Propietario y Administrador ven estas acciones." a su única persona.
  - El planificador dice "Por repartir $ 200.000" justo al lado de "Ana $ 1.600.000 · 100,00 %".
  - Los rubros dicen "Según aportes" y "Empieza de cero".
- **Usuario afectado:** todas las personas que usan Hearth solas, que es el caso base del producto (resumen funcional, sección 0).
- **Contexto:** armar y leer el plan personal.
- **Evidencia:** pasadas 1 y 2. [`no-plan.tsx:61`](https://github.com/Facabore/Hearth/blob/main/src/modules/reporting/ui/lines/no-plan.tsx#L61) muestra `managersSee` sin importar el tipo de espacio.
- **Causa raíz (certeza alta):** los textos del espacio compartido se reutilizan en Personal.
- **Consecuencia:** carga cognitiva en el primer plan; aparecen roles en un espacio que no tiene roles.
- **Solución recomendada:** ocultar `managersSee` cuando el espacio es PERSONAL. En Personal, escribir "Por repartir" como "Te falta asignar $ 200.000 de $ 1.600.000" y quitar "Según aportes".
- **Prioridad:** P2.
- **Esfuerzo:** bajo.
- **Métrica:** proporción de planes personales creados y activados.
- **Validación:** una prueba de componente por tipo de espacio.

### A12. Movimientos titula "Gasto" a un gasto sin descripción · P2 · Comprobado (H4 de la pasada 2)

- **Problema:** la fila dice "Gasto · Tarjeta de crédito". Su categoría es solo el ícono, que tiene `aria-hidden`, así que un lector de pantalla nunca la anuncia.
- **Usuario afectado:** todos los que revisan su historial, y sobre todo quienes usan lector de pantalla.
- **Evidencia:** pasada 2; [`transaction-row.tsx:107`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/transaction-row.tsx#L107): `tx.description || t(\`type.${kind}\`)`.
- **Causa raíz (certeza alta):** el título recurre al tipo de movimiento, no a la categoría.
- **Solución recomendada:** recurrir al nombre de la categoría ("Restaurantes").
- **Prioridad:** P2. Esfuerzo bajo, y cierra una brecha de accesibilidad.
- **Esfuerzo:** bajo.
- **Métrica:** detalles abiertos antes de encontrar el movimiento buscado.
- **Validación:** una prueba de componente y una verificación con lector de pantalla.

### A13. Una transferencia no dice cuál cuenta es el origen y cuál el destino · P2 · Comprobado

- **Problema:** el formulario de transferencia muestra dos chips, "Bancolombia" y "Elegir cuenta", sin "De" ni "A". Solo el título del selector dice "Hacia".
- **Usuario afectado:** quien mueve dinero entre sus cuentas (al ahorro, para pagar la tarjeta).
- **Evidencia:** pasada 2 a 390×844.
- **Causa raíz (certeza media):** los chips no tienen etiqueta visible.
- **Consecuencia:** una transferencia al revés, que desvía dos saldos a la vez.
- **Solución recomendada:** "De Bancolombia → A Elegir cuenta", o dos filas con etiqueta.
- **Prioridad:** P2.
- **Esfuerzo:** bajo.
- **Métrica:** transferencias editadas o eliminadas dentro de los diez minutos siguientes.
- **Validación:** una prueba de componente de las etiquetas.

### A14. Elegir la categoría es la parte más lenta de registrar · P2 · Comprobado (toques); Hipótesis (impacto)

- **Problema:**
  - Un primer gasto tomó unos 14 toques.
  - Sin recientes, las categorías rápidas son "Arriendo, Mantenimiento, Servicios", las primeras del árbol.
  - El grupo solo ("Transporte") no se acepta.
  - Un ingreso no trae categoría por defecto, aunque "Salario" y "Otros ingresos" son las únicas opciones.
  - "Elige una categoría." aparece solo después de tocar guardar.
- **Usuario afectado:** sobre todo las personas nuevas; todos, en cada registro.
- **Evidencia:** pasadas 1 a 3. Las tarjetas recurren a las primeras categorías del árbol ([`category-tiles.tsx:13-27`](https://github.com/Facabore/Hearth/blob/main/src/modules/ledger/ui/record/category-tiles.tsx#L13-L27)).
- **Causa raíz (certeza media):** los recientes se guardan por navegador (#173, H8 de la pasada 2), y el respaldo no tiene noción de categorías frecuentes.
- **Consecuencia:** un primer registro lento, justo el momento que decide si se forma el hábito.
- **Solución recomendada:**
  - Llenar las tarjetas vacías con las categorías iniciales más comunes (Mercado, Restaurantes, Transporte público).
  - Preseleccionar "Salario" en un ingreso cuando hay una sola opción obvia.
  - Marcar la categoría como obligatoria antes de guardar.
- **Prioridad:** P2.
- **Esfuerzo:** bajo.
- **Métrica:** toques y segundos por registro; proporción registrada desde una tarjeta rápida.
- **Validación:** una prueba de tarea cronometrada: "Registra un almuerzo de 18.500".

### A15. Las cifras y estados de las cuentas nunca se explican · P2 · Hipótesis (H7 de la pasada 2)

- **Problema:** varios términos y estados de Cuentas no tienen explicación.
  - "Disponible" y "Patrimonio neto" no se explican, y tampoco "fuera del disponible" en la tarjeta de crédito y el ahorro.
  - "Efectivo −$ 30.500" aparece en una cuenta que no puede quedar en negativo, sin ninguna aclaración.
  - "Saldo inicial" no dice qué pasa al cambiarlo.
- **Usuario afectado:** las personas nuevas, y cualquiera que no haya cargado sus saldos iniciales.
- **Evidencia:** pasadas 1 y 2. Las dos cifras cuadran: 1.678.000 es la suma de las cuentas de banco y efectivo; 1.932.000 resta la tarjeta y suma el ahorro.
- **Causa raíz (certeza media):** el vocabulario es correcto, pero se da por sabido.
- **Solución recomendada:** una línea de ayuda bajo cada total ("Lo que puedes usar hoy: bancos, billeteras y efectivo"). En una cuenta que no es de crédito y está bajo cero: "¿Falta el saldo inicial?".
- **Prioridad:** P2.
- **Esfuerzo:** bajo.
- **Métrica:** proporción de cuentas que no son de crédito y están bajo cero.
- **Validación:** una consulta a la base de datos y entrevistas.

### A16. A una persona Lectora le desaparecen acciones sin explicación · P3 · Comprobado

- **Problema:** el Hogar de Sofi no tiene "+" en la barra, ni "Invitar", ni los controles del editor del plan, y nada lo explica. La frase clara solo aparece si escribe a mano la URL de registrar: "Tu rol en Hogar es Lector: puedes ver sus movimientos, pero no registrarlos." "Nombre y color" sí se explica sola, y ese es el patrón a copiar.
- **Usuario afectado:** las personas lectoras, un rol poco común hoy.
- **Evidencia:** pasada 4.
- **Causa raíz (certeza alta):** las acciones se ocultan en vez de explicarse.
- **Solución recomendada:** una línea en el Inicio del espacio para quien es Lector: "Eres Lector en Hogar: ves todo, no registras".
- **Prioridad:** P3.
- **Esfuerzo:** bajo.
- **Métrica:** ninguna que valga la pena instrumentar todavía.
- **Validación:** una prueba de componente.

### A17. Teclado: no hay enlace para saltar al contenido y se necesitan veinte Tab para llegar a Registrar · P3 · Comprobado a 658 px

- **Problema:**
  - El primer Tab cae en el selector de espacios; no hay enlace para saltar al contenido.
  - Llegar al "+" toma 20 Tab, y un gasto completo con teclado, unas 49 pulsaciones.
  - Después de guardar o de Escape, el foco va al contenedor de la página, no a la fila nueva ni al aviso.

  El anillo de foco se vio en todas las paradas revisadas, salvo en el "+" de la barra (sin confirmar), y Escape cierra Registrar sin problemas.
- **Usuario afectado:** quienes usan teclado o interruptores; quienes usan escritorio.
- **Evidencia:** pasada 5.
- **Causa raíz (certeza media):** la barra va al final del DOM y no hay un destino para saltar.
- **Solución recomendada:** un enlace "Saltar al contenido" y un atajo a Registrar; devolver el foco a la fila nueva o anunciar el aviso.
- **Prioridad:** P3, hasta medir el uso en escritorio (H11).
- **Esfuerzo:** bajo.
- **Validación:** un e2e de axe y teclado a ancho de escritorio.

### A18. Recuperar la contraseña requiere a otra persona · P3 · Oportunidad

- **Problema:** "¿Olvidaste tu contraseña?" responde "Pídele a quien administra Hearth que la restablezca." Además, en producción el registro está cerrado (`GET /api/v1/auth/sign-up` → `{"signUp":"closed"}`), así que alguien de afuera no puede descubrir el producto.
- **Usuario afectado:** quien queda sin acceso; quien no tiene invitación.
- **Evidencia:** pasada 1; el endpoint público de producción.
- **Causa raíz (certeza alta):** una decisión operativa deliberada. El dueño restablece contraseñas con `scripts/reset-password.mjs`, y el registro se controla con `HEARTH_SIGN_UP` (decisión P143).
- **Consecuencia:** cada bloqueo le cuesta tiempo al dueño; la adquisición es solo por invitación.
- **Solución recomendada:** ninguna hasta que exista el envío de correos. Después, restablecimiento por cuenta propia. Mantener el registro cerrado hasta que el dueño decida el lanzamiento.
- **Prioridad:** P3 (es una decisión de negocio, no un defecto).
- **Esfuerzo:** medio a alto (envío de correos).

### A19. Restos de textos y de diseño · P3 · Comprobado

- **Hoja de dividir:** "Los invitados de un espacio compartido no aparecen aquí" aparece justo debajo de "Mateo (invitado) · De «Ana & Mateo»". Todavía explica detalles internos ("se crea en COP, la moneda de tu espacio Personal"). El H9 de la pasada 2 no cambió.
- **Primeros pasos:** "Comparte con tu hogar" queda abierto para alguien que solo comparte con una persona (H10 de la pasada 2).
- **Saldar:** la etiqueta "A" de quien recibe todavía se lee como una inicial (H12 de la pasada 2).
- **Plan:** el rubro comodín dice "Todo lo demás / Todo lo demás". El monto a la derecha de cada rubro (lo que queda) no tiene etiqueta.
- **A 320 px:**
  - "Restaura/ntes" y "Manteni/miento" se cortan a mitad de palabra.
  - "Transferencia" toca el borde del control segmentado.
  - Las etiquetas "Inicio" y "Movimientos" de la barra casi se tocan.
  - Las tarjetas de Saldar truncan "Viaje Cart…".
- **Editar cuenta:** el ícono de archivar no tiene nombre accesible (2 controles sin etiqueta).
- **Esfuerzo:** bajo en cada caso.

### A20. En escritorio la app es una columna de celular estirada · P3 · Hipótesis (H11 de la pasada 2)

- **Problema:** con el panel a 658 px, las filas miden 640 px de ancho, los nombres quedan lejos de sus montos y la barra sigue fija. Registrar no tiene un botón de cerrar visible; solo se cierra con su tirador o con Escape.
- **Evidencia:** pasada 5. No se pudo probar un ancho real de escritorio (Claude in Chrome no conectó).
- **Siguiente paso:** medir la proporción de sesiones en escritorio antes de diseñar para ellas.

### A21. El "Inicio" de Hogar abre Personal · P3 · Hipótesis

- **Problema:** dentro de Hogar, el "Inicio" de la barra apunta al espacio Personal de la persona (P310: "Inicio siempre es personal"). Salir de un espacio tocando "Inicio" puede sorprender a quien espera el inicio de ese espacio.
- **Evidencia:** pasada 4 (solo se leyó el href, no se tocó).
- **Validación:** observar a tres personas navegar Hogar → Inicio → atrás.

### A22. El selector de espacios a veces necesita varios toques · Sin comprobar

- **Problema:** en la pasada 5, la píldora "Personal ▾" muchas veces no abrió el diálogo, ni con clic ni con Enter. En las pasadas 3 y 4 se abrió en dos toques.
- **Evidencia:** los clics del panel fallaron en varias pasadas, así que puede ser la herramienta.
- **Siguiente paso:** volver a probarlo en un celular real antes de actuar.

## 4. Qué cambió desde la pasada 2

| Hallazgo de la pasada 2 | Estado en `main` `d6caf292` |
|---|---|
| M6, el ciclo del planificador | Corregido; se mantuvo en las pasadas 2 y 3. |
| M4, Registrar descentrado | Corregido (barra de cinco lugares). |
| H5, pago con "→" y sin nombres | Corregido en `048e5262`; Saldos nombra a las dos partes. |
| H13, rubros sin categoría | (b) y (c) corregidos en `b37f0186` (el planificador marca "Sin categorías: no cuenta ningún gasto"); (a) sigue pendiente. |
| M1, guardar debajo del pliegue | **Abierto y más amplio:** cuatro formularios (A1). |
| H1 / M2, pago sin cuenta | **Abierto** (A2). |
| H2, tres respuestas a "cuánto queda" | **Abierto** (A3). |
| H3, el plan personal habla como un hogar | **Abierto** (A11). |
| H4, filas tituladas "Gasto" | **Abierto** (A12). |
| H7, saldos negativos | **Abierto** (A15). |
| H8, H9, H10, H11, H12 | Abiertos (A14, A19, A20). |
| Fortaleza "Mi consumo se explica solo" | **Perdida:** la pantalla no tiene entrada (A7). |

## 5. Recorridos y pantallas con fricción

| Recorrido | Fricción | Hallazgos |
|---|---|---|
| Registrar un gasto en un celular pequeño | Guardar debajo del pliegue; categoría en 3–4 toques; cuenta por defecto equivocada | A1, A14, A8 |
| Seguir el plan del hogar | Sin puerta de entrada; una cifra principal que cuenta el ahorro; estados contradictorios | A4, A3, A5 |
| Recibir un reembolso | No llega a ninguna cuenta; los créditos no aparecen en Inicio | A2, A10 |
| Leer "cómo voy este mes" | Partes en Inicio, totales en el espacio; Mi consumo inalcanzable | A6, A7 |
| Pagar una factura variable | Solo se anuncia dentro de Movimientos de su espacio | A9 |
| La primera semana a solas | Jerga de roles, cifras sin explicar, efectivo en negativo | A11, A15 |

## 6. Necesidades no satisfechas

1. **Un número por pregunta.** "¿Cuánto puedo gastar?", "¿Cuánto me falta poner?" y "¿Cuánto gasté?" deben tener una sola respuesta, la misma en todas las pantallas (A3, A5, A6).
2. **Cuentas que coincidan con el dinero real sin tener que pensarlo** (A2, A8, A13, A15).
3. **Todo lo que me necesita hoy, en la pantalla que abro:** lo que debo, lo que me deben y las facturas por confirmar (A9, A10).
4. **El plan del hogar como un lugar, no como un ajuste** (A4).

## 7. Hoja de ruta priorizada

| Orden | Hallazgo | Por qué primero | Esfuerzo |
|---|---|---|---|
| 1 | A1, guardar fijo | La tarea más frecuente, en celulares comunes, con un patrón conocido | Bajo–medio |
| 2 | A2, destino del pago | Causa de una línea; confianza en el dinero | Bajo |
| 3 | A3, cifra principal sin ahorro | La cifra central del plan; la API ya está lista | Bajo |
| 4 | A4, puerta al plan compartido | Tarea central escondida; requiere la elección del dueño | Bajo |
| 5 | A8, cuenta por defecto | Misma clase que A2; primera semana | Bajo |
| 6 | A12, A13, A11 | Textos y etiquetas, cada uno barato | Bajo |
| 7 | A9, A10 | Un bloque "te necesita hoy" en Inicio | Medio |
| 8 | A5, A6, A7 | Nombrar las bases; enlazar o eliminar Mi consumo | Bajo–medio |
| 9 | A14, A15 | Velocidad y claridad de los primeros registros | Bajo |
| 10 | A16–A22 | Cuando convenga, o después de medir | Bajo |

## 8. Plan de validación y métricas

- **Esta semana, sin usuarios:**
  - Un e2e a 375×667 y 320×640 que verifique que cada acción principal está dentro del viewport (A1).
  - Pruebas de componente para A2, A3, A11, A12 y A13.
  - Una verificación de alcanzabilidad de rutas, para que cada ruta de la SPA tenga un enlace dentro de la app (A7).
  - Consultas a la base de datos: pagos recibidos sin cuenta (A2), cuentas que no son de crédito bajo cero (A15) y ocurrencias pendientes de más de tres días (A9).
- **Con cinco personas, en un celular, una tarea cada una:**
  - "¿Cuánto puedes gastar todavía este mes?" (A3)
  - "¿Cuánto le falta poner a Ana?" (A5)
  - "Abre el plan de Hogar" (A4)
  - "Registra un almuerzo de 18.500" (A1, A8, A14)
  - "Juan te pagó en efectivo, regístralo" (A2)
- **Eventos mínimos de analítica** (hoy no hay ninguno, como ya señaló la pasada 2):
  - Registro iniciado y guardado, por altura de pantalla.
  - Plan abierto, por tipo de espacio.
  - Pago guardado con o sin cuenta.
  - Ocurrencia pendiente confirmada, y su demora.
  - Tipo de dispositivo.

  Estos eventos requieren el consentimiento explícito y la política de privacidad que el dueño ya tiene pendientes (Ley 1581).

## 9. Qué aumentaría la certeza

- Saber si hay usuarios reales además del dueño, y de qué tipo (hogar, pareja, viaje). Hoy toda afirmación sobre frecuencia y retención es una inferencia.
- Saber si el escritorio es un contexto soportado (A17, A20).
- Saber si con P311 el dueño quiso dejar el plan de un espacio compartido solo dentro de Configuración (A4).
- Una pasada en un celular real con un lector de pantalla real, para resolver A12, A17 y A22 y la inestabilidad de los clics del panel.
- Por qué la invitada "Rosa" apareció en la lista de quién pagó de Juan pero no en "Para quién" (pasada 4). Se vio una sola vez y no se rastreó; puede ser una lectura desactualizada después de agregarla.
