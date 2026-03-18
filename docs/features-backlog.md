# Features Backlog — Gaps vs. Excel "Gastos Casa"

Funcionalidades identificadas en el spreadsheet original que no están implementadas o están incompletas en el sistema. Ordenadas por prioridad.

---

## Estado

| # | Feature | Estado | Notas |
|---|---------|--------|-------|
| 1 | [Cuotas: filtrado por dueDate](#1-cuotas--filtrado-correcto-por-mes) | ✅ Completo | Fix en expenses, shared y groups/summary |
| 2 | [Resumen mensual "Ideal vs Real"](#2-resumen-mensual-ideal-vs-real) | ✅ Completo | Columnas Ideal, Diferencia, Disponible + tfoot totales |
| 3 | [Tarjeta: responsable de pago ≠ dueño](#3-tarjeta-responsable-de-pago--dueño) | ⬜ Pendiente | |
| 4 | [Total por tarjeta con vencimiento mensual](#4-total-por-tarjeta-con-vencimiento-mensual) | ⬜ Pendiente | |
| 5 | [Separación débito vs crédito en resumen](#5-separación-débito-vs-crédito) | ⬜ Pendiente | |
| 6 | [Proyección crédito mes siguiente](#6-proyección-crédito-mes-siguiente) | ⬜ Pendiente | |
| 7 | [Selector de mes histórico en resumen](#7-selector-de-mes-histórico) | ⬜ Pendiente | |
| 8 | [UI unificada: Compartidos + Grupos](#8-ui-unificada-compartidos--grupos) | ⬜ Pendiente | **Requiere planificación previa antes de ejecutar** |
| 9 | [Invariante: gasto compartido requiere grupo](#9-invariante-gasto-compartido-requiere-grupo) | ⬜ Pendiente | Validación en API + UI + recurring |
| 10 | [Configuración automática de % por ingresos en grupos](#10-configuración-automática-de--por-ingresos-en-grupos) | ✅ Completo | Botón "Sync %" en grupos + endpoint POST sync-percentages |

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

### 8. UI unificada — Compartidos + Grupos

> ⚠️ **Esta feature debe planificarse en modo plan antes de ejecutarse.**

**Objetivo:** Centralizar las vistas `/dashboard/shared` y `/dashboard/groups/[id]` en una única interfaz con métricas completas, facilitando el acceso y la visibilidad de los datos sin tener que navegar entre múltiples páginas.

**Motivación:**
- Actualmente la información está fragmentada: los gastos compartidos están en "Compartidos" y el resumen Ideal/Real está en el detalle del grupo — el usuario tiene que moverse entre dos páginas para tener el panorama completo del mes.
- El Excel mostraba todo en una sola hoja: transacciones, resumen por persona, balance y métricas de ingreso.

**Alcance tentativo:**
- Una sola página (probablemente en `/dashboard/groups/[id]` o nueva ruta `/dashboard/home`) que combine:
  - Resumen mensual por miembro (Ideal vs Real) — ya implementado en grupos
  - Lista de transacciones compartidas del mes (actualmente en "Compartidos")
  - Balance de deudas acumulado
  - Métricas de totales: total gastado, total compartido, saldo disponible por persona
- Selector de mes/año unificado que filtre todas las secciones a la vez
- Posible: tabs o secciones colapsables para no sobrecargar visualmente

**Dependencias:**
- Feature #7 (selector mes histórico) debería implementarse primero o junto con este
- Considerar si el contexto de "grupo" sigue siendo necesario o si se puede asumir un grupo principal por usuario

**Requiere planificación de:**
- Arquitectura de rutas (¿nueva ruta? ¿reemplazar una existente?)
- Diseño de la UI (invocar skills `interface-design` y `ui-ux-pro-max`)
- Estrategia de fetching (¿un endpoint unificado o composición de los existentes?)
- Impacto en navegación lateral (sidebar)

---

### 9. Invariante: gasto compartido requiere grupo

**Problema actual:** `isShared` y `groupId` son campos independientes en el schema y en la API. Es posible crear un gasto con `isShared: true` y sin `groupId`, dejando datos huérfanos que nunca aparecerán en ningún resumen de grupo.

**Estado del código analizado:**

| Capa | Estado |
|------|--------|
| Schema (`prisma/schema.prisma`) | `groupId String? @db.ObjectId` — opcional, sin constraint |
| API `POST /api/expenses` | No valida que `isShared` requiera `groupId` |
| API `POST /api/recurring-expenses` | Mismo problema |
| UI `expenses/page.tsx` | El checkbox `isShared` puede marcarse sin grupo seleccionado |

**Cambios necesarios:**

1. **API `src/app/api/expenses/route.ts`** — agregar validación en POST:
   ```typescript
   if (isShared && !groupId) {
     return NextResponse.json({ error: "Un gasto compartido debe pertenecer a un grupo" }, { status: 400 });
   }
   ```

2. **API `src/app/api/recurring-expenses/route.ts`** — misma validación.

3. **UI `expenses/page.tsx`** — derivar `isShared` del `groupId` en lugar de un checkbox independiente:
   - Cuando se selecciona un grupo → `isShared` se activa automáticamente (ya ocurre parcialmente)
   - Cuando no hay grupo → `isShared` no puede ser `true`
   - El checkbox puede quedar como atajo visual pero deshabilitado si `groupId` está vacío

4. **Considerar** si `isShared` como campo es necesario o si se puede derivar siempre de `groupId !== null`. Si `groupId` implica compartido, el campo es redundante y puede eliminarse a futuro.

---

### 10. Configuración automática de % por ingresos en grupos

**Problema actual:** Los porcentajes de los miembros del grupo (`GroupMember.percentage`) se configuran manualmente. El resumen ya calcula `idealPercentage` en base a `MonthlyIncome`, pero los splits de cada gasto usan el `%` configurado manualmente, que puede no coincidir con la proporción real de ingresos.

**Comportamiento deseado:** Que el sistema pueda derivar automáticamente los porcentajes de split a partir de los ingresos registrados (`MonthlyIncome`) del mes en curso, sin requerir configuración manual.

**Opciones:**

1. **Botón "Sincronizar % con ingresos"** en la página de grupos — recalcula y guarda los `GroupMember.percentage` en base al ingreso registrado del mes actual.
2. **Modo automático** (`splitMode: "auto" | "manual"` en `Group`) — cuando está en `auto`, el backend ignora `GroupMember.percentage` y usa `MonthlyIncome` para calcular los shares en el momento de crear/editar un gasto.

**Archivos a modificar (opción 2):**
- `prisma/schema.prisma` — agregar `splitMode` a `Group`
- `src/app/api/groups/[id]/route.ts` — exponer y actualizar `splitMode`
- `src/app/api/expenses/route.ts` — usar ingresos para calcular shares si `splitMode === "auto"`
- `src/app/api/recurring-expenses/route.ts` — ídem
- `src/app/(dashboard)/dashboard/groups/page.tsx` — UI para seleccionar modo

---

## Leyenda

- ✅ Completo
- 🔄 En progreso
- ⬜ Pendiente
- 🚫 Descartado
