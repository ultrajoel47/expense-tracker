# Features Backlog — Gaps vs. Excel "Gastos Casa"

Funcionalidades identificadas en el spreadsheet original que no están implementadas o están incompletas en el sistema. Ordenadas por prioridad.

---

## Estado

| # | Feature | Estado | Notas |
|---|---------|--------|-------|
| 1 | [Cuotas: filtrado por dueDate](#1-cuotas--filtrado-correcto-por-mes) | ✅ Completo | Fix en expenses, shared y groups/summary |
| 2 | [Resumen mensual "Ideal vs Real"](#2-resumen-mensual-ideal-vs-real) | ⬜ Pendiente | |
| 3 | [Tarjeta: responsable de pago ≠ dueño](#3-tarjeta-responsable-de-pago--dueño) | ⬜ Pendiente | |
| 4 | [Total por tarjeta con vencimiento mensual](#4-total-por-tarjeta-con-vencimiento-mensual) | ⬜ Pendiente | |
| 5 | [Separación débito vs crédito en resumen](#5-separación-débito-vs-crédito) | ⬜ Pendiente | |
| 6 | [Proyección crédito mes siguiente](#6-proyección-crédito-mes-siguiente) | ⬜ Pendiente | |
| 7 | [Selector de mes histórico en resumen](#7-selector-de-mes-histórico) | ⬜ Pendiente | |

---

## Detalle

### 1. Cuotas — Filtrado correcto por mes

**Problema:** Al filtrar gastos por mes, se usa `expense.date` (fecha de la compra). Un gasto en 12 cuotas aparece entero en el mes de compra y en ningún otro.

**Comportamiento correcto:** Usar `installment.dueDate`. Cada mes solo debe aparecer la cuota que vence ese mes, con su monto parcial (`installmentAmount`).

**Archivos a modificar:**
- `src/app/api/expenses/route.ts`
- `src/app/api/shared/route.ts`
- `src/app/api/groups/[id]/summary/route.ts`

---

### 2. Resumen mensual "Ideal vs Real"

**Descripción:** Vista central del Excel. Por cada integrante del grupo, mostrar:
- **Ingresos** del mes
- **Porcentaje** proporcional al total de ingresos del grupo
- **Ideal a pagar** = gasto_total_mes × porcentaje
- **Monto realmente abonado** (suma de sus tarjetas/gastos ese mes)
- **Diferencia** (real − ideal)
- **Ingresos restantes** (ingresos − monto abonado)

**Datos disponibles:** `MonthlyIncome` ya existe en el sistema. El summary API ya calcula `totalPaid` por miembro.

**Archivos nuevos/modificados:**
- `src/app/api/groups/[id]/summary/route.ts` — agregar campos ideal/diferencia
- `src/app/(dashboard)/dashboard/groups/[id]/page.tsx` — nueva sección de resumen

---

### 3. Tarjeta: Responsable de pago ≠ dueño

**Descripción:** En el Excel una tarjeta tiene `Propietario` (quien compra) y `Responsable de pago` (quien paga la factura). Pueden ser personas distintas.

Ejemplo: "BBVA Pablo" → propietario: Pablo, responsable: Virginia.

**Impacto:** Actualmente hay que asignar manualmente el pagador en cada gasto. Con este feature, el pagador se derivaría automáticamente de la tarjeta.

**Archivos a modificar:**
- `prisma/schema.prisma` — agregar `payerUserId` a `CreditCard`
- `src/app/api/credit-cards/` — CRUD
- `src/app/api/expenses/route.ts` — inferir pagador desde tarjeta

---

### 4. Total por tarjeta con vencimiento mensual

**Descripción:** Dashboard que muestre, por cada tarjeta de crédito, el monto total a pagar ese mes y su fecha de vencimiento.

**Datos disponibles:** Modelo `CreditCard` con `closingDate`/`dueDate`. Expenses vinculadas a tarjetas.

**Archivos nuevos:**
- `src/app/api/credit-cards/summary/route.ts` — endpoint de resumen mensual por tarjeta

---

### 5. Separación débito vs crédito

**Descripción:** En el resumen mensual, separar los montos pagados con débito (ya salió del banco) vs crédito (se cobra el mes siguiente).

**Datos disponibles:** `CreditCard.type` o inferible del nombre.

---

### 6. Proyección crédito mes siguiente

**Descripción:** Mostrar cuánto se va a cobrar el próximo mes en tarjetas de crédito (compras actuales con debitación diferida, incluyendo cuotas futuras).

---

### 7. Selector de mes histórico

**Descripción:** En el resumen del grupo/compartidos, poder seleccionar cualquier mes pasado y ver la distribución para ese período. El sistema ya tiene navegación por mes en la página de gastos — aplicar el mismo patrón al resumen del grupo.

---

## Leyenda

- ✅ Completo
- 🔄 En progreso
- ⬜ Pendiente
- 🚫 Descartado
