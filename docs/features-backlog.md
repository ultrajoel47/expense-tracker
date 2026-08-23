# Features Backlog — Gaps vs. Excel "Gastos Casa"

Funcionalidades identificadas en el spreadsheet original que no están
implementadas o están incompletas en el sistema. Ordenadas por prioridad.

> **Purgado el 2026-08-22.** Este backlog se escribió cuando la app era un
> tracker multiusuario con grupos, splits proporcionales al sueldo y balance de
> deudas entre pares. Ese dominio se eliminó. Los ítems que dependían de él
> están listados como descartados al final, y no se van a implementar.
>
> El trabajo del bot de Telegram, la IA, el OCR, los aliases y las consultas
> **no** vive acá: está en
> [superpowers/specs/2026-08-22-gastos-bot-telegram-design.md](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md),
> cortado en rebanadas en su sección 16.

---

## Estado

| # | Feature | Estado | Notas |
|---|---------|--------|-------|
| 1 | [Cuotas: filtrado por dueDate](#1-cuotas--filtrado-correcto-por-mes) | ✅ Completo | Semántica de flujo en las dos rutas de lectura |
| 3 | [Tarjeta: responsable de pago ≠ dueño](#3-tarjeta-responsable-de-pago--dueño) | ⬜ Pendiente | |
| 4 | [Total por tarjeta con vencimiento mensual](#4-total-por-tarjeta-con-vencimiento-mensual) | ⬜ Pendiente | |
| 5 | [Separación débito vs crédito en resumen](#5-separación-débito-vs-crédito) | ⬜ Pendiente | |
| 6 | [Proyección crédito mes siguiente](#6-proyección-crédito-mes-siguiente) | ⬜ Pendiente | |
| 7 | [Selector de mes histórico](#7-selector-de-mes-histórico) | ⬜ Pendiente | |
| 12 | [Desaprender un alias](#12-desaprender-un-alias) | ⬜ Pendiente | |
| 13 | [Backfill de consulta con el monto actual de la plantilla](#13-backfill-de-consulta-con-el-monto-actual-de-la-plantilla) | ⬜ Pendiente | Hoy inocuo: la ventana materializable es de un mes solo |
| 14 | [Materialización secuencial de una consulta](#14-materializacion-secuencial-de-una-consulta) | ⬜ Pendiente | Hoy inocuo: hasta 240 idas a la base en el peor caso teórico |

La numeración se conserva con huecos a propósito, para que las referencias
viejas a "el ítem 9" no apunten a otra cosa.

---

## Detalle

### 1. Cuotas — Filtrado correcto por mes

**Problema original:** al filtrar gastos por mes, se usaba `expense.date`
(fecha de la compra). Un gasto en 12 cuotas aparecía entero en el mes de
compra y en ningún otro.

**Lo que pasó después:** la Rebanada 1 arregló esto solo en el listado
(`expenses/route.ts`), que pasó a usar `installment.dueDate`. Los gráficos
(`expenses/stats/route.ts`) siguieron usando `expense.date`, así que el mismo
mes daba dos totales distintos según la ruta — es el bug que el usuario
encontró. El ítem se había marcado "✅ Completo" cuando en realidad solo una
de las dos rutas de lectura tenía el comportamiento correcto.

**Resuelto en la Rebanada 3 (Enmienda 1 del spec):** las dos rutas ahora
comparten la misma semántica de FLUJO — lo que se muestra en un mes es lo que
efectivamente se paga ese mes, no lo que se compró:

- Un gasto sin cuotas cuenta por su monto, en el mes de su `date`.
- Un gasto en cuotas cuenta por el monto de cada cuota, en el mes del
  `dueDate` de esa cuota — nunca por el monto total, y nunca en el mes de la
  compra.

**La regla está implementada dos veces, no una, y nada las mantiene
sincronizadas:** `expensesToCharges` (`src/lib/expenses/charges.ts`) para los
gráficos, y por separado en `src/app/api/expenses/route.ts` para el listado
— un `where` de Prisma que filtra en la base (líneas 46-52) más un filtro en
JS aparte para la cuota vigente de cada fila de la respuesta (líneas 84-89).
Coinciden hoy (verificado a mano: 71 cargos de marzo 2026 por los dos
caminos), pero es una coincidencia sin garantía automática — cambiar una
implementación sin la otra las vuelve a divergir, que es precisamente este
bug de nuevo. Detalle completo en
[la Enmienda 1](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md#enmienda-1--semántica-de-cuotas-decidida-2026-08-23-rebanada-3);
ver también la nota en [architecture.md](architecture.md#reglas-transversales).

---

### 3. Tarjeta: Responsable de pago ≠ dueño

**Descripción:** En el Excel una tarjeta tiene `Propietario` (quien compra) y
`Responsable de pago` (quien paga la factura). Pueden ser personas distintas.

Ejemplo: "BBVA Pablo" → propietario: Pablo, responsable: Virginia.

**Impacto:** hoy el pagador de un gasto es quien lo registra. Con este feature,
`Expense.userId` (quién pagó) se derivaría automáticamente de la tarjeta, lo cual
también le ahorra una inferencia a la IA del bot.

**Archivos a modificar:**
- `prisma/schema.prisma` — agregar `payerUserId` a `CreditCard`
- `src/app/api/credit-cards/` — CRUD
- `src/app/api/expenses/route.ts` — inferir pagador desde tarjeta

---

### 4. Total por tarjeta con vencimiento mensual

**Descripción:** Dashboard que muestre, por cada tarjeta de crédito, el monto
total a pagar ese mes y su fecha de vencimiento.

**Datos disponibles:** modelo `CreditCard` y `Installment.dueDate`. Falta agregarle
a `CreditCard` la fecha de cierre y de vencimiento.

**Archivos nuevos:**
- `src/app/api/credit-cards/summary/route.ts` — endpoint de resumen mensual por tarjeta

---

### 5. Separación débito vs crédito

**Descripción:** En el resumen mensual, separar los montos pagados con débito (ya
salió del banco) vs crédito (se cobra el mes siguiente).

**Requiere:** un campo `type` en `CreditCard`.

---

### 6. Proyección crédito mes siguiente

**Descripción:** Mostrar cuánto se va a cobrar el próximo mes en tarjetas de
crédito (compras actuales con debitación diferida, incluyendo cuotas futuras).

Los datos ya están: `Installment.dueDate` del mes siguiente.

---

### 7. Selector de mes histórico

**Descripción:** Poder seleccionar cualquier mes pasado en el dashboard y en la
vista de la casa, y ver los totales de ese período. La página de gastos ya tiene
navegación por mes — aplicar el mismo patrón al resto.

Se cruza con la tendencia de 12 meses de la Rebanada 3.

---

### 12. Desaprender un alias

**Descripción:** `src/lib/aliases.ts` graba un alias solo cuando una corrección
cambia la categoría o el ámbito, y lo actualiza (pisándolo) cuando la misma
descripción se vuelve a corregir. Pero si un alias se aprendió mal y esa
descripción no vuelve a aparecer, no hay forma de sacarlo: sigue instalado y
sigue entrando al prompt. Hoy no hay ninguna pantalla ni comando para borrar un
alias existente.

**No se resuelve con código en el Bloque 3B** a propósito: una pantalla de
administración de aliases es alcance nuevo (CRUD + UI), y enseñarle al bot a
"olvidar" por un mensaje de texto ("olvidate de X") es otra rebanada — abre las
mismas preguntas de diseño que aprender (¿qué patrón exacto se borra? ¿lo puede
pedir cualquiera de los dos o solo quien lo cargó?) sin que el bloque de
consultas las necesite resolver.

**Datos para quien lo tome, para no arrancar de cero:**

- El patrón sale de la `description` del gasto (normalizada con
  `normalizePattern`), no del texto del mensaje que corrige.
- La clave del alias es `pattern` normalizado (`Alias.pattern`, único): borrar
  o editar es un `delete`/`update` por esa clave.
- `hits` existe justamente para poder ver cuáles alias no se usan nunca (un
  alias con `hits: 0` después de mucho tiempo es candidato a revisar a mano) —
  ver el comentario de `recordAliasHit` en `src/lib/aliases.ts`.
- `TOPE_PARA_EL_PROMPT`, ordenado por `hits` descendente, ya limita el daño de
  un alias mal aprendido que nadie usa: con el tiempo queda empujado fuera del
  prompt por los que sí se usan. No es una solución (sigue en la base y puede
  volver a entrar si empieza a "acertar" por casualidad), pero acota el impacto
  mientras no existe una forma de borrarlo.

**La opción rica que se descartó para la restricción de privacidad de los
aliases (Bloque 3B, ola de arreglos B):** hoy `learnAlias` no aprende de un
gasto `personal` porque `Alias` no tiene `userId` — un alias es global a los
dos miembros del hogar, así que aprender de un gasto personal filtraría su
descripción al contexto (y al proveedor de IA externo) de la otra persona,
indefinidamente. Agregar un `userId` a `Alias` permitiría que cada persona
tuviera sus propios aliases, y con eso volver a aprender de sus gastos
personales sin cruzar la privacidad. **No entró** porque requiere migrar el
schema (`prisma/schema.prisma`, con datos reales en la tabla) y no hacía falta
para cerrar el hallazgo de privacidad: no aprender de personales alcanza y es
mucho más simple.

---

### 13. Backfill de consulta con el monto actual de la plantilla

**Descripción:** una consulta puede hacer *backfill* hasta 24 meses atrás en un
solo mensaje (`CONSULTA_MESES_MAXIMOS`, `src/lib/ai/parse.ts`), y
`resolveConsulta` (`src/lib/queries/aggregate.ts`) materializa cada mes del
rango antes de leer. La materialización usa el monto que la plantilla
recurrente tiene **hoy**, no el que tenía en el mes que se está creando (ver
`materializeRecurringForMonth`, `src/lib/recurring-materialize.ts`).

**Por qué hoy es inocuo:** `esPeriodoMaterializable` acota la ventana
materializable a `[PRIMER_PERIODO_MATERIALIZABLE, el mes actual]`, y ese piso
coincide con el mes actual (2026-08) al momento de escribir esto. La ventana
real es de UN mes solo, así que no hay ningún mes "viejo" que backfillear con
un monto equivocado todavía.

**Por qué deja de serlo:** a partir de septiembre de 2026 el piso queda un mes
atrás del actual, y crece cada mes que pasa. Una pregunta como "cómo venimos
este año" puede entonces materializar el alquiler de un mes viejo (dentro de
la ventana pero anterior al mes en curso) usando el monto de HOY, no el que la
plantilla tenía en ese momento — si el alquiler se indexó en el medio, ese mes
queda con un monto que nunca se cobró.

---

### 14. Materialización secuencial de una consulta

**Descripción:** el loop de materialización de `resolveConsulta` es
secuencial: mes por mes, y dentro de cada mes, plantilla por plantilla (ver
`materializeRecurringForMonth`). Con el backfill de hasta 24 meses (ítem 13
de arriba) y unas 10 plantillas activas, una sola consulta puede disparar
hasta 240 idas a la base en serie antes de poder contestar.

**El arreglo natural:** paralelizar por MES. Los meses son independientes
entre sí — la idempotencia de la materialización es por
`(recurringExpenseId, recurringPeriod)`, así que dos meses distintos nunca
compiten por la misma fila — y no hace falta tocar la materialización POR
plantilla dentro de cada mes, que puede seguir siendo secuencial.

---

## Descartados

Dependían de grupos, splits, sueldos o balance de deudas, que ya no existen.

| # | Feature | Por qué se descarta |
|---|---------|---------------------|
| 2 | Resumen mensual "Ideal vs Real" | Calculaba el ideal a pagar de cada uno proporcional a su `MonthlyIncome`. No hay registro de sueldos ni reparto: comparten la plata. |
| 8 | UI unificada Compartidos + Grupos | Las dos páginas se borraron. La vista de la casa de la Rebanada 3 la reemplaza, sin noción de grupo. |
| 9 | Invariante: gasto compartido requiere grupo | `isShared` y `groupId` no existen. `scope` los reemplaza y siempre tiene valor. |
| 10 | Configuración automática de % por ingresos | No hay porcentajes que configurar. |
| 11 | Cards métricas: balance neto unificado | No hay balance. |

---

## Leyenda

- ✅ Completo
- 🔄 En progreso
- ⬜ Pendiente
- 🚫 Descartado
