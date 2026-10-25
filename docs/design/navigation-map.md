# Navigation map

- **Status:** Generated on 2026-10-23 from the wired Penpot prototype (file "Hearth", page "Prototipo · la historia de Ana"), the source of truth for navigation.
- **How to read it:** each row is one tappable element and where it takes you. Italic entries act on the same screen; ↩ goes back.
- **Totals:** 70 screens and 695 tappable elements. Of those, 345 open another screen, 6 go back and 344 act on the same screen. Every navigational tap resolves to an existing screen.
- **Story:** the 9 cases of Ana's story, with start, end and verified route, are in [prototype-story.md](prototype-story.md) and on the prototype's index board.

## Screens nothing links to

| Screen | Why |
|---|---|
| Miembros · rol Miembro | role variant of Miembros |
| Miembros · rol Lector | role variant of Miembros |
| Página para reclamar lugar de invitado · HU-E9-05 | opened from the claim link outside the app |
| Invitación vencida · HU-E9-05 | opened from an expired link outside the app |
| División inválida: 10 % sin asignar · HU-E9-06 | error state of the split editor |
| Dividir con alguien desde Personal · HU-E9-06 | **gap**: no entry point; see critique #14 |
| Pago de un invitado: sin cuenta de origen · HU-E9-07 | state when the guest pays (another space) |
| Planeador: error al activar (asignación 99 %) · HU-E9-08 | error state of the planner |
| Tableros de Hogar en escritorio · HU-E9-10 | desktop layout |
| Adaptación a escritorio · HU-E9-01 | desktop layout |
| Cerrar plan: confirmación · HU-E9-08 | reachable once the period ends (button disabled in the draft) |
| Formatos es / en · HU-E9-02 | reference board, not a screen |

## E9-05

### Miembros de Hogar: los controles siguen el rol · HU-E9-05

Reached from 9 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |
| Invitar | Invitar por enlace o correo · HU-E9-05 |
| Agregar invitado | Agregar invitado · HU-E9-05 |
| Rol de Juan: Administrador. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Rol de Luis: Miembro. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Rol de Sofi: Lector. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Opciones de Pedro (invitado) | Invitado: enlace para reclamar y quitar con saldo · HU-E9-05 |
| Revocar (marta@example.com) | Invitación revocada con deshacer · HU-E9-05 |
| Copiar enlace de invitación | _[copia al portapapeles]_ |
| Revocar (Enlace de invitación) | Invitación revocada con deshacer · HU-E9-05 |

### Miembros · rol Miembro

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |
| Agregar invitado | Agregar invitado · HU-E9-05 |
| Opciones de Pedro (invitado) | Invitado: enlace para reclamar y quitar con saldo · HU-E9-05 |

### Miembros · rol Lector

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |

### Invitar por enlace o correo · HU-E9-05

Reached from 2 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |
| Enlace | _[muestra enlace]_ |
| Correo | _[muestra correo]_ |
| Administrador | _[elige rol al unirse]_ |
| Miembro | _[elige rol al unirse]_ |
| Lector | _[elige rol al unirse]_ |
| Copiar | _[copia al portapapeles]_ |

### Agregar invitado · HU-E9-05

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |
| Agregar invitado | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |

### Invitado: enlace para reclamar y quitar con saldo · HU-E9-05

Reached from 5 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |
| Copiar | _[copia al portapapeles]_ |
| Saldar | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Quitar de Hogar | Quitar invitado sin saldo: confirmación · HU-E9-05 |

### Crear espacio compartido desde el selector · HU-E9-05

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Espacios | Cambiar de espacio · HU-E9-01 |
| Moneda | _[abre selector de moneda]_ |
| Mensual | _[elige período]_ |
| Quincenal | _[elige período]_ |
| Crear espacio | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |

### Página pública de invitación · HU-E9-05

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Crear cuenta y unirme | Crear cuenta · error EmailTaken · HU-E9-01 |
| Ya tengo cuenta: iniciar sesión | Iniciar sesión · HU-E9-01 |

### Página para reclamar lugar de invitado · HU-E9-05

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Crear cuenta y reclamar | Crear cuenta · error EmailTaken · HU-E9-01 |
| Ya tengo cuenta: iniciar sesión | Iniciar sesión · HU-E9-01 |

### Invitación vencida · HU-E9-05

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Ir a Hearth | Iniciar sesión · HU-E9-01 |

## E9-06

### Gasto en Hogar: división según el plan preseleccionada · HU-E9-06

Reached from 18 tap(s).

| Tap | Goes to |
|---|---|
| Gasto | _[cambia tipo de movimiento]_ |
| Ingreso | _[cambia tipo de movimiento]_ |
| Transferencia | _[cambia tipo de movimiento]_ |
| Mercado | _[elige categoría]_ |
| Arriendo | _[elige categoría]_ |
| Servicios | _[elige categoría]_ |
| Ver todas las categorías | Elegir categoría y subcategoría · HU-E9-03 |
| Fecha y hora: 8 de noviembre, 14:32. Cambiar | _[abre selector de fecha]_ |
| Espacio: Hogar. Cambiar | Cambiar de espacio · HU-E9-01 |
| Pagó Ana · División Según el plan (Casa) | Editor de división con vista previa en vivo · HU-E9-06 |
| 1 | _[teclado numérico]_ |
| 2 | _[teclado numérico]_ |
| 3 | _[teclado numérico]_ |
| 4 | _[teclado numérico]_ |
| 5 | _[teclado numérico]_ |
| 6 | _[teclado numérico]_ |
| 7 | _[teclado numérico]_ |
| 8 | _[teclado numérico]_ |
| 9 | _[teclado numérico]_ |
| 000 | _[teclado numérico]_ |
| 0 | _[teclado numérico]_ |
| Borrar | _[teclado numérico]_ |
| Guardar gasto | Guardado con aviso: fondo en negativo · HU-E9-06 |
| Cerrar el registro (propuesta P0) | Descartar gasto: confirmación al cerrar el registro |

### Editor de división con vista previa en vivo · HU-E9-06

Reached from 2 tap(s).

| Tap | Goes to |
|---|---|
| Volver al registro | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Ana (tú) | _[elige quién pagó]_ |
| Juan | _[elige quién pagó]_ |
| Pedro (invitado) | _[elige quién pagó]_ |
| Fondo Hogar | _[elige quién pagó]_ |
| Cuenta: Bancolombia. Cambiar | Elegir cuenta · selector compartido |
| Según el plan | _[cambia método]_ |
| Iguales | _[cambia método]_ |
| Porcentaje | _[cambia método]_ |
| Montos | _[cambia método]_ |
| Partes | _[cambia método]_ |
| Listo | ↩ back to the previous screen |

### División inválida: 10 % sin asignar · HU-E9-06

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Volver al registro | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Ana (tú) | _[elige quién pagó]_ |
| Juan | _[elige quién pagó]_ |
| Pedro (invitado) | _[elige quién pagó]_ |
| Fondo Hogar | _[elige quién pagó]_ |
| Cuenta: Bancolombia. Cambiar | Elegir cuenta · selector compartido |
| Según el plan | _[cambia método]_ |
| Iguales | _[cambia método]_ |
| Porcentaje | _[cambia método]_ |
| Montos | _[cambia método]_ |
| Partes | _[cambia método]_ |
| Ana (tú) | _[marca o desmarca]_ |
| Juan | _[marca o desmarca]_ |
| Pedro (invitado) | _[marca o desmarca]_ |
| Listo | _[deshabilitado hasta que la división cuadre]_ |

### Dividir con alguien desde Personal · HU-E9-06

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Volver al registro | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Juan | _[elige persona]_ |
| Luis | _[elige persona]_ |
| Carlos (invitado) | _[elige persona]_ |
| Usar | _[usa el nuevo invitado]_ |
| Seguir con Juan | Editor de división con vista previa en vivo · HU-E9-06 |

### Guardado con aviso: fondo en negativo · HU-E9-06

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Hogar. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Cerrar aviso | _[cierra el aviso]_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

## E9-07

### Saldos y sugerencias para quedar a paz y salvo · HU-E9-07

Reached from 24 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Viaje 2026. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Saldar (Juan) | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Saldar (Luis) | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Saldar otro monto | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Ana: le deben $ 150.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| Juan: debe $ 100.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| Luis: debe $ 50.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| En Hogar: debes $ 120.000 a Juan | _Saldos y sugerencias para quedar a paz y sal_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | _Saldos y sugerencias para quedar a paz y sal_ |

### Registrar pago prellenado; invitado sin cuenta · HU-E9-07

Reached from 6 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Juan | _[elige quién paga]_ |
| Luis | _[elige quién paga]_ |
| Llega a: Nequi | Elegir cuenta · selector compartido |
| Guardar pago | Saldos después de saldar: Juan a paz y salvo · HU-E9-07 |

### Pago de un invitado: sin cuenta de origen · HU-E9-07

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Pedro (invitado) | _[elige quién paga]_ |
| Juan | _[elige quién paga]_ |
| Llega a: Nequi | Elegir cuenta · selector compartido |
| Guardar pago | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Historial de saldo de un miembro · HU-E9-07

Reached from 6 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Rango: 1 al 31 de octubre de 2026. Cambiar | _[abre selector de rango]_ |

### Saldos después de saldar: Juan a paz y salvo · HU-E9-07

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Viaje 2026. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Saldar (Luis) | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Saldar otro monto | Registrar pago prellenado; invitado sin cuenta · HU-E9-07 |
| Ana: le deben $ 150.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| Juan: debe $ 100.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| Luis: debe $ 50.000. Ver historial | Historial de saldo de un miembro · HU-E9-07 |
| En Hogar: debes $ 120.000 a Juan | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

## E9-08

### Planeador: capacidad, líneas y ciclo del plan · HU-E9-08

Reached from 11 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Capacidad total $ 4.000.000. Editar capacidades | Capacidades con sugerencia privada · HU-E9-08 |
| Agregar línea | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Arriendo | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Casa | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Ahorro | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Libre | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Activar plan | Activar plan: confirmación · HU-E9-08 |

### Planeador: error al activar (asignación 99 %) · HU-E9-08

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Capacidad total $ 4.000.000. Editar capacidades | Capacidades con sugerencia privada · HU-E9-08 |
| Agregar línea | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Arriendo | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Casa | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Ahorro | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Libre | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Activar plan | Activar plan: confirmación · HU-E9-08 |

### Planeador: plan cerrado, solo lectura · HU-E9-08

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Capacidad total $ 4.000.000. Editar capacidades | Capacidades con sugerencia privada · HU-E9-08 |
| Arriendo (solo lectura) | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Casa (solo lectura) | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Ahorro (solo lectura) | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Libre (solo lectura) | Editar línea: financiación, categorías y asignación · HU-E9-08 |

### Capacidades con sugerencia privada · HU-E9-08

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Usar sugerencia | _[pone $ 1.650.000 en la capacidad de Ana]_ |
| Guardar capacidades | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |

### Editar línea: financiación, categorías y asignación · HU-E9-08

Reached from 20 tap(s).

| Tap | Goes to |
|---|---|
| Volver al planeador | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Directo | _[elige de dónde sale]_ |
| Fondo | _[elige de dónde sale]_ |
| Ahorro | _[elige de dónde sale]_ |
| Elegir | Elegir categorías de una línea · HU-E9-08 |
| Todo lo demás | _[alterna recibir todo lo demás]_ |
| Reinicia | _[elige al cambiar de mes]_ |
| Acumula | _[elige al cambiar de mes]_ |
| Ajusta | _[elige al cambiar de mes]_ |
| Según capacidad | _[cambia la regla de asignación]_ |
| Porcentaje | _[cambia la regla de asignación]_ |
| Monto fijo | _[cambia la regla de asignación]_ |
| Sin asignar | _[cambia la regla de asignación]_ |
| Valor de Ana | _[edita el porcentaje]_ |
| Valor de Juan | _[edita el porcentaje]_ |
| Guardar línea | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |

### Plan copiado del período anterior · HU-E9-08

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Plan | Período sin plan · HU-E9-10 |
| Arriendo | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Casa | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Ahorro | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Libre | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Activar plan | Activar plan: confirmación · HU-E9-08 |

## E9-10

### Plan › Líneas: planeado, gastado y disponible · HU-E9-10

Reached from 21 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Hogar. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Editar plan | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | _Plan › Líneas: planeado, gastado y disponibl_ |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | _Plan › Líneas: planeado, gastado y disponibl_ |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Período sin plan · HU-E9-10

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Hogar. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Período anterior: diciembre 2026 | _[período anterior]_ |
| Período siguiente: febrero 2027 | _[período siguiente]_ |
| Líneas | _Período sin plan · HU-E9-10_ |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Copiar plan anterior | Plan copiado del período anterior · HU-E9-08 |
| Crear plan | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Plan › Miembros: matriz por línea · HU-E9-10

Reached from 6 tap(s).

| Tap | Goes to |
|---|---|
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Miembros | _Plan › Miembros: matriz por línea · HU-E9-10_ |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Ver fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Plan › Fondo: esperado y real · HU-E9-10

Reached from 9 tap(s).

| Tap | Goes to |
|---|---|
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | _Plan › Fondo: esperado y real · HU-E9-10_ |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Registrar aporte al fondo | Aporte al fondo común · HU-E9-10 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Plan › Por grupo con detalle por niveles · HU-E9-10

Reached from 10 tap(s).

| Tap | Goes to |
|---|---|
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | _Plan › Por grupo con detalle por niveles · H_ |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Vivienda: $ 1.600.000, 56,94 %. Ver detalle | _[abre categorías de Vivienda]_ |
| Alimentación: $ 960.000, 34,16 %. Ver detalle | Plan › Por grupo: detalle de Comida · HU-E9-10 |
| Ocio: $ 250.000, 8,90 %. Ver detalle | _[abre categorías de Ocio]_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Plan › Por grupo: detalle de Comida · HU-E9-10

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | Tendencia por línea de Hogar · HU-E9-11 |
| Todos los grupos | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Mercado: $ 900.000, 93,75 %. Ver detalle | _[abre subcategorías de Mercado]_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Tableros de Hogar en escritorio · HU-E9-10

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Registrar | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Plan | _Tableros de Hogar en escritorio · HU-E9-10_ |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Espacio actual: Hogar. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Editar plan | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Vivienda: $ 1.600.000, 56,94 %. Ver categorías | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Alimentación: $ 960.000, 34,16 %. Ver categorías | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Ocio: $ 250.000, 8,90 %. Ver categorías | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Ver tendencia de 6 períodos | Tendencia por línea de Hogar · HU-E9-11 |

## E9-11

### Mi consumo: vista unificada · HU-E9-11

Reached from 4 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Período anterior | _[período anterior]_ |
| Período siguiente | _[período siguiente]_ |
| Mi consumo | _Mi consumo: vista unificada · HU-E9-11_ |
| Por grupo | Mi consumo por grupo, filas unidas · HU-E9-11 |
| Tendencia | Mi tendencia de 6 períodos · HU-E9-11 |
| Líneas | Mi plan personal › Líneas · HU-E9-11 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | _Mi consumo: vista unificada · HU-E9-11_ |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Mi consumo por grupo, filas unidas · HU-E9-11

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Mi consumo | Mi consumo: vista unificada · HU-E9-11 |
| Por grupo | _Mi consumo por grupo, filas unidas · HU-E9-1_ |
| Tendencia | Mi tendencia de 6 períodos · HU-E9-11 |
| Líneas | Mi plan personal › Líneas · HU-E9-11 |
| Alimentación: $ 1.095.000, 68,44 %. Ver categorí | _[abre categorías de Alimentación]_ |
| Vivienda: $ 480.000, 30,00 %. Ver categorías | _[abre categorías de Vivienda]_ |
| Hogar / Mascotas: $ 25.000, 1,56 %. Ver categorí | _[abre categorías de Hogar / Mascotas]_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Mi consumo: vista unificada · HU-E9-11 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Mi tendencia de 6 períodos · HU-E9-11

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Mi consumo | Mi consumo: vista unificada · HU-E9-11 |
| Por grupo | Mi consumo por grupo, filas unidas · HU-E9-11 |
| Tendencia | _Mi tendencia de 6 períodos · HU-E9-11_ |
| Líneas | Mi plan personal › Líneas · HU-E9-11 |
| Último período | _[abre selector: 6 o 12 períodos]_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Mi consumo: vista unificada · HU-E9-11 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Tendencia por línea de Hogar · HU-E9-11

Reached from 7 tap(s).

| Tap | Goes to |
|---|---|
| Terminar en octubre 2026 | _[período anterior]_ |
| Terminar en diciembre 2026 | _[período siguiente]_ |
| Líneas | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Miembros | Plan › Miembros: matriz por línea · HU-E9-10 |
| Fondo | Plan › Fondo: esperado y real · HU-E9-10 |
| Por grupo | Plan › Por grupo con detalle por niveles · HU-E9-10 |
| Tendencia | _Tendencia por línea de Hogar · HU-E9-11_ |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

## B1 acceso

### Iniciar sesión · HU-E9-01

Reached from 7 tap(s).

| Tap | Goes to |
|---|---|
| Cambiar idioma, actual español | _[cambia idioma]_ |
| Mostrar contraseña | _[muestra la contraseña]_ |
| Iniciar sesión | Inicio · HU-E9-01 |
| Crear una cuenta | Crear cuenta · error EmailTaken · HU-E9-01 |

### Crear cuenta · error EmailTaken · HU-E9-01

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Volver a iniciar sesión | Iniciar sesión · HU-E9-01 |
| Cambiar idioma, actual español | _[cambia idioma]_ |
| Inicia sesión | Iniciar sesión · HU-E9-01 |
| Mostrar contraseña | _[muestra la contraseña]_ |
| Crear cuenta | Inicio · HU-E9-01 |
| Inicia sesión | Iniciar sesión · HU-E9-01 |

### Inicio · HU-E9-01

Reached from 23 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Ocultar saldos | _[oculta los saldos]_ |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Saldar | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Ver todas | Cuentas por tipo · HU-E9-03 |
| Ver todo | Movimientos por día y hora · HU-E9-03 |
| Inicio | _Inicio · HU-E9-01_ |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Cambiar de espacio · HU-E9-01

Reached from 17 tap(s).

| Tap | Goes to |
|---|---|
| Personal | Inicio · HU-E9-01 |
| Hogar | Inicio · HU-E9-01 |
| Crear un espacio compartido | Crear espacio compartido desde el selector · HU-E9-05 |
| Unirme con un enlace de invitación | Unirme con un enlace de invitación · HU-E9-05 |

### Perfil: ajustes y reglas generales · HU-E9-01

Reached from 12 tap(s).

| Tap | Goes to |
|---|---|
| Ajustes | Ajustes: formatos independientes del idioma · HU-E9-13 |
| Cuentas | Cuentas por tipo · HU-E9-03 |
| Categorías | Categorías: toca para editar · HU-E9-04 |
| Miembros e invitaciones | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |
| Reglas generales | Reglas generales para marca blanca · HU-E9-14 |
| Cerrar sesión | Iniciar sesión · HU-E9-01 |

### Adaptación a escritorio · HU-E9-01

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Registrar | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Inicio | _Adaptación a escritorio · HU-E9-01_ |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Personal | Cambiar de espacio · HU-E9-01 |
| Perfil de Ana | Perfil: ajustes y reglas generales · HU-E9-01 |
| Saldar | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |
| Ver todo | Movimientos por día y hora · HU-E9-03 |

## B1 registro

### Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03

Reached from 21 tap(s).

| Tap | Goes to |
|---|---|
| Gasto | _[tipo actual]_ |
| Ingreso | _[cambia a Ingreso]_ |
| Transferencia | _[cambia a Transferencia]_ |
| Mercado | _[elige categoría]_ |
| Editar Mercado y sus subcategorías | _[abre Editar categoría encima del registro]_ |
| Restaurantes | _[elige categoría]_ |
| Transporte | _[elige categoría]_ |
| Ver todas las categorías | Elegir categoría y subcategoría · HU-E9-03 |
| Verduras | _[quita subcategoría]_ |
| Carnes | _[elige subcategoría]_ |
| Frutas | _[elige subcategoría]_ |
| Aseo | _[elige subcategoría]_ |
| Agregar subcategoría a Mercado | _[abre Nueva subcategoría encima del registro_ |
| Cuenta: Bancolombia. Cambiar | Elegir cuenta · selector compartido |
| Fecha y hora: Hoy, 14:32. Cambiar | Registro rápido: fecha y hora abiertas · HU-E9-03 |
| Espacio: Personal. Cambiar | Cambiar de espacio · HU-E9-01 |
| 1 | _[escribe 1]_ |
| 2 | _[escribe 2]_ |
| 3 | _[escribe 3]_ |
| 4 | _[escribe 4]_ |
| 5 | _[escribe 5]_ |
| 6 | _[escribe 6]_ |
| 7 | _[escribe 7]_ |
| 8 | _[escribe 8]_ |
| 9 | _[escribe 9]_ |
| Tres ceros | _[escribe 000]_ |
| Cero | _[escribe 0]_ |
| Borrar | _[borra un dígito]_ |
| Guardar gasto | Inicio · HU-E9-01 |

### Registro rápido: fecha y hora abiertas · HU-E9-03

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver sin cambiar | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Hoy | _[día elegido]_ |
| Ayer | _[elige Ayer]_ |
| Anteayer | _[elige Anteayer]_ |
| Mes anterior | _[mes anterior]_ |
| Mes siguiente | _[mes siguiente]_ |
| 1 | _[elige el 1]_ |
| 2 | _[elige el 2]_ |
| 3 | _[elige el 3]_ |
| 4 | _[elige el 4]_ |
| 5 | _[elige el 5]_ |
| 6 | _[elige el 6]_ |
| 7 | _[elige el 7]_ |
| 8 | _[elige el 8]_ |
| 9 | _[elige el 9]_ |
| 10 | _[elige el 10]_ |
| 11 | _[elige el 11]_ |
| 12 | _[elige el 12]_ |
| 13 | _[elige el 13]_ |
| 14 | _[elige el 14]_ |
| 15 | _[elige el 15]_ |
| 16 | _[día elegido]_ |
| 17 | _[elige el 17]_ |
| 18 | _[elige el 18]_ |
| 19 | _[elige el 19]_ |
| 20 | _[elige el 20]_ |
| 21 | _[elige el 21]_ |
| 22 | _[elige el 22]_ |
| 23 | _[elige el 23]_ |
| 24 | _[elige el 24]_ |
| 25 | _[elige el 25]_ |
| 26 | _[elige el 26]_ |
| 27 | _[elige el 27]_ |
| 28 | _[elige el 28]_ |
| 29 | _[elige el 29]_ |
| 30 | _[elige el 30]_ |
| 31 | _[elige el 31]_ |
| Una hora menos | _[13:32]_ |
| Una hora más | _[15:32]_ |
| Cinco minutos menos | _[14:30]_ |
| Cinco minutos más | _[14:35]_ |
| :00 | _[fija minutos :00]_ |
| :15 | _[fija minutos :15]_ |
| :30 | _[fija minutos :30]_ |
| :45 | _[fija minutos :45]_ |
| Ahora | _[hora actual, activa]_ |
| Usar Hoy, 14:32 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |

### Elegir categoría y subcategoría · HU-E9-03

Reached from 2 tap(s).

| Tap | Goes to |
|---|---|
| Volver al registro | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Mercado | _[sin destino en el canvas]_ |
| Transporte público | _[sin destino en el canvas]_ |
| Farmacia | _[sin destino en el canvas]_ |
| Vivienda | _[muestra categorías de Vivienda]_ |
| Alimentación | _[grupo abierto]_ |
| Transporte | _[muestra categorías de Transporte]_ |
| Salud | _[muestra categorías de Salud]_ |
| Ocio | _[muestra categorías de Ocio]_ |
| Nueva | Crear la categoría encima del registro · HU-E9-12 |
| Mercado | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Restaurantes | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Sin subcategoría | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Verduras | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Carnes | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Frutas | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Aseo | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| + Nueva | Crear la categoría encima del registro · HU-E9-12 |

### Selector con «Crear como categoría» · HU-E9-12

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver al registro | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Gestionar | Categorías: toca para editar · HU-E9-04 |
| Crear «Pana» como categoría | Crear la categoría encima del registro · HU-E9-12 |
| Mercado | _[sin destino en el canvas]_ |
| Restaurantes | _[sin destino en el canvas]_ |

### Crear la categoría encima del registro · HU-E9-12

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Cancelar y volver | Selector con «Crear como categoría» · HU-E9-12 |
| En Alimentación | _[opción elegida]_ |
| Dentro de Mercado | _[elige Dentro de Mercado]_ |
| Otro grupo | _[elige Otro grupo]_ |
| Pan | _[ícono elegido]_ |
| Café | _[elige Café]_ |
| Carrito | _[elige Carrito]_ |
| Pan, emoji | _[elige Pan, emoji]_ |
| Croissant, emoji | _[elige Croissant, emoji]_ |
| Más íconos | _[sin destino en el canvas]_ |
| Arena | _[color elegido]_ |
| Mostaza | _[elige Mostaza]_ |
| Brasa | _[elige Brasa]_ |
| Pino | _[elige Pino]_ |
| Índigo | _[elige Índigo]_ |
| Más colores | _[sin destino en el canvas]_ |
| Crear y usar en el gasto | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |

### Movimientos por día y hora · HU-E9-03

Reached from 22 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar | Cambiar de espacio · HU-E9-01 |
| Octubre 2026 | _[sin destino en el canvas]_ |
| Categoría | _[filtra por categoría]_ |
| Cuenta | Elegir cuenta · selector compartido |
| Tipo | _[sin destino en el canvas]_ |
| Taxi a casa −$ 18.000 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Mercado −$ 100.000 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Cena −$ 60.000 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Transferencia a Nequi $ 500.000 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Mercado −$ 85.000 | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | _Movimientos por día y hora · HU-E9-03_ |
| Registrar movimiento | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Cuentas por tipo · HU-E9-03

Reached from 5 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Inicio | Inicio · HU-E9-01 |
| Nueva cuenta | Nueva cuenta: tipos y datos · nueva historia |
| Bancolombia | Movimientos por día y hora · HU-E9-03 |
| Nequi | Movimientos por día y hora · HU-E9-03 |
| Efectivo | Movimientos por día y hora · HU-E9-03 |
| Visa Bancolombia | Compra a cuotas · concepto futuro |
| CDT Davivienda | CDT y rendimiento · concepto futuro |
| Bolsillo Viaje | _Cuentas por tipo · HU-E9-03_ |
| Crédito libre inversión | _Cuentas por tipo · HU-E9-03_ |

### Nueva cuenta: tipos y datos · nueva historia

Reached from 2 tap(s).

| Tap | Goes to |
|---|---|
| Banco | _[cambia a Banco]_ |
| Billetera | _[cambia a Billetera]_ |
| Efectivo | _[cambia a Efectivo]_ |
| Tarjeta de crédito | _[tipo elegido]_ |
| Ahorro o CDT | _[cambia a Ahorro o CDT]_ |
| Inversión | _[cambia a Inversión]_ |
| Préstamo o deuda | _[cambia a Préstamo o deuda]_ |
| Otra | _[cambia a Otra]_ |
| Contar en el disponible | _[apaga el interruptor]_ |
| Crear cuenta | Cuentas por tipo · HU-E9-03 |

### Compra a cuotas · concepto futuro

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| 1 cuotas | _[cambia a 1 cuotas]_ |
| 3 cuotas | _[cambia a 3 cuotas]_ |
| 6 cuotas | _[opción elegida]_ |
| 12 cuotas | _[cambia a 12 cuotas]_ |
| 24 cuotas | _[cambia a 24 cuotas]_ |
| 36 cuotas | _[cambia a 36 cuotas]_ |
| Guardar a 6 cuotas | Cuentas por tipo · HU-E9-03 |

### CDT y rendimiento · concepto futuro

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver a Cuentas | Cuentas por tipo · HU-E9-03 |

## B1 categorías

### Categorías: toca para editar · HU-E9-04

Reached from 6 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |
| Nuevo grupo | Nuevo grupo de categorías · HU-E9-04 |
| Gastos | _[pestaña actual]_ |
| Ingresos | _[muestra Ingresos]_ |
| Agregar categoría a Vivienda | _[sin destino en el canvas]_ |
| Editar Arriendo | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Editar Servicios | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Editar Mantenimiento | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Agregar categoría a Alimentación | _[sin destino en el canvas]_ |
| Editar Mercado | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Editar Restaurantes | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Agregar categoría a Transporte | _[sin destino en el canvas]_ |
| Editar Combustible | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Editar Transporte público | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Agregar categoría a Salud | _[sin destino en el canvas]_ |
| Editar Médico | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |
| Editar Farmacia | Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04 |

### Editar categoría: ícono, color, grupo y subcategorías · HU-E9-04

Reached from 9 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar sin guardar | Categorías: toca para editar · HU-E9-04 |
| Grupo: Alimentación | _[abre lista de grupos]_ |
| Íconos | _[pestaña actual]_ |
| Emoji | _[muestra emoji]_ |
| Carrito | _[ícono elegido]_ |
| Cubiertos | _[elige Cubiertos]_ |
| Café | _[elige Café]_ |
| Casa | _[elige Casa]_ |
| Bombillo | _[elige Bombillo]_ |
| Bus | _[elige Bus]_ |
| Carro | _[elige Carro]_ |
| Corazón | _[elige Corazón]_ |
| Regalo | _[elige Regalo]_ |
| Boleto | _[elige Boleto]_ |
| Avión | _[elige Avión]_ |
| Libro | _[elige Libro]_ |
| Pino | _[elige Pino]_ |
| Salvia | _[elige Salvia]_ |
| Arena | _[color elegido]_ |
| Mostaza | _[elige Mostaza]_ |
| Brasa | _[elige Brasa]_ |
| Rosa | _[elige Rosa]_ |
| Ciruela | _[elige Ciruela]_ |
| Índigo | _[elige Índigo]_ |
| Acero | _[elige Acero]_ |
| Grafito | _[elige Grafito]_ |
| + Agregar | _[sin destino en el canvas]_ |
| Archivar | _[sin destino en el canvas]_ |
| Eliminar | _[sin destino en el canvas]_ |
| Guardar cambios | Categorías: toca para editar · HU-E9-04 |

## Nuevas

### Descartar gasto: confirmación al cerrar el registro

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | _[abre esta confirmación]_ |
| Seguir editando | Gasto en Hogar: división según el plan preseleccionada · HU-E9-06 |
| Descartar | Inicio · HU-E9-01 |

### Selector de rol del miembro · HU-E9-05

Reached from 6 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |
| Administrador | _[elige el rol]_ |
| Miembro | _[elige el rol]_ |
| Lector | _[elige el rol]_ |
| Guardar rol | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |

### Invitación revocada con deshacer · HU-E9-05

Reached from 2 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |
| Invitar | Invitar por enlace o correo · HU-E9-05 |
| Agregar invitado | Agregar invitado · HU-E9-05 |
| Rol de Juan: Administrador. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Rol de Luis: Miembro. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Rol de Sofi: Lector. Cambiar | Selector de rol del miembro · HU-E9-05 |
| Opciones de Pedro (invitado) | Invitado: enlace para reclamar y quitar con saldo · HU-E9-05 |
| Copiar enlace de invitación | _[copia al portapapeles]_ |
| Revocar (Enlace de invitación) | _[revoca la invitación]_ |
| Deshacer | _[restaura la invitación]_ |

### Quitar invitado sin saldo: confirmación · HU-E9-05

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Invitado: enlace para reclamar y quitar con saldo · HU-E9-05 |
| Cancelar | Invitado: enlace para reclamar y quitar con saldo · HU-E9-05 |
| Quitar de Hogar | Miembros de Hogar: los controles siguen el rol · HU-E9-05 |

### Aporte al fondo común · HU-E9-10

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Plan › Fondo: esperado y real · HU-E9-10 |
| Ana (tú) | _[elige quién aporta]_ |
| Juan | _[elige quién aporta]_ |
| Desde: Bancolombia. Cambiar | Elegir cuenta · selector compartido |
| Fecha: hoy. Cambiar | _[abre calendario]_ |
| Guardar aporte | Plan › Fondo: esperado y real · HU-E9-10 |

### Elegir categorías de una línea · HU-E9-08

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Editar línea: financiación, categorías y asignación · HU-E9-08 |
| Buscar categoría | _[filtra la lista]_ |
| Entretenimiento | _[marca o desmarca]_ |
| Salidas | _[marca o desmarca]_ |
| Restaurantes | _[marca o desmarca]_ |
| Taxi y apps | _[marca o desmarca]_ |
| Listo | Editar línea: financiación, categorías y asignación · HU-E9-08 |

### Mi plan personal › Líneas · HU-E9-11

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Espacio actual: Personal. Cambiar de espacio | Cambiar de espacio · HU-E9-01 |
| Período anterior: octubre 2026 | _[período anterior]_ |
| Período siguiente: diciembre 2026 | _[período siguiente]_ |
| Líneas | _Mi plan personal › Líneas · HU-E9-11_ |
| Por grupo | Mi consumo por grupo, filas unidas · HU-E9-11 |
| Tendencia | Mi tendencia de 6 períodos · HU-E9-11 |
| Inicio | Inicio · HU-E9-01 |
| Movimientos | Movimientos por día y hora · HU-E9-03 |
| Registrar movimiento | Registro rápido: hora, subcategoría y categorías sin salir · HU-E9-03 |
| Plan | _Mi plan personal › Líneas · HU-E9-11_ |
| Saldos | Saldos y sugerencias para quedar a paz y salvo · HU-E9-07 |

### Activar plan: confirmación · HU-E9-08

Reached from 3 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Ahora no | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Activar plan | Plan › Líneas: planeado, gastado y disponible · HU-E9-10 |

### Cerrar plan: confirmación · HU-E9-08

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Ahora no | Planeador: capacidad, líneas y ciclo del plan · HU-E9-08 |
| Cerrar plan | Planeador: plan cerrado, solo lectura · HU-E9-08 |

### Nuevo grupo de categorías · HU-E9-04

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver sin crear el grupo | Categorías: toca para editar · HU-E9-04 |
| Ícono Mascotas | _[elige el ícono]_ |
| Ícono Salud | _[elige el ícono]_ |
| Ícono Casa | _[elige el ícono]_ |
| Ícono Compras | _[elige el ícono]_ |
| Ícono Regalos | _[elige el ícono]_ |
| Ícono Transporte | _[elige el ícono]_ |
| Color Salvia | _[elige el color]_ |
| Color Arena | _[elige el color]_ |
| Color Acero | _[elige el color]_ |
| Color Ciruela | _[elige el color]_ |
| Color Cielo | _[elige el color]_ |
| Color Mostaza | _[elige el color]_ |
| Color Verde azulado | _[elige el color]_ |
| Color Terracota | _[elige el color]_ |
| Crear grupo | Categorías: toca para editar · HU-E9-04 |

### Unirme con un enlace de invitación · HU-E9-05

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Cambiar de espacio · HU-E9-01 |
| Ver invitación | Página pública de invitación · HU-E9-05 |

### Elegir cuenta · selector compartido

Reached from 7 tap(s).

| Tap | Goes to |
|---|---|
| Cerrar | ↩ back to the previous screen |
| Bancolombia | ↩ back to the previous screen |
| Nequi | ↩ back to the previous screen |
| Efectivo | ↩ back to the previous screen |
| Fondo Hogar | ↩ back to the previous screen |
| Nueva cuenta | Nueva cuenta: tipos y datos · nueva historia |

## B1 ajustes

### Ajustes: formatos independientes del idioma · HU-E9-13

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Volver | Perfil: ajustes y reglas generales · HU-E9-01 |
| 1.234,5 | _[opción actual]_ |
| 1,234.5 | _[selecciona 1,234.5]_ |
| 1 234,5 | _[selecciona 1 234,5]_ |
| 19:00 | _[opción actual]_ |
| 7:00 p. m. | _[selecciona 7:00 p. m.]_ |
| 16 / 10 / 2026 | _[opción actual]_ |
| 10 / 16 / 2026 | _[selecciona 10 / 16 / 2026]_ |
| 2026-10-16 | _[selecciona 2026-10-16]_ |
| Lunes | _[opción actual]_ |
| Domingo | _[selecciona Domingo]_ |
| Bogotá (GMT-5) | _[abre selector de zona horaria; sin destino _ |
| Peso colombiano (COP) | _[abre selector de moneda; sin destino en el _ |
| Sistema | _[opción actual]_ |
| Claro | _[selecciona Claro]_ |
| Oscuro | _[selecciona Oscuro]_ |
| Español | _[opción actual]_ |
| English | _[selecciona English]_ |

### Formatos es / en · HU-E9-02

Reached from 0 tap(s).

| Tap | Goes to |
|---|---|
| — | — |

### Reglas generales para marca blanca · HU-E9-14

Reached from 1 tap(s).

| Tap | Goes to |
|---|---|
| Subir PNG, JPG o WebP | _[abre selector de archivo; sin destino en el_ |
| Pino | _[color actual]_ |
| Brasa | _[elige el color Brasa]_ |
| Índigo | _[elige el color Índigo]_ |
| Ciruela | _[elige el color Ciruela]_ |
| Acero | _[elige el color Acero]_ |
| Grafito | _[elige el color Grafito]_ |
| Números | _[abre las opciones]_ |
| Números: las personas pueden cambiarlo | _[bloquea el valor]_ |
| Hora | _[abre las opciones]_ |
| Hora: las personas pueden cambiarlo | _[bloquea el valor]_ |
| Fecha | _[abre las opciones]_ |
| Fecha: las personas pueden cambiarlo | _[bloquea el valor]_ |
| La semana empieza | _[abre las opciones]_ |
| La semana empieza: las personas pueden cambiarlo | _[bloquea el valor]_ |
| Zona horaria | _[abre las opciones]_ |
| Zona horaria: las personas pueden cambiarlo | _[bloquea el valor]_ |
| Idioma de los textos | _[abre las opciones]_ |
| Idioma de los textos: las personas pueden cambia | _[bloquea el valor]_ |
| Moneda de los espacios nuevos | _[abre las opciones]_ |
| Moneda de los espacios nuevos: las personas pued | _[permite cambiarlo]_ |

