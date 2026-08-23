# Rebanada 3 — Recurrentes y gráficos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el total del gráfico y el del listado coincidan, que los 10 recurrentes del usuario entren en los números, y que la app deje de ofrecer un registro que no puede funcionar.

**Architecture:** La semántica de flujo se expresa como una transformación pura de **gastos a cargos**: un gasto sin cuotas produce un cargo por su monto en su fecha; uno en cuotas produce un cargo por cuota, por el monto de la cuota, en la fecha de vencimiento. Todas las agregaciones de `stats` pasan a trabajar sobre cargos, así que la aritmética queda en un módulo puro con tests y fuera de la route. Los recurrentes se materializan como filas de `Expense` de forma perezosa e idempotente, así que aparecen en los mismos cargos sin ninguna rama especial.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 6 + MongoDB, Tailwind 4, Recharts, `node --test` (Node ≥22.18, type-stripping nativo).

**Spec:** `docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md`, y en particular su **Enmienda 1** al final, que fija la semántica de flujo con los números reales del usuario.

## Global Constraints

- **Verificación de cierre de cada tarea: `npm run verify` (una sola llamada).** Corre `node --test` más `tsc --noEmit` en ~2,8 s. **No correr `npm run build`** salvo en la última tarea: medido, 45.765 ms, el 92 % del ciclo.
- **No re-verificar lo que el brief declara ya verificado.** Cada dispatch trae un bloque de lo ya comprobado y por quién.
- Errores de API en español, formato `{ error: "mensaje" }`. Sesión validada al inicio de toda route.
- Prisma singleton (`@/lib/prisma`). MongoDB: nunca `prisma migrate`, siempre `npx prisma db push`.
- **Módulos puros** (`src/lib/visibility.ts`, `src/lib/ai/*`, `src/lib/telegram/intake.ts`, y los que crea este plan en `src/lib/expenses/`): sin alias `@/`, sin `next/*`, sin `@prisma/client`. Se importan entre sí con extensión `.ts` explícita.
- **Lectura vs edición son reglas distintas.** `visibleExpensesWhere(userId, householdUserIds)` para leer; `canEditViaBot` para el bot. No unificar.
- **En MongoDB, nunca escribir `null` en un campo `@unique`** — usar `{ unset: true }`. Un índice sparse ignora el campo ausente pero indexa el `null` explícito, así que dos `null` colisionan. Cuarta aparición documentada en `docs/data-models.md`.
- Commits en español con prefijo convencional.
- `npm test` está en **80 pasando** al empezar. Si una tarea rompe uno preexistente, parar y reportar.

## Datos reales contra los que se trabaja

No son fixtures. La base de producción tiene: **388 gastos** (386 migrados + 2 cargados por el bot), **66 filas de cuota** sobre **9 gastos en cuotas**, **10 plantillas de recurrentes**, 6 tarjetas, 2 usuarios, 8 categorías.

Los 9 gastos en cuotas, que son los que la Enmienda 1 afecta:

| fecha | monto | cuotas | descripción |
|---|---|---|---|
| 2025-03 | $118.400 | 6 | balbi |
| 2025-06 | $208.491 | 3 | carne |
| 2025-06 | $64.320 | 3 | fernet |
| 2025-06 | $25.400 | 3 | cremitas skincare |
| 2025-07 | $309.999 | 6 | televisor |
| 2025-09 | $250.000 | 12 | aspiradora |
| 2025-10 | $160.000 | 3 | arbol navidad |
| 2026-02 | $89.700 | 3 | soporte tv living |
| 2026-03 | $176.202 | 6 | cubrecama y sabanas DUVE |

Marzo 2026 es el mes de control: con la semántica vieja da **$2.397.806**, con la de flujo **$2.301.704**.

---

## Task 1: La aritmética del dinero, en un módulo puro

Extrae las dos operaciones que hoy viven inline en routes y no tienen un solo test, aunque son las que pueden hacer desaparecer un gasto o cambiar un total.

**Files:**
- Create: `src/lib/expenses/installments.ts`
- Create: `src/lib/expenses/charges.ts`
- Create: `tests/installments.test.ts`
- Create: `tests/charges.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export type InstallmentRow = { installmentNumber: number; dueDate: Date; amount: number }`
  - `export function buildInstallments(purchaseDate: Date, total: number, count: number): InstallmentRow[]`
  - `export type Charge = { date: Date; amount: number; categoryId: string; categoryName: string; categoryColor: string; expenseId: string }`
  - `export function expensesToCharges(expenses: ChargeableExpense[], from: Date, to: Date): Charge[]`
  - `export type ChargeableExpense` (la forma mínima que consume `expensesToCharges`)

- [ ] **Step 1: Escribir los tests de `buildInstallments`**

Crear `tests/installments.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstallments } from "../src/lib/expenses/installments.ts";

test("genera una fila por cuota, numeradas desde 1", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.installmentNumber), [1, 2, 3]);
});

test("las cuotas caen en meses consecutivos", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.deepEqual(
    rows.map((r) => r.dueDate.toISOString().slice(0, 7)),
    ["2026-03", "2026-04", "2026-05"]
  );
});

test("no saltea meses cuando la compra cae el 31", () => {
  // El 31 de enero + 1 mes con setMonth da "31 de febrero", que JS normaliza
  // a marzo: febrero quedaria sin cuota y marzo con dos.
  const rows = buildInstallments(new Date("2026-01-31T12:00:00Z"), 300, 3);
  assert.deepEqual(
    rows.map((r) => r.dueDate.toISOString().slice(0, 7)),
    ["2026-01", "2026-02", "2026-03"]
  );
});

test("las cuotas suman exactamente el total", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 100, 3);
  const suma = rows.reduce((s, r) => s + r.amount, 0);
  assert.equal(Math.round(suma * 100) / 100, 100);
});

test("el resto va en la ultima cuota, no se pierde", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 100, 3);
  assert.equal(rows[0].amount, 33.33);
  assert.equal(rows[1].amount, 33.33);
  assert.equal(rows[2].amount, 33.34);
});

test("un total divisible reparte parejo", () => {
  const rows = buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 3);
  assert.deepEqual(rows.map((r) => r.amount), [100, 100, 100]);
});

test("count menor o igual a 1 devuelve vacio", () => {
  assert.deepEqual(buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 1), []);
  assert.deepEqual(buildInstallments(new Date("2026-03-15T12:00:00Z"), 300, 0), []);
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run verify`
Expected: FAIL — `Cannot find module '../src/lib/expenses/installments.ts'`

- [ ] **Step 3: Implementar `installments.ts`**

Crear `src/lib/expenses/installments.ts`. Sin imports.

```ts
export type InstallmentRow = {
  installmentNumber: number;
  dueDate: Date;
  amount: number;
};

/**
 * Las filas de `Installment` de un gasto en cuotas.
 *
 * Existia inline y duplicada en el POST de la web y en el webhook del bot, sin
 * un solo test — y es la aritmetica que puede hacer DESAPARECER un gasto: el
 * `GET /api/expenses` selecciona los gastos en cuotas por
 * `installments: { some: { dueDate } }`, asi que un gasto con
 * `totalInstallments: 3` y sin filas no aparece en ningun mes.
 *
 * Dos cosas que la version inline hacia mal:
 *
 *  - Usaba `due.setMonth(due.getMonth() + i)` sobre un `Date`. Para una compra
 *    el 31, "31 de febrero" se normaliza hacia marzo, asi que febrero quedaba
 *    sin cuota y marzo con dos. Aca se construye la fecha desde el año y el mes
 *    en UTC, fijando el dia 1, que no puede desbordar.
 *  - Dividia `total / count` sin redondear, asi que las cuotas no sumaban el
 *    total. Aca se redondea a centavos y el resto va en la ultima.
 */
export function buildInstallments(
  purchaseDate: Date,
  total: number,
  count: number
): InstallmentRow[] {
  if (!Number.isInteger(count) || count <= 1) return [];

  const y = purchaseDate.getUTCFullYear();
  const m = purchaseDate.getUTCMonth();

  const base = Math.round((total / count) * 100) / 100;
  const rows: InstallmentRow[] = [];

  for (let i = 0; i < count; i++) {
    const esUltima = i === count - 1;
    const amount = esUltima
      ? Math.round((total - base * (count - 1)) * 100) / 100
      : base;

    rows.push({
      installmentNumber: i + 1,
      // Dia 1 a mediodia UTC: no puede desbordar de mes ni cambiar de dia por
      // zona horaria. El dia exacto del vencimiento no se usa en ningun
      // filtro; todos los filtros son por mes.
      dueDate: new Date(Date.UTC(y, m + i, 1, 12, 0, 0)),
      amount,
    });
  }

  return rows;
}
```

**Nota sobre una consecuencia deliberada:** el `dueDate` de las cuotas nuevas
queda siempre en el día 1, mientras las 66 filas que ya existen conservan el día
de la compra original. No hace falta migrarlas: todos los filtros del sistema son
por rango de mes, así que las dos convenciones caen en el mismo mes. Se menciona
para que quien lea la base no lo tome por un bug.

- [ ] **Step 4: Escribir los tests de `expensesToCharges`**

Crear `tests/charges.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { expensesToCharges } from "../src/lib/expenses/charges.ts";

const CAT = { id: "cat-1", name: "Alimentacion", color: "#16a34a" };
const MARZO = { from: new Date(Date.UTC(2026, 2, 1)), to: new Date(Date.UTC(2026, 3, 1)) };

function gasto(over = {}) {
  return {
    id: "e1",
    amount: 1000,
    date: new Date(Date.UTC(2026, 2, 10, 12)),
    totalInstallments: null as number | null,
    category: CAT,
    installments: [] as { dueDate: Date; amount: number }[],
    ...over,
  };
}

test("un gasto sin cuotas produce un cargo por su monto", () => {
  const c = expensesToCharges([gasto()], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 1000);
  assert.equal(c[0].categoryName, "Alimentacion");
});

test("un gasto sin cuotas fuera del rango no produce cargo", () => {
  const c = expensesToCharges([gasto({ date: new Date(Date.UTC(2026, 1, 10, 12)) })], MARZO.from, MARZO.to);
  assert.equal(c.length, 0);
});

test("un gasto en cuotas produce el monto de la CUOTA, no el total", () => {
  const e = gasto({
    amount: 300000,
    date: new Date(Date.UTC(2025, 6, 10, 12)),
    totalInstallments: 6,
    installments: [
      { dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 50000 },
      { dueDate: new Date(Date.UTC(2026, 3, 1, 12)), amount: 50000 },
    ],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 50000, "tiene que ser la cuota, no los 300000");
});

test("la fecha del cargo de una cuota es su vencimiento, no la compra", () => {
  const e = gasto({
    date: new Date(Date.UTC(2025, 6, 10, 12)),
    totalInstallments: 2,
    installments: [{ dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 500 }],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c[0].date.toISOString().slice(0, 7), "2026-03");
});

test("un gasto en cuotas sin filas de cuota no produce nada, y no explota", () => {
  const e = gasto({ totalInstallments: 6, installments: [] });
  assert.deepEqual(expensesToCharges([e], MARZO.from, MARZO.to), []);
});

test("varias cuotas del mismo gasto en el rango producen varios cargos", () => {
  const e = gasto({
    totalInstallments: 12,
    installments: [
      { dueDate: new Date(Date.UTC(2026, 2, 1, 12)), amount: 100 },
      { dueDate: new Date(Date.UTC(2026, 2, 15, 12)), amount: 100 },
      { dueDate: new Date(Date.UTC(2026, 3, 1, 12)), amount: 100 },
    ],
  });
  const c = expensesToCharges([e], MARZO.from, MARZO.to);
  assert.equal(c.length, 2);
});

test("totalInstallments 1 se trata como sin cuotas", () => {
  const c = expensesToCharges([gasto({ totalInstallments: 1 })], MARZO.from, MARZO.to);
  assert.equal(c.length, 1);
  assert.equal(c[0].amount, 1000);
});

test("el limite superior es exclusivo y el inferior inclusivo", () => {
  const justoAntes = gasto({ id: "a", date: new Date(Date.UTC(2026, 1, 28, 23, 59)) });
  const primerDia = gasto({ id: "b", date: MARZO.from });
  const primerDiaDelSiguiente = gasto({ id: "c", date: MARZO.to });
  const c = expensesToCharges([justoAntes, primerDia, primerDiaDelSiguiente], MARZO.from, MARZO.to);
  assert.deepEqual(c.map((x) => x.expenseId), ["b"]);
});
```

- [ ] **Step 5: Correr y ver fallar**

Run: `npm run verify`
Expected: FAIL — `Cannot find module '../src/lib/expenses/charges.ts'`

- [ ] **Step 6: Implementar `charges.ts`**

Crear `src/lib/expenses/charges.ts`. Sin imports.

```ts
export type Charge = {
  date: Date;
  amount: number;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  expenseId: string;
};

export type ChargeableExpense = {
  id: string;
  amount: number;
  date: Date;
  totalInstallments: number | null;
  category: { id: string; name: string; color: string };
  installments: { dueDate: Date; amount: number }[];
};

/**
 * Convierte gastos en CARGOS: lo que efectivamente se paga dentro de
 * `[from, to)`.
 *
 * Es la Enmienda 1 del spec hecha codigo. La Rebanada 1 dejo las dos rutas de
 * lectura en desacuerdo — el listado contaba una compra en cuotas en cada mes
 * que vencia una cuota, los graficos la contaban entera en el mes de la compra
 * — asi que el mismo mes daba dos totales y no habia forma de reconciliarlos.
 *
 * La regla, unica para las dos rutas:
 *
 *  - Sin cuotas (`totalInstallments` nulo o <= 1): un cargo por el monto del
 *    gasto, en la fecha del gasto.
 *  - En cuotas: un cargo por cada cuota que vence en el rango, por el monto de
 *    LA CUOTA, en la fecha de vencimiento. Nunca por el monto total, y nunca en
 *    el mes de la compra.
 *
 * `from` es inclusivo y `to` exclusivo, igual que los rangos de mes que ya usan
 * las routes (`Date.UTC(year, month - 1, 1)` a `Date.UTC(year, month, 1)`).
 */
export function expensesToCharges(
  expenses: ChargeableExpense[],
  from: Date,
  to: Date
): Charge[] {
  const charges: Charge[] = [];

  for (const e of expenses) {
    const enCuotas = e.totalInstallments !== null && e.totalInstallments > 1;

    if (!enCuotas) {
      if (e.date >= from && e.date < to) {
        charges.push({
          date: e.date,
          amount: e.amount,
          categoryId: e.category.id,
          categoryName: e.category.name,
          categoryColor: e.category.color,
          expenseId: e.id,
        });
      }
      continue;
    }

    for (const cuota of e.installments) {
      if (cuota.dueDate >= from && cuota.dueDate < to) {
        charges.push({
          date: cuota.dueDate,
          amount: cuota.amount,
          categoryId: e.category.id,
          categoryName: e.category.name,
          categoryColor: e.category.color,
          expenseId: e.id,
        });
      }
    }
  }

  return charges;
}
```

- [ ] **Step 7: Verificar y commitear**

Run: `npm run verify`
Expected: PASS — 80 preexistentes + 15 nuevos = 95.

```bash
git add src/lib/expenses/installments.ts src/lib/expenses/charges.ts tests/installments.test.ts tests/charges.test.ts
git commit -m "feat: aritmetica de cuotas y cargos en modulos puros con tests"
```

---

## Task 2: Usar `buildInstallments` en los dos lugares que la duplicaban

**Files:**
- Modify: `src/app/api/expenses/route.ts` (el bloque `installments: { create: ... }` del POST)
- Modify: `src/app/api/telegram/webhook/route.ts` (el bloque equivalente)

**Interfaces:**
- Consumes: `buildInstallments` de la Tarea 1.
- Produces: nada nuevo.

- [ ] **Step 1: Reemplazar el bloque inline en el POST de la web**

En `src/app/api/expenses/route.ts`, importar:

```ts
import { buildInstallments } from "@/lib/expenses/installments";
```

y reemplazar el `installments: numInstallments ? { create: Array.from(...) } : undefined` por:

```ts
        installments: numInstallments
          ? { create: buildInstallments(expenseDate, Number(amount), numInstallments) }
          : undefined,
```

- [ ] **Step 2: Reemplazar el bloque inline en el webhook**

En `src/app/api/telegram/webhook/route.ts`, importar lo mismo y reemplazar su bloque `Array.from({ length: parsed.installments }, ...)` por:

```ts
        installments: parsed.installments
          ? { create: buildInstallments(parsed.date, parsed.amount, parsed.installments) }
          : undefined,
```

- [ ] **Step 3: Confirmar que no quedó ninguna copia**

```bash
grep -rn "installmentNumber: i + 1" src/
```

Expected: sin resultados. Si aparece alguno, es una tercera copia que no estaba en la lista — reportarla.

- [ ] **Step 4: Verificar y commitear**

Run: `npm run verify`
Expected: PASS, 95 tests.

```bash
git add src/app/api/expenses/route.ts src/app/api/telegram/webhook/route.ts
git commit -m "refactor: las dos rutas usan buildInstallments en vez de duplicar la aritmetica"
```

---

## Task 3: `stats` pasa a semántica de flujo, y suma la tendencia de 12 meses

La tarea que arregla el bug que el usuario encontró usando la app.

**Files:**
- Modify: `src/app/api/expenses/stats/route.ts`
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (agregar el gráfico de tendencia)

**Interfaces:**
- Consumes: `expensesToCharges`, `Charge` de la Tarea 1.
- Produces: `GET /api/expenses/stats` agrega `trend12m: { month: string; total: number }[]` a su respuesta. `total`, `prevTotal`, `byCategory` y `dailyTotals` pasan a calcularse sobre cargos.

- [ ] **Step 1: Traer los gastos con sus cuotas y convertirlos a cargos**

En `stats/route.ts`, la consulta del mes actual tiene que incluir las cuotas y **no** filtrar por `date`, porque un gasto comprado hace un año puede tener una cuota que vence este mes. El filtro pasa a hacerlo `expensesToCharges`.

Reemplazar la consulta de `expenses` (líneas ~21-28) por:

```ts
  const visibles = { ...visibleExpensesWhere(session.id, householdUserIds) };

  // Sin filtro de fecha a proposito: una compra de hace un año puede tener una
  // cuota que vence este mes. El recorte por rango lo hace expensesToCharges.
  const todos = await prisma.expense.findMany({
    where: visibles,
    include: { category: true, installments: { select: { dueDate: true, amount: true } } },
    orderBy: { date: "desc" },
  });

  const cargos = expensesToCharges(todos, startDate, endDate);
  const cargosPrev = expensesToCharges(todos, prevStart, prevEnd);
```

Mover la definición de `prevStart` / `prevEnd` arriba de esa línea, y borrar la consulta separada de `prevExpenses`.

- [ ] **Step 2: Recalcular los agregados sobre cargos**

```ts
  const total = cargos.reduce((s, c) => s + c.amount, 0);
  const prevTotal = cargosPrev.reduce((s, c) => s + c.amount, 0);

  const byCategory = cargos.reduce(
    (acc: Record<string, { name: string; color: string; total: number; count: number }>, c) => {
      if (!acc[c.categoryName]) {
        acc[c.categoryName] = { name: c.categoryName, color: c.categoryColor, total: 0, count: 0 };
      }
      acc[c.categoryName].total += c.amount;
      acc[c.categoryName].count += 1;
      return acc;
    },
    {}
  );

  const dailyMap = cargos.reduce((acc: Record<string, number>, c) => {
    const day = c.date.toISOString().split("T")[0];
    acc[day] = (acc[day] || 0) + c.amount;
    return acc;
  }, {});
```

El resto del armado de `dailyTotals` no cambia. Donde el archivo usaba `expenses` para `recentExpenses` y `topExpense`, seguir usando `todos` filtrado por `date` en el mes — esas dos vistas son "qué compramos", no "qué pagamos", y ahí la fecha de compra es la correcta. Dejar un comentario diciéndolo, porque es la única parte del archivo que no usa cargos y va a parecer un olvido.

- [ ] **Step 3: La tendencia de 12 meses**

Agregar antes del `return`:

```ts
  // Tendencia: los 12 meses que terminan en el mes consultado, en cargos.
  const trend12m: { month: string; total: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const desde = new Date(Date.UTC(year, month - 1 - i, 1));
    const hasta = new Date(Date.UTC(year, month - i, 1));
    const delMes = expensesToCharges(todos, desde, hasta);
    trend12m.push({
      month: desde.toISOString().slice(0, 7),
      total: delMes.reduce((s, c) => s + c.amount, 0),
    });
  }
```

Agregar `trend12m` al objeto de la respuesta.

- [ ] **Step 4: El gráfico en el dashboard**

En `src/app/(dashboard)/dashboard/page.tsx`, agregar `trend12m: { month: string; total: number }[];` a la interfaz de stats y un `AreaChart` de Recharts siguiendo el patrón de los gráficos que ya están en el archivo. Título "Tendencia 12 meses". Usar `formatCurrency` para el tooltip, igual que los demás.

- [ ] **Step 5: Verificar contra los números reales**

Run: `npm run verify`

Después, con la app corriendo, comprobar **marzo 2026**, que es el mes de control de la Enmienda 1:

```bash
node --env-file=.env -e "
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const u = await p.user.findFirst({ where: { email: 'leandrojoel@hotmail.com' } });
  const t = jwt.sign({ id: u.id, email: u.email }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const r = await (await fetch('http://localhost:3000/api/expenses/stats?month=3&year=2026', { headers: { cookie: 'token=' + t } })).json();
  console.log('total de stats  :', Math.round(r.total));
  console.log('esperado (flujo):', 2301704);
  const l = await (await fetch('http://localhost:3000/api/expenses?month=3&year=2026&limit=1', { headers: { cookie: 'token=' + t } })).json();
  console.log('el listado cuenta:', l.meta.total, 'gastos en el mes');
  console.log('trend12m         :', r.trend12m?.length, 'meses');
  await p.\$disconnect();
})();
"
```

Expected: `total` = **2301704** (era 2397806 con la semántica vieja), y `trend12m` con 12 entradas. Si el total da 2397806, la conversión a cargos no se aplicó a `total`.

- [ ] **Step 6: Commitear**

```bash
git add src/app/api/expenses/stats/route.ts 'src/app/(dashboard)/dashboard/page.tsx'
git commit -m "fix: stats en semantica de flujo y tendencia de 12 meses"
```

---

## Task 4: Materializar los recurrentes como `Expense`

Los 10 recurrentes del usuario hoy no entran en ningún total. Al materializarse como `Expense` entran por los mismos cargos, sin ninguna rama especial.

**Files:**
- Create: `src/lib/recurring-materialize.ts`
- Create: `tests/recurring-materialize.test.ts`
- Modify: `src/app/api/expenses/route.ts` (llamarla en el GET)
- Modify: `src/app/api/expenses/stats/route.ts` (llamarla en el GET)

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: `export async function materializeRecurringForMonth(client: MaterializeClient, year: number, month: number): Promise<number>` — devuelve cuántos `Expense` creó.

- [ ] **Step 1: Escribir los tests con un cliente falso**

Crear `tests/recurring-materialize.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeRecurringForMonth, periodKey } from "../src/lib/recurring-materialize.ts";

function clienteFalso(plantillas: any[], yaExistentes: string[] = []) {
  const creados: any[] = [];
  const existentes = new Set(yaExistentes);
  const tx = {
    expense: {
      findFirst: async ({ where }: any) =>
        existentes.has(where.recurringExpenseId + ":" + where.recurringPeriod) ? { id: "ya" } : null,
      create: async ({ data }: any) => {
        existentes.add(data.recurringExpenseId + ":" + data.recurringPeriod);
        creados.push(data);
        return { id: "nuevo" };
      },
    },
  };
  return {
    creados,
    client: {
      recurringExpense: { findMany: async () => plantillas },
      $transaction: async (fn: any) => fn(tx),
    },
  };
}

const ALQUILER = {
  id: "rec-1",
  userId: "u1",
  categoryId: "cat-1",
  creditCardId: null,
  amount: 500000,
  description: "Alquiler",
  frequency: "MONTHLY",
  scope: "casa",
  active: true,
  createdAt: new Date(Date.UTC(2025, 0, 1)),
};

test("periodKey es el año-mes con dos digitos", () => {
  assert.equal(periodKey(2026, 3), "2026-03");
  assert.equal(periodKey(2026, 12), "2026-12");
});

test("crea un Expense por plantilla activa", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 1);
  assert.equal(creados[0].amount, 500000);
  assert.equal(creados[0].description, "Alquiler");
  assert.equal(creados[0].scope, "casa");
  assert.equal(creados[0].source, "recurring");
  assert.equal(creados[0].recurringPeriod, "2026-03");
});

test("el pagador y el creador son el userId de la plantilla", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados[0].userId, "u1");
  assert.equal(creados[0].createdById, "u1");
});

test("es idempotente: no duplica si ya existe el periodo", async () => {
  const { client, creados } = clienteFalso([ALQUILER], ["rec-1:2026-03"]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 0);
  assert.equal(creados.length, 0);
});

test("dos corridas seguidas crean una sola vez", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados.length, 1);
});

test("no materializa un mes anterior a la creacion de la plantilla", async () => {
  const nueva = { ...ALQUILER, createdAt: new Date(Date.UTC(2026, 5, 1)) };
  const { client, creados } = clienteFalso([nueva]);
  const n = await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(n, 0, "no puede inventar un alquiler de antes de que existiera la plantilla");
  assert.equal(creados.length, 0);
});

test("la fecha del gasto es el dia 1 del periodo, a mediodia UTC", async () => {
  const { client, creados } = clienteFalso([ALQUILER]);
  await materializeRecurringForMonth(client as any, 2026, 3);
  assert.equal(creados[0].date.toISOString(), "2026-03-01T12:00:00.000Z");
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `npm run verify`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar**

Crear `src/lib/recurring-materialize.ts`. Sin imports.

```ts
export type MaterializeTemplate = {
  id: string;
  userId: string;
  categoryId: string;
  creditCardId: string | null;
  amount: number;
  description: string;
  frequency: string;
  scope: string;
  active: boolean;
  createdAt: Date;
};

type Tx = {
  expense: {
    findFirst(args: { where: { recurringExpenseId: string; recurringPeriod: string } }): Promise<unknown | null>;
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type MaterializeClient = {
  recurringExpense: { findMany(args: unknown): Promise<MaterializeTemplate[]> };
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

/** La clave de idempotencia de un periodo: "2026-03". */
export function periodKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Crea los `Expense` que faltan para las plantillas mensuales activas en el
 * mes pedido. Devuelve cuantos creo.
 *
 * Por que materializar como `Expense` y no como un modelo aparte: la Rebanada 1
 * borro `RecurringExpensePeriod` porque su unico consumidor era el motor de
 * balance. Con los recurrentes como `Expense`, entran en los mismos cargos que
 * todo lo demas y los graficos los cuentan sin ninguna rama especial. Antes de
 * esto los 10 recurrentes del usuario no aparecian en ningun total: el alquiler
 * no estaba en el total del mes.
 *
 * IDEMPOTENCIA: `findFirst` por (`recurringExpenseId`, `recurringPeriod`) dentro
 * de una transaccion, que es el patron que ya venia funcionando en este repo.
 * En Mongo NO se puede declarar el `@@unique` de esos dos campos en Prisma: el
 * indice unico trataria el campo ausente como `null` y todos los gastos
 * manuales — que tienen los dos vacios — colisionarian entre si. El indice
 * unico PARCIAL que si sirve esta creado a mano en la base
 * (`Expense_recurring_period_unique_partial`) y es la red de seguridad; ver
 * `docs/data-models.md`.
 */
export async function materializeRecurringForMonth(
  client: MaterializeClient,
  year: number,
  month: number
): Promise<number> {
  const periodo = periodKey(year, month);
  const finDelMes = new Date(Date.UTC(year, month, 1));

  const plantillas = await client.recurringExpense.findMany({
    where: { active: true, frequency: "MONTHLY" },
  });

  let creados = 0;

  for (const t of plantillas) {
    // No inventar un periodo anterior a la existencia de la plantilla.
    if (t.createdAt >= finDelMes) continue;

    const creado = await client.$transaction(async (tx) => {
      const ya = await tx.expense.findFirst({
        where: { recurringExpenseId: t.id, recurringPeriod: periodo },
      });
      if (ya) return false;

      await tx.expense.create({
        data: {
          amount: t.amount,
          description: t.description,
          // Dia 1 a mediodia UTC: cae dentro del mes en cualquier zona.
          date: new Date(Date.UTC(year, month - 1, 1, 12, 0, 0)),
          categoryId: t.categoryId,
          creditCardId: t.creditCardId,
          userId: t.userId,
          createdById: t.userId,
          scope: t.scope,
          source: "recurring",
          recurringExpenseId: t.id,
          recurringPeriod: periodo,
        },
      });
      return true;
    });

    if (creado) creados++;
  }

  return creados;
}
```

- [ ] **Step 4: Llamarla desde las dos rutas de lectura**

En `src/app/api/expenses/route.ts` (GET) y `src/app/api/expenses/stats/route.ts` (GET), después de resolver la sesión y antes de consultar los gastos:

```ts
import { materializeRecurringForMonth } from "@/lib/recurring-materialize";
```

```ts
  // Perezoso: al leer un mes se crean los recurrentes que falten. Sin cron,
  // porque el free tier de Vercel los limita y el VPS usaria otro mecanismo.
  await materializeRecurringForMonth(prisma as never, year, month);
```

En `expenses/route.ts` el mes puede venir sin especificar; en ese caso usar el mes actual para la materialización.

- [ ] **Step 5: Verificar contra los datos reales**

Run: `npm run verify` (95 + 7 = 102 tests)

Después, con la app corriendo, comprobar que los recurrentes aparecen y que **no se duplican**:

```bash
node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  console.log('recurrentes materializados:', await p.expense.count({ where: { source: 'recurring' } }));
  const dup = await p.\$runCommandRaw({ aggregate: 'Expense', pipeline: [
    { \$match: { source: 'recurring' } },
    { \$group: { _id: { r: '\$recurringExpenseId', p: '\$recurringPeriod' }, n: { \$sum: 1 } } },
    { \$match: { n: { \$gt: 1 } } }
  ], cursor: {} });
  console.log('periodos duplicados:', dup.cursor.firstBatch.length, '(tiene que ser 0)');
  await p.\$disconnect();
})();
"
```

Pegar el listado con el mes cargado dos veces seguidas y mostrar que la segunda no crea nada.

- [ ] **Step 6: Commitear**

```bash
git add src/lib/recurring-materialize.ts tests/recurring-materialize.test.ts src/app/api/expenses/route.ts src/app/api/expenses/stats/route.ts
git commit -m "feat: materializa los recurrentes como Expense, perezoso e idempotente"
```

---

## Task 5: La página de recurrentes, con `scope`

Se borró en la Rebanada 1 y el usuario tiene 10 plantillas reales que no puede ver ni editar. Además `RecurringExpense.scope` existe en el schema pero ninguna ruta lo escribe, así que hoy es decorativo.

**Files:**
- Create: `src/app/(dashboard)/dashboard/recurring/page.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (volver a poner el link en el nav)
- Modify: `src/app/api/recurring-expenses/route.ts` (aceptar `scope` en el POST)
- Modify: `src/app/api/recurring-expenses/[id]/route.ts` (aceptar `scope` en el PUT)

**Interfaces:**
- Consumes: nada.
- Produces: `POST` y `PUT /api/recurring-expenses` aceptan `scope` (`"casa"` por defecto).

- [ ] **Step 1: El write path de `scope`**

En el POST de `recurring-expenses/route.ts`, agregar al `data` del `create`, con la misma coerción que usa `expenses/route.ts`:

```ts
      scope: body.scope === "personal" ? "personal" : "casa",
```

En el PUT de `[id]/route.ts`, agregar al `data` del `update`:

```ts
      scope: body.scope === undefined ? undefined : body.scope === "personal" ? "personal" : "casa",
```

El `undefined` deja el campo sin tocar cuando no viene en el body, que es la semántica de un PATCH parcial y la que ya usa el resto del archivo.

- [ ] **Step 2: La página**

Crear `src/app/(dashboard)/dashboard/recurring/page.tsx`. Un cliente `"use client"` con: la lista de plantillas (`GET /api/recurring-expenses`), un formulario de alta y edición con monto, descripción, categoría, tarjeta opcional, frecuencia, día del mes y un toggle Casa/Personal, y un botón de borrar. Seguir el patrón, el estilo Tailwind y la forma de manejar el estado de `src/app/(dashboard)/dashboard/expenses/page.tsx`, que es la página equivalente que sí existe — no inventar un patrón nuevo.

Mostrar en cada fila el `scope` y el próximo vencimiento (`nextDue`).

- [ ] **Step 3: El link en el nav**

En `src/app/(dashboard)/layout.tsx`, volver a agregar la entrada de `/dashboard/recurring` al array de nav primario, con un ícono del mismo estilo que los que ya están.

- [ ] **Step 4: Verificar**

Run: `npm run verify`

Con la app corriendo: abrir `/dashboard/recurring`, comprobar que se ven las 10 plantillas, crear una `personal`, editarla a `casa`, y confirmar con una consulta a Prisma que el campo cambió. Borrar la de prueba.

- [ ] **Step 5: Commitear**

```bash
git add 'src/app/(dashboard)/dashboard/recurring' 'src/app/(dashboard)/layout.tsx' src/app/api/recurring-expenses
git commit -m "feat: pagina de recurrentes y write path de scope"
```

---

## Task 6: Que una allowlist mal escrita falle ruidoso

Hoy, si un email de `HOUSEHOLD_EMAILS` tiene un typo, esa persona entra a la app y ve un dashboard vacío, sin ninguna pista. Con dos personas reales usando esto en producción, el síntoma sería "desaparecieron los gastos".

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Create: `tests/household-login.test.ts`

**Interfaces:**
- Consumes: `isHouseholdMemberEmail` de `src/lib/household.ts` (ya existe).
- Produces: `POST /api/auth/login` devuelve 403 para un email fuera de la allowlist.

- [ ] **Step 1: Rechazar el login de un no-miembro**

En `src/app/api/auth/login/route.ts`, después de validar la contraseña y antes de emitir el token:

```ts
  if (!isHouseholdMemberEmail(user.email)) {
    console.error(
      `Login rechazado: ${user.email} tiene cuenta pero NO esta en HOUSEHOLD_EMAILS. ` +
        `Si es un miembro legitimo, es un typo en la variable de entorno.`
    );
    return NextResponse.json(
      { error: "Esta cuenta no esta habilitada en esta instalacion" },
      { status: 403 }
    );
  }
```

Por qué en el login y no sólo en la lectura: un typo hace que la persona vea una app vacía sin explicación. Rechazar el login convierte "desaparecieron mis gastos" en "no puedo entrar", que es un síntoma que se diagnostica en un minuto. Y de paso cierra la escritura de una cuenta que quedó fuera de la allowlist.

- [ ] **Step 2: Test de la política, no de la route**

Crear `tests/household-login.test.ts`. La route no es testeable sin Next, pero la decisión sí:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { householdPolicy, isHouseholdEmail } from "../src/lib/visibility.ts";

test("un typo en la allowlist deja afuera al miembro legitimo", () => {
  const conTypo = householdPolicy("leandrojoel@hotmial.com,virginiapayetta@gmail.com", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", conTypo), false);
  assert.equal(isHouseholdEmail("virginiapayetta@gmail.com", conTypo), true);
});

test("la allowlist bien escrita acepta a los dos", () => {
  const ok = householdPolicy("leandrojoel@hotmail.com,virginiapayetta@gmail.com", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", ok), true);
  assert.equal(isHouseholdEmail("virginiapayetta@gmail.com", ok), true);
});

test("es insensible a mayusculas y espacios", () => {
  const ok = householdPolicy(" Leandrojoel@Hotmail.com , virginiapayetta@gmail.com ", "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", ok), true);
});

test("en produccion, sin la variable, nadie es miembro", () => {
  const vacia = householdPolicy(undefined, "production");
  assert.equal(isHouseholdEmail("leandrojoel@hotmail.com", vacia), false);
});

test("fuera de produccion, sin la variable, se abre para desarrollo local", () => {
  const dev = householdPolicy(undefined, "development");
  assert.equal(isHouseholdEmail("cualquiera@ejemplo.com", dev), true);
});
```

- [ ] **Step 3: Verificar y commitear**

Run: `npm run verify` (102 + 5 = 107)

Comprobar a mano que los dos usuarios reales **siguen pudiendo entrar** — esto es lo que rompería si la variable estuviera mal:

```bash
node --env-file=.env -e "
(async () => {
  const { householdPolicy, isHouseholdEmail } = await import('./src/lib/visibility.ts');
  const pol = householdPolicy(process.env.HOUSEHOLD_EMAILS, 'production');
  for (const e of ['leandrojoel@hotmail.com','virginiapayetta@gmail.com'])
    console.log(isHouseholdEmail(e, pol) ? 'OK   ' : 'FALLA', e);
})();
"
```

```bash
git add src/app/api/auth/login/route.ts tests/household-login.test.ts
git commit -m "fix: el login rechaza una cuenta fuera de la allowlist en vez de mostrar una app vacia"
```

---

## Task 7: Acotar las escrituras al conjunto de miembros

Hoy sólo las lecturas están acotadas. Una sesión de un no-miembro puede crear filas y renombrar categorías que los miembros sí ven.

**Files:**
- Modify: `src/app/api/expenses/route.ts` (POST)
- Modify: `src/app/api/recurring-expenses/route.ts` (POST)
- Modify: `src/app/api/categories/route.ts` (POST)
- Modify: `src/app/api/categories/[id]/route.ts` (PUT y DELETE)

**Interfaces:**
- Consumes: `isHouseholdMember` de `src/lib/household.ts` (ya existe).
- Produces: esas cinco escrituras devuelven 403 para un no-miembro.

- [ ] **Step 1: El guard, en las cinco escrituras**

En cada una, después del chequeo de sesión:

```ts
  if (!(await isHouseholdMember(session.id))) {
    return NextResponse.json({ error: "No habilitado" }, { status: 403 });
  }
```

Las de categorías son las más importantes de las cinco: son las únicas escrituras de un no-miembro que tocan algo que los miembros **ven**.

- [ ] **Step 2: Confirmar que no quedó ninguna escritura sin acotar**

```bash
grep -rn "export async function \(POST\|PUT\|DELETE\)" src/app/api/ | grep -v telegram | grep -v auth
```

Para cada una que salga, confirmar en el reporte que tiene el guard o explicar por qué no lo necesita.

- [ ] **Step 3: Verificar y commitear**

Run: `npm run verify`

```bash
git add src/app/api
git commit -m "fix: acota las escrituras al conjunto de miembros del hogar"
```

---

## Task 8: El test de privacidad, granular por llamada

`tests/read-paths.test.ts` hoy es granular por archivo, así que una lectura mala **dentro** de `expenses/route.ts` o `recurring-expenses/route.ts` es invisible — está verificado por mutación.

**Files:**
- Modify: `tests/read-paths.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Cambiar la granularidad**

Reemplazar el matcheo por archivo por uno que mire dentro de la llamada. La forma del detector, para que no haya que inventarla:

```ts
const MODELOS = String.raw`(?:expense|recurringExpense)`;
const LECTURAS = String.raw`(?:findMany|findFirst|findUnique|count|aggregate|groupBy)`;

/**
 * Matchea una llamada de lectura de Prisma y captura el cuerpo de su argumento,
 * de forma no-greedy para no engancharse con la llamada siguiente. Es un
 * heuristico de texto, no un parser: alcanza porque el patron que buscamos esta
 * escrito de forma uniforme en todo el repo, y el test de obsolescencia que el
 * archivo ya tiene avisa si eso deja de ser cierto.
 */
const LECTURA_RE = new RegExp(
  String.raw`prisma\.` + MODELOS + String.raw`\.` + LECTURAS + String.raw`\s*\(([\s\S]*?)\)\s*;`,
  "g"
);

const PROHIBIDO_RE = /userId:\s*session\.id/;
```

Barrer `src/app/api/` **y también `src/lib/`** — hoy el test sólo mira el primero, así que un módulo de `src/lib` que lea gastos es invisible para él.

Conservar el allowlist con su razón por entrada y el guard de "no puede quedar vacío" que el test ya tiene.

- [ ] **Step 2: Probar en negativo, que es el único modo de saber que sirve**

Antes de commitear, comprobar que el test **falla** con estas tres mutaciones, aplicadas sobre una copia en el scratchpad y revertidas después:

1. Un `prisma.expense.findMany({ where: { userId: session.id } })` agregado **dentro** de `src/app/api/expenses/route.ts` — el caso que hoy pasa desapercibido.
2. Lo mismo dentro de `src/app/api/recurring-expenses/route.ts`.
3. Un archivo nuevo en `src/lib/` que lea gastos con `userId: session.id`.

Pegar la salida de las tres corridas fallidas en el reporte. Un test de escaneo de fuente que no se probó en negativo no vale nada.

- [ ] **Step 3: Commitear**

```bash
git add tests/read-paths.test.ts
git commit -m "test: el guard de privacidad pasa a ser granular por llamada, no por archivo"
```

---

## Task 9: Limpiar la landing y sacar el registro

Es de uso privado de dos personas. La landing ofrece "Registrarse", que devuelve 403 para cualquiera fuera de la allowlist: un botón que no puede funcionar. Y anuncia OCR, que es de una rebanada futura.

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/app/(auth)/register/page.tsx`
- Modify: `src/app/api/auth/register/route.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `/register` deja de existir como página.

- [ ] **Step 1: La landing**

Reemplazar `src/app/page.tsx` por:

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <div className="text-center space-y-6 px-4">
        <div className="text-6xl mb-4">$</div>
        <h1 className="text-5xl font-bold">Gastos de casa</h1>
        <p className="text-xl text-indigo-100 max-w-md mx-auto">
          Manda el gasto por Telegram y se carga solo: monto, fecha y categoria
          se infieren del mensaje.
        </p>
        <div className="flex justify-center pt-4">
          <Link
            href="/login"
            className="px-8 py-3 bg-white text-indigo-600 rounded-lg font-semibold hover:bg-indigo-50 transition"
          >
            Iniciar Sesion
          </Link>
        </div>
        <p className="text-sm text-indigo-200 pt-8">
          Uso privado. No hay registro abierto.
        </p>
      </div>
    </div>
  );
}
```

Se va el botón de registro, se va la grilla de features (anunciaba OCR, que no existe), y el título deja de ser genérico.

- [ ] **Step 2: Borrar la página de registro**

```bash
git rm 'src/app/(auth)/register/page.tsx'
```

- [ ] **Step 3: La route de registro se queda, pero cerrada**

**No borrar `src/app/api/auth/register/route.ts`.** Sigue siendo la única forma de crear una cuenta si algún día hace falta, y ya está detrás de la allowlist. Agregarle un comentario de cabecera diciendo que no tiene UI a propósito, que es de uso privado de dos personas, y cómo se crea una cuenta si alguna vez se necesita (un `curl` con un email que esté en `HOUSEHOLD_EMAILS`).

- [ ] **Step 4: Confirmar que no quedó ningún link a `/register`**

```bash
grep -rn "/register" src/ --include=*.tsx --include=*.ts
```

Expected: sólo la route de API. Si aparece un `Link` o un `redirect`, sacarlo.

- [ ] **Step 5: Verificar y commitear**

Run: `npm run verify`

```bash
git add src/app/page.tsx src/app/api/auth/register/route.ts
git commit -m "feat: landing de uso privado, sin registro abierto"
```

---

## Task 10: El mensaje del bot para consultas, y la documentación

El usuario le preguntó al bot por el historial y recibió "no pude registrarlo", sin manera de saber si fue un error o una función que no existe. Con dos personas usándolo, va a pasar seguido.

**Files:**
- Modify: `src/lib/ai/parse.ts` (el prompt)
- Modify: `src/app/api/telegram/webhook/route.ts` (el mensaje)
- Modify: `docs/features-backlog.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: nada.
- Produces: `ParseResult` gana la variante `{ intent: "consulta_no_soportada" }`.

- [ ] **Step 1: Que el prompt distinga una pregunta de un mensaje sin sentido**

En `buildSystemPrompt` de `src/lib/ai/parse.ts`, agregar al formato de respuesta:

```
Si el mensaje es una PREGUNTA sobre gastos ya registrados (cuanto gastamos,
cuanto llevamos, mostrame los de tal categoria):
{ "intent": "consulta_no_soportada" }
```

Y agregar el tipo a `src/lib/ai/types.ts`, más la rama en `parseMessage` que lo devuelve tal cual.

- [ ] **Step 2: Tests del nuevo intent**

Agregar a `tests/parse.test.ts`, con el provider falso:

```ts
test("una pregunta devuelve consulta_no_soportada, no desconocido", async () => {
  const provider = fakeProvider(JSON.stringify({ intent: "consulta_no_soportada" }));
  const r = await parseMessage("cuanto gastamos este mes?", CTX, provider);
  assert.equal(r.intent, "consulta_no_soportada");
});

test("un intent que no conocemos cae a desconocido", async () => {
  const provider = fakeProvider(JSON.stringify({ intent: "bailar" }));
  const r = await parseMessage("bailemos", CTX, provider);
  assert.equal(r.intent, "desconocido");
});
```

- [ ] **Step 3: El mensaje en el webhook**

En la rama del webhook que hoy responde el motivo del `desconocido`, agregar antes:

```ts
    if (parsed.intent === "consulta_no_soportada") {
      await sendMessage(
        intake.chatId,
        "Todavia no puedo responder preguntas sobre los gastos. Mirá el dashboard en la web."
      );
      return OK();
    }
```

- [ ] **Step 4: Corregir la mentira del backlog**

En `docs/features-backlog.md`, el ítem del filtrado de cuotas por mes está marcado "✅ Completo" y era falso para una de las dos rutas de lectura — es el bug que el usuario encontró. Cambiarlo por completo, describiendo qué quedó resuelto en esta rebanada (semántica de flujo en las dos rutas, según la Enmienda 1 del spec) y quitando la afirmación vieja.

- [ ] **Step 5: Actualizar `docs/architecture.md`**

Agregar los módulos nuevos al árbol de carpetas: `src/lib/expenses/` (`installments.ts`, `charges.ts`, `create-from-bot.ts`), `src/lib/recurring-materialize.ts`, `src/lib/idempotency.ts`. El archivo hoy omite `lib/expenses/` y `lib/idempotency.ts`, y lista `lib/ocr/` y `lib/queries/` que todavía no existen — dejar esos dos marcados como futuros.

Documentar en una línea la semántica de flujo y que `expensesToCharges` es el único lugar donde vive.

- [ ] **Step 6: Verificar y commitear**

Run: `npm run verify`

```bash
git add src/lib/ai src/app/api/telegram/webhook tests/parse.test.ts docs/
git commit -m "feat: el bot avisa que las consultas no existen todavia, y corrige la documentacion"
```

---

## Task 11: Verificación final de la rebanada

**Files:** ninguno — es sólo verificación.

- [ ] **Step 1: La suite completa y el build**

```bash
npm run verify
npm run build
```

El build corre **acá y sólo acá**: son 45.765 ms medidos, y se difirió a propósito en las diez tareas anteriores.

- [ ] **Step 2: Los números que tienen que cuadrar**

Con la app corriendo, comprobar que el bug que motivó la rebanada está cerrado: para marzo 2026 y para el mes actual, el total de `stats` y la suma de los cargos del listado tienen que coincidir. Pegar los dos números de los dos meses.

- [ ] **Step 3: Que la data real sobrevivió**

```bash
node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  console.log('gastos totales   :', await p.expense.count());
  console.log('  source=web     :', await p.expense.count({ where: { source: 'web' } }), '(tienen que seguir siendo 386)');
  console.log('  source=bot     :', await p.expense.count({ where: { source: 'bot' } }), '(2)');
  console.log('  source=recurring:', await p.expense.count({ where: { source: 'recurring' } }), '(nuevos)');
  console.log('cuotas           :', await p.installment.count(), '(66)');
  console.log('plantillas       :', await p.recurringExpense.count(), '(10)');
  console.log('usuarios         :', await p.user.count(), '(2, los dos vinculados)');
  await p.\$disconnect();
})();
"
```

Los 386 `source=web` y las 66 cuotas son historial real del usuario: si cambiaron, algo los tocó y hay que reportarlo antes de seguir.

- [ ] **Step 4: Los guards siguen en pie**

```bash
grep -rn 'userId: session.id' src/app/api/ | cat
```

Cada resultado tiene que ser una escritura o una ruta de `credit-cards`. Ninguna lectura de `Expense` o `RecurringExpense`.
