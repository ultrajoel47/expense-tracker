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
