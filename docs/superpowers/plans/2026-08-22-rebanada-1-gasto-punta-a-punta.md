# Rebanada 1 — Un gasto escrito, punta a punta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mandar "12 lucas panadería" al bot de Telegram y ver ese gasto en `/dashboard/expenses`, sobre el schema simplificado.

**Architecture:** Se recorta el schema de 14 modelos a 8 y se elimina toda la maquinaria de grupos, splits y presupuestos. La ingesta entra por un webhook de Telegram que normaliza el update, descarta reintentos por `update_id`, resuelve el usuario por `telegramChatId`, manda el texto a Grok detrás de una interfaz `AiProvider`, valida el resultado en código (montos, fechas, categoría) y crea un `Expense`. La lógica pura (visibilidad, normalización, parseo) vive en módulos sin dependencias de Next ni de Prisma, así que se testea con `node --test` sin base de datos.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 6 + MongoDB, Tailwind 4, JWT propio en cookie httpOnly, `node --test` (Node 24 con type-stripping nativo), API de xAI (Grok), Bot API de Telegram.

**Spec:** `docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md`

## Global Constraints

- **Idioma de los errores de API:** español, en formato `{ error: "mensaje" }`. Copiado de `CLAUDE.md`.
- **Sesión:** toda API route valida al inicio con `const session = await getSession(); if (!session) return 401`. No hay middleware de auth.
- **Prisma:** usar el singleton `import { prisma } from "@/lib/prisma"`. Provider MongoDB: **nunca** `prisma migrate`, siempre `npx prisma db push`.
- **IDs:** ObjectId (`@db.ObjectId`).
- **Zona horaria de negocio:** `America/Argentina/Buenos_Aires`. Todas las fechas se guardan en UTC pero se interpretan y se mues­tran en esa zona.
- **Scope de un gasto:** exactamente `"casa"` o `"personal"`. Sin otros valores.
- **Visibilidad de lectura:** `scope: "casa"` lo ven los dos; `scope: "personal"` lo ve sólo `userId` (quién pagó). Nunca `createdById`.
- **Permiso de edición vía bot:** `userId` **o** `createdById`. Es una función distinta de la de lectura; no unificarlas.
- **Módulos de lógica pura** (`src/lib/visibility.ts`, `src/lib/ai/normalize.ts`, `src/lib/ai/parse.ts`, `src/lib/telegram/intake.ts`): sin imports con alias `@/`, sin imports de `next/*` ni de `@prisma/client`. `node --test` no resuelve los alias de `tsconfig`, y estos módulos tienen que ser testeables sin arrancar Next.
- **Test runner:** `npm test` → `node --test "tests/**/*.test.ts"`. **Tiene que ser un glob, no un directorio**: `node --test tests/` falla en Windows con `Cannot find module` (Node interpreta el directorio como módulo). Verificado en esta máquina con Node v24.15.0.
- **Imports entre módulos puros:** rutas relativas con extensión explícita (`./normalize.ts`), porque el type-stripping de Node no resuelve extensiones implícitas. Esto exige `"allowImportingTsExtensions": true` en `tsconfig.json`, o `tsc` falla con `TS5097`. Ambas cosas se configuran en la Tarea 1.
- **Commits:** uno por tarea como mínimo, en español, con prefijo convencional (`feat:`, `refactor:`, `chore:`, `docs:`).

## Desvío respecto del inventario del spec

La sección 11 del spec lista `dashboard/home/page.tsx` y `dashboard/recurring/page.tsx` como "se reescribe". Este plan las **borra** en la Tarea 4 y las reconstruye en la Rebanada 3.

Razón: son 920 y 589 líneas construidas casi enteramente sobre `shares` y `splitMode`. Reescribirlas no aporta al camino punta a punta de esta rebanada, y la vista de la casa pertenece naturalmente a la Rebanada 3, donde se combina con recurrentes y gráficos. Consecuencia aceptada: entre la Rebanada 1 y la 3 no se pueden crear plantillas de recurrentes desde la web. La data se descarta igual, así que se cargan ahí.

Las rutas API de recurrentes **sí** se conservan y se limpian (Tarea 2): son la base de la Rebanada 3.

## Estructura de archivos

**Lógica pura, testeable sin DB ni Next:**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/visibility.ts` | La regla de lectura y el permiso de edición. Único lugar donde viven. |
| `src/lib/ai/types.ts` | `ParseContext`, `ParseResult` y sus variantes. Sin lógica. |
| `src/lib/ai/normalize.ts` | Montos ("12 lucas", `12.500`) y fechas (ISO → `Date` validada). |
| `src/lib/ai/parse.ts` | Arma el prompt, llama al provider, valida la respuesta. |
| `src/lib/telegram/intake.ts` | Update crudo de Telegram → `Intake`. |

**Adaptadores con I/O:**

| Archivo | Responsabilidad |
|---|---|
| `src/lib/ai/provider.ts` | La interfaz `AiProvider` y el selector por env. |
| `src/lib/ai/grok.ts` | Implementación de `AiProvider` contra la API de xAI. |
| `src/lib/telegram/client.ts` | `sendMessage` contra la Bot API. |
| `src/lib/idempotency.ts` | Reclama un `update_id` contra `ProcessedUpdate`. |
| `src/lib/env.ts` | Lee y valida las variables de entorno obligatorias. |

**Rutas nuevas:**

| Archivo | Responsabilidad |
|---|---|
| `src/app/api/telegram/webhook/route.ts` | Orquesta: idempotencia → usuario → parse → `Expense` → confirmación. |
| `src/app/api/telegram/link/route.ts` | Genera el `telegramLinkCode` de un solo uso. |

El webhook es un orquestador delgado: no conoce el prompt, ni el formato de Telegram, ni la regla de visibilidad. Todo eso vive en los módulos de arriba.

---

## Task 1: Harness de tests y la regla de visibilidad

Establece `npm test` y entrega el módulo más crítico del sistema. Va primero porque no depende del schema: es una función pura.

**Files:**
- Modify: `package.json` (bloque `scripts`, líneas 5-10)
- Modify: `tsconfig.json` (`compilerOptions`)
- Create: `src/lib/visibility.ts`
- Create: `tests/visibility.test.ts`
- Delete: `tests/recurring-periods.test.mjs`
- Delete: `tests/recurring-periods.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export type ExpenseScope = "casa" | "personal"`
  - `export function visibleExpensesWhere(userId: string): { OR: Array<{ scope: string; userId?: string }> }`
  - `export function canEditViaBot(expense: { userId: string; createdById: string }, actorId: string): boolean`

- [ ] **Step 1: Agregar el script de test y borrar los tests muertos**

`tests/recurring-periods.test.mjs` y `tests/recurring-periods.test.ts` testean `ensureRecurringPeriodsForMonth`, que opera sobre `PeriodShare` y `groupId` — modelos que esta rebanada elimina. No se migran: la materialización de recurrentes es Rebanada 3 y se testea de nuevo ahí.

```bash
rm tests/recurring-periods.test.mjs tests/recurring-periods.test.ts
```

En `package.json`, el bloque `scripts` queda:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "node --test \"tests/**/*.test.ts\""
  },
```

**El glob no es opcional.** `node --test tests/` falla en Windows con `Error: Cannot find module ...\tests` porque Node trata el argumento como módulo en vez de descubrir archivos. Con el glob entre comillas, el globbing lo hace Node. Verificado en esta máquina con Node v24.15.0.

- [ ] **Step 1b: Habilitar los imports con extensión `.ts`**

En `tsconfig.json`, agregar a `compilerOptions`:

```json
    "allowImportingTsExtensions": true,
```

Sin esto, `npx tsc --noEmit` falla con `TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled` en cuanto un módulo puro importe a otro (Tarea 8, `parse.ts` → `normalize.ts`). Y la extensión explícita **sí** es necesaria, porque el type-stripping de Node no resuelve `./normalize` sin extensión. El flag requiere `noEmit: true`, que este `tsconfig.json` ya tiene.

Verificar que la combinación funciona antes de seguir:

```bash
npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 2: Escribir el test que falla**

Crear `tests/visibility.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleExpensesWhere, canEditViaBot } from "../src/lib/visibility.ts";

const JOEL = "joel-id";
const ELLA = "ella-id";

test("visibleExpensesWhere incluye siempre los gastos de casa", () => {
  const where = visibleExpensesWhere(JOEL);
  assert.deepEqual(where.OR[0], { scope: "casa" });
});

test("visibleExpensesWhere limita los personales a quien pago", () => {
  const where = visibleExpensesWhere(JOEL);
  assert.deepEqual(where.OR[1], { scope: "personal", userId: JOEL });
});

test("visibleExpensesWhere no expone personales por createdById", () => {
  const where = visibleExpensesWhere(JOEL);
  const serialized = JSON.stringify(where);
  assert.ok(!serialized.includes("createdById"));
});

test("canEditViaBot permite al pagador", () => {
  const expense = { userId: JOEL, createdById: ELLA };
  assert.equal(canEditViaBot(expense, JOEL), true);
});

test("canEditViaBot permite a quien lo registro aunque no lo pueda leer", () => {
  const expense = { userId: JOEL, createdById: ELLA };
  assert.equal(canEditViaBot(expense, ELLA), true);
});

test("canEditViaBot rechaza a un tercero", () => {
  const expense = { userId: JOEL, createdById: JOEL };
  assert.equal(canEditViaBot(expense, "otro-id"), false);
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/visibility.ts'`

- [ ] **Step 4: Implementar el módulo**

Crear `src/lib/visibility.ts`. Sin imports: es lógica pura y tiene que poder correr bajo `node --test`.

```ts
export type ExpenseScope = "casa" | "personal";

/**
 * Regla de LECTURA. Se usa en toda consulta de gastos: listados, stats,
 * export y las consultas del bot.
 *
 * Los gastos de casa los ven los dos. Los personales los ve unicamente
 * quien los pago (`userId`), NUNCA quien los registro (`createdById`).
 */
export function visibleExpensesWhere(userId: string) {
  return {
    OR: [
      { scope: "casa" },
      { scope: "personal", userId },
    ],
  };
}

/**
 * Permiso de EDICION via el bot. Deliberadamente mas amplio que la lectura:
 * quien registro un gasto puede corregir una carga mal hecha desde el mensaje
 * de confirmacion que quedo en su chat, aunque no pueda verlo en la web.
 *
 * No unificar con visibleExpensesWhere: si se usa este permiso para leer, se
 * filtran gastos personales.
 */
export function canEditViaBot(
  expense: { userId: string; createdById: string },
  actorId: string
): boolean {
  return expense.userId === actorId || expense.createdById === actorId;
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/visibility.ts tests/
git commit -m "feat: harness de tests y regla de visibilidad casa/personal"
```

---

## Task 2: Limpiar las rutas API de shares, grupos y presupuestos

Se saca todo el código de splits de las rutas que **sobreviven**, sin tocar el schema todavía. Así el build queda verde al terminar la tarea, y la Tarea 4 puede borrar los modelos sin romper nada.

**Files:**
- Modify: `src/app/api/expenses/route.ts` (borrar `createExpenseShares` líneas 5-68; limpiar el POST)
- Modify: `src/app/api/expenses/[id]/route.ts` (borrar el helper de shares líneas 1-88; limpiar el PATCH)
- Modify: `src/app/api/expenses/stats/route.ts` (borrar el bloque de alertas de presupuesto)
- Modify: `src/app/api/recurring-expenses/route.ts` (borrar el helper de shares líneas 5-70; limpiar el POST)
- Modify: `src/app/api/recurring-expenses/[id]/route.ts` (limpiar el PATCH y el DELETE)
- Modify: `src/app/api/categories/[id]/route.ts:30-31` (sacar la comprobación de `budget`)

**Interfaces:**
- Consumes: nada.
- Produces: `POST /api/expenses` acepta sólo `{ amount, description, date?, categoryId, creditCardId?, totalInstallments? }`. `POST /api/recurring-expenses` acepta sólo `{ amount, description, categoryId, creditCardId?, frequency, dayOfMonth?, nextDue }`.

- [ ] **Step 1: Limpiar `src/app/api/expenses/route.ts`**

Borrar completo el `type ManualShare` y la función `createExpenseShares` (líneas 5-68). En el `GET`, sacar `shares` del `include`. En el `POST`, sacar del destructuring de `body` los campos `isShared`, `splitMode`, `sharedUserIds`, `sharedUsers`, `groupId`; sacar `groupId`, `isShared`, `splitMode` del `data` del `create`; y borrar el bloque `if (isShared) { ... }` entero.

El `POST` queda así:

```ts
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const body = await req.json();
    const { amount, description, date, categoryId, creditCardId, totalInstallments } = body;

    if (!amount || !description || !categoryId) {
      return NextResponse.json(
        { error: "Campos requeridos: amount, description, categoryId" },
        { status: 400 }
      );
    }

    const expenseDate = date ? new Date(date) : new Date();
    const numInstallments =
      totalInstallments && totalInstallments > 1 ? Number(totalInstallments) : null;
    const installmentAmount = numInstallments
      ? Number(amount) / numInstallments
      : Number(amount);

    const expense = await prisma.expense.create({
      data: {
        amount: Number(amount),
        description,
        date: expenseDate,
        categoryId,
        creditCardId: creditCardId || null,
        totalInstallments: numInstallments,
        userId: session.id,
        installments: numInstallments
          ? {
              create: Array.from({ length: numInstallments }, (_, i) => {
                const due = new Date(expenseDate);
                due.setMonth(due.getMonth() + i);
                return {
                  installmentNumber: i + 1,
                  dueDate: due,
                  amount: installmentAmount,
                };
              }),
            }
          : undefined,
      },
      include: {
        category: true,
        installments: { orderBy: { installmentNumber: "asc" } },
      },
    });

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Error al crear gasto" }, { status: 500 });
  }
}
```

`createdById` y `scope` **no** se agregan todavía: esos campos no existen hasta la Tarea 4. Se suman en la Tarea 5.

- [ ] **Step 2: Limpiar `src/app/api/expenses/[id]/route.ts`**

Borrar el helper de shares (líneas 1-88, el bloque equivalente a `createExpenseShares`). En el `PATCH`, sacar del destructuring `isShared`, `splitMode`, `sharedUserIds`, `sharedUsers`; sacar `groupId`, `isShared`, `splitMode` del `data`; borrar los bloques `if (isShared === false)` y `else if (isShared === true)`. En el `DELETE`, sacar el `deleteMany` de `expenseShare` si está.

- [ ] **Step 3: Limpiar `src/app/api/expenses/stats/route.ts`**

Borrar la consulta a `prisma.budget` y el bloque que construye `alerts`, y sacar `alerts` del objeto de respuesta. Es el único uso de `Budget` en esta ruta.

- [ ] **Step 4: Limpiar las rutas de recurrentes**

En `src/app/api/recurring-expenses/route.ts`: borrar el helper de shares (líneas 5-70), sacar `shares` del `include` del `GET`, y del `POST` sacar `isShared`, `splitMode`, `sharedUserIds`, `sharedUsers`, `groupId`, `payerId` del destructuring y del `data`; borrar el bloque `if (isShared) { ... }`.

En `src/app/api/recurring-expenses/[id]/route.ts`: sacar los mismos campos del `PATCH`, y en el `DELETE` borrar las líneas 144-148 (el barrido de `recurringExpensePeriod` y `periodShare`).

- [ ] **Step 5: Limpiar `src/app/api/categories/[id]/route.ts`**

Borrar las líneas 30-31 (la cuenta de `prisma.budget`) y la condición que impide borrar la categoría si tiene presupuestos. La comprobación de gastos asociados se mantiene.

- [ ] **Step 6: Verificar que compila y que no queda ninguna referencia**

```bash
npx tsc --noEmit
grep -rn 'expenseShare\|recurringShare\|periodShare\|prisma.budget\|prisma.group\|monthlyIncome' src/app/api/expenses src/app/api/recurring-expenses src/app/api/categories
```

Expected: `tsc` sin errores en esos archivos, y el `grep` sin resultados.

- [ ] **Step 7: Commit**

```bash
git add src/app/api
git commit -m "refactor: saca shares, grupos y presupuestos de las rutas que sobreviven"
```

---

## Task 3: Limpiar el front de shares, grupos y presupuestos

Igual que la Tarea 2 pero en el front, y también sin tocar el schema. El filtro por `scope` **no** entra acá: ese campo no existe hasta la Tarea 4.

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx:55-62` (nav) y el array de nav primario
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (sacar `alerts` de presupuesto: línea 35, y el bloque 95-108)
- Modify: `src/app/(dashboard)/dashboard/expenses/page.tsx` (sacar toda la UI de shares y grupos)

**Interfaces:**
- Consumes: `POST /api/expenses` con el body reducido de la Tarea 2.
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Limpiar el nav de `layout.tsx`**

En `secondaryNavItems` (líneas 55-62) borrar las entradas de `"/dashboard/groups"` y `"/dashboard/budgets"`. Queda:

```tsx
const secondaryNavItems = [
  { href: "/dashboard/categories", label: "Categorias" },
  { href: "/dashboard/export", label: "Exportar" },
];
```

En el array de nav primario, borrar las entradas que apuntan a `/dashboard/home` y `/dashboard/recurring` (esas páginas se borran en la Tarea 4). Quedan `/dashboard`, `/dashboard/expenses` y `/dashboard/credit-cards`.

- [ ] **Step 2: Sacar las alertas de presupuesto de `dashboard/page.tsx`**

Borrar de la interfaz de stats el campo `alerts` (línea 35) y el bloque JSX que lo renderiza (líneas 95-108, el comentario `{/* Budget alerts */}` y su contenido). El resto de los gráficos no se toca.

- [ ] **Step 3: Sacar la UI de shares y grupos de `expenses/page.tsx`**

Localizar y borrar:

```bash
grep -n 'isShared\|splitMode\|groupId\|shares\|sharedUser\|ShareDetail\|Compartido\|Grupo' 'src/app/(dashboard)/dashboard/expenses/page.tsx'
```

Borrar las interfaces de shares, el estado del formulario asociado a compartir (checkbox de compartido, selector de modo de split, inputs de porcentaje, selector de grupo), y la columna/badge de compartido en la tabla y en las tarjetas mobile. El formulario de alta queda con: monto, descripción, fecha, categoría, tarjeta y cuotas.

- [ ] **Step 4: Verificar que compila y arranca**

```bash
npx tsc --noEmit
npm run build
```

Expected: ambos sin errores.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(dashboard)'
git commit -m "refactor: saca la UI de shares, grupos y presupuestos"
```

---

## Task 4: Schema nuevo, demolición y semilla de categorías

La tarea bisagra. Nada referencia ya a los modelos que se van, así que se pueden borrar y aplicar el schema nuevo de una.

**Files:**
- Modify: `prisma/schema.prisma` (reemplazo completo)
- Create: `src/lib/env.ts`
- Modify: `src/lib/auth.ts:4` (`JWT_SECRET` obligatorio)
- Create: `.env.example`
- Create: `scripts/seed-categories.ts`
- Delete: `src/app/api/budgets/route.ts`, `src/app/api/income/route.ts`, `src/app/api/shared/route.ts`
- Delete: `src/app/api/groups/` (todo el árbol)
- Delete: `src/app/api/expenses/[id]/shares/route.ts`
- Delete: `src/app/api/recurring-expenses/[id]/shares/route.ts`, `src/app/api/recurring-expenses/[id]/periods/route.ts`
- Delete: `src/app/(dashboard)/dashboard/budgets/`, `groups/`, `income/`, `shared/`, `home/`, `recurring/`
- Delete: `src/lib/recurring-periods.ts`
- Delete: `scripts/seed-shares.ts`, `scripts/migrate-expenses-to-shared.ts`
- Delete: `docs/shared-expenses.md`, `docs/balance-calculation.md`, `docs/groups.md`
- Modify: `CLAUDE.md`, `docs/architecture.md`, `docs/data-models.md`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Los modelos `Expense` (con `createdById`, `scope`, `source`, `recurringExpenseId`, `recurringPeriod`, `botChatId`, `botMessageId`), `Alias`, `ProcessedUpdate` y `User.telegramChatId` / `User.telegramLinkCode`.
  - `export function requireEnv(name: string): string` en `src/lib/env.ts`.

- [ ] **Step 1: Borrar todo lo que se va**

```bash
git rm -r src/app/api/groups
git rm src/app/api/budgets/route.ts src/app/api/income/route.ts src/app/api/shared/route.ts
git rm 'src/app/api/expenses/[id]/shares/route.ts'
git rm 'src/app/api/recurring-expenses/[id]/shares/route.ts' 'src/app/api/recurring-expenses/[id]/periods/route.ts'
git rm -r 'src/app/(dashboard)/dashboard/budgets' 'src/app/(dashboard)/dashboard/groups' 'src/app/(dashboard)/dashboard/income' 'src/app/(dashboard)/dashboard/shared' 'src/app/(dashboard)/dashboard/home' 'src/app/(dashboard)/dashboard/recurring'
git rm src/lib/recurring-periods.ts
git rm scripts/seed-shares.ts scripts/migrate-expenses-to-shared.ts
git rm docs/shared-expenses.md docs/balance-calculation.md docs/groups.md
rmdir src/app/api/categorize src/app/api/ocr 2>/dev/null || true
```

Las dos últimas son carpetas vacías que quedaron de un intento anterior; el OCR real va en `src/lib/ocr/` en la Rebanada 4.

- [ ] **Step 2: Reemplazar `prisma/schema.prisma`**

Copiar el schema completo de la sección 4 del spec. Se mantienen el bloque `generator`, el `datasource` y el `enum Frequency` tal como están hoy. Los 8 modelos quedan: `User`, `Category`, `Expense`, `Installment`, `CreditCard`, `RecurringExpense`, `Alias`, `ProcessedUpdate`.

- [ ] **Step 3: Aplicar el schema y verificar**

```bash
npx prisma db push
npx prisma generate
```

Expected: `db push` reporta los modelos eliminados y creados. Si la base tiene data vieja incompatible, `db push` puede pedir `--accept-data-loss`; se acepta — la sección 2 del spec decide descartar la data existente.

- [ ] **Step 4: `JWT_SECRET` obligatorio**

Crear `src/lib/env.ts`:

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}
```

En `src/lib/auth.ts`, reemplazar la línea 4:

```ts
const JWT_SECRET = process.env.JWT_SECRET || "expense-tracker-secret-demo-key";
```

por:

```ts
import { requireEnv } from "./env";

const JWT_SECRET = requireEnv("JWT_SECRET");
```

Un secret conocido en un dominio público permite forjar sesiones de cualquier usuario.

- [ ] **Step 5: Crear `.env.example`**

```
# Base de datos
DATABASE_URL="mongodb+srv://usuario:password@host/expense-tracker"

# Sesiones — obligatorio, sin fallback. Generar con: openssl rand -base64 32
JWT_SECRET=""

# Bot de Telegram
TELEGRAM_BOT_TOKEN=""
# Secret del header X-Telegram-Bot-Api-Secret-Token. Generar con: openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET=""

# IA
XAI_API_KEY=""
XAI_MODEL="grok-4-fast"

# OCR — "wasm" en Vercel, "native" en el VPS. Se usa desde la Rebanada 4.
OCR_ENGINE="wasm"
```

Agregar `JWT_SECRET` al `.env` local con un valor real, o la app no arranca.

- [ ] **Step 6: Semilla de categorías**

Crear `scripts/seed-categories.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Supermercado",   icon: "shopping-cart", color: "#16a34a" },
  { name: "Comida y delivery", icon: "utensils",   color: "#f97316" },
  { name: "Transporte",     icon: "car",           color: "#0ea5e9" },
  { name: "Servicios",      icon: "zap",           color: "#eab308" },
  { name: "Alquiler",       icon: "home",          color: "#6366f1" },
  { name: "Salud",          icon: "heart",         color: "#ef4444" },
  { name: "Farmacia",       icon: "pill",          color: "#ec4899" },
  { name: "Ropa",           icon: "shirt",         color: "#8b5cf6" },
  { name: "Entretenimiento", icon: "film",         color: "#a855f7" },
  { name: "Hogar",          icon: "sofa",          color: "#14b8a6" },
  { name: "Mascotas",       icon: "paw-print",     color: "#84cc16" },
  { name: "Regalos",        icon: "gift",          color: "#f43f5e" },
  { name: "Otros",          icon: "tag",           color: "#64748b" },
];

async function main() {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }
  console.log(`${CATEGORIES.length} categorias sembradas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Correr: `npx ts-node scripts/seed-categories.ts` (o `node --experimental-strip-types scripts/seed-categories.ts`).

- [ ] **Step 7: Reescribir la documentación**

En `CLAUDE.md`: reemplazar la sección "Reglas de dominio — Gastos compartidos" completa. Las reglas nuevas son:

1. No existe balance ni deuda entre personas. `Expense.userId` es **quién pagó** y es informativo.
2. `Expense.createdById` es **quién lo registró**. Puede diferir del pagador.
3. `Expense.scope` es `"casa"` o `"personal"`. La lectura se resuelve **siempre** con `visibleExpensesWhere()` de `src/lib/visibility.ts`; nunca con `userId: session.id` a mano.
4. El permiso de edición vía bot es más amplio que la lectura y vive en `canEditViaBot()`. No unificarlos.
5. La ingesta principal es el bot de Telegram. La web es lectura y corrección.

Actualizar también la tabla de "Archivos críticos" (las rutas de balance, summary y shared ya no existen) y el listado de docs de referencia.

En `docs/data-models.md`: reescribir con los 8 modelos. En `docs/architecture.md`: documentar los seams `src/lib/ai/`, `src/lib/ocr/` y `src/lib/telegram/`. En `docs/features-backlog.md`: purgar lo que refiera a grupos, splits, sueldos y presupuestos.

- [ ] **Step 8: Verificar todo**

```bash
npx tsc --noEmit
npm run build
npm test
```

Expected: los tres verdes.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat!: schema de 8 modelos, demolicion de grupos/splits/presupuestos y JWT_SECRET obligatorio"
```

---

## Task 5: Aplicar visibilidad y scope en la API y en el listado

Ahora que `scope` y `createdById` existen, se cablea la regla de la Tarea 1 en todas las lecturas y se completa la escritura.

**Files:**
- Modify: `src/app/api/expenses/route.ts` (GET: `where`; POST: `createdById`, `scope`, `source`)
- Modify: `src/app/api/expenses/[id]/route.ts` (GET/PATCH/DELETE: comprobar visibilidad)
- Modify: `src/app/api/expenses/stats/route.ts` (`where`)
- Modify: `src/app/api/expenses/export/route.ts:17` (`where`)
- Modify: `src/app/(dashboard)/dashboard/expenses/page.tsx` (filtro de scope y columna de pagador)

**Interfaces:**
- Consumes: `visibleExpensesWhere(userId)` de la Tarea 1.
- Produces: `POST /api/expenses` acepta además `scope` (`"casa"` por defecto). El `GET /api/expenses` acepta `?scope=casa|personal` y devuelve `payer: { id, name }` en cada gasto.

- [ ] **Step 1: Aplicar la regla en el GET de `expenses/route.ts`**

Reemplazar la línea que arma el `where`:

```ts
const where: Record<string, unknown> = { userId: session.id };
```

por:

```ts
import { visibleExpensesWhere } from "@/lib/visibility";

const scopeFilter = url.searchParams.get("scope");
const where: Record<string, unknown> = { ...visibleExpensesWhere(session.id) };
if (scopeFilter === "casa" || scopeFilter === "personal") {
  where.AND = [{ scope: scopeFilter }];
}
```

`visibleExpensesWhere` ya ocupa la clave `OR`, así que el filtro explícito va en `AND` para no pisarla. El bloque de `month`/`year` que hoy asigna `where.OR` tiene que mudarse también a `where.AND`, porque si no se sobreescribe la regla de visibilidad. Ese es el bug a evitar en este paso: **`where.OR` ya está tomado**.

Agregar `payer: { select: { id: true, name: true } }` al `include` para poder mostrar quién pagó.

- [ ] **Step 2: Completar la escritura en el POST**

En el `data` del `create`, agregar:

```ts
        createdById: session.id,
        scope: body.scope === "personal" ? "personal" : "casa",
        source: "web",
```

`userId: session.id` se mantiene: en la web, quien carga es quien pagó.

- [ ] **Step 3: Aplicar la regla en las otras tres rutas**

En `stats/route.ts` y `export/route.ts:17`, reemplazar `userId: session.id` por el spread de `visibleExpensesWhere(session.id)`, cuidando el mismo choque de `OR` si la ruta ya lo usa.

En `expenses/[id]/route.ts`, el `GET`, `PATCH` y `DELETE` tienen que verificar que el gasto sea visible antes de operar:

```ts
const expense = await prisma.expense.findFirst({
  where: { id, ...visibleExpensesWhere(session.id) },
});
if (!expense) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
```

Devolver `404` y no `403`: no confirma la existencia de un gasto personal ajeno.

- [ ] **Step 4: Filtro de scope y pagador en el listado**

En `expenses/page.tsx`, agregar el estado del filtro y sumarlo a la URL que ya se arma para traer los gastos:

```tsx
type ScopeFilter = "todos" | "casa" | "personal";

const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("todos");
```

Donde se construyen los query params del fetch de gastos, agregar:

```tsx
if (scopeFilter !== "todos") params.set("scope", scopeFilter);
```

y agregar `scopeFilter` al array de dependencias del `useEffect` (o del `useCallback`) que dispara la carga, para que el listado se refresque al cambiarlo.

El selector, junto a los filtros que ya existen:

```tsx
<div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
  {(["todos", "casa", "personal"] as const).map((value) => (
    <button
      key={value}
      type="button"
      onClick={() => setScopeFilter(value)}
      className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
        scopeFilter === value
          ? "bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-400"
          : "text-gray-600 dark:text-gray-400"
      }`}
    >
      {value}
    </button>
  ))}
</div>
```

En la interfaz del gasto del front, agregar los campos que ahora devuelve la API:

```tsx
  scope: "casa" | "personal";
  payer: { id: string; name: string };
```

Y renderizar el pagador y el scope donde hoy iba el badge de compartido que se borró en la Tarea 3 — tanto en la fila de la tabla como en la tarjeta mobile:

```tsx
<span className="text-xs text-gray-500 dark:text-gray-400">
  {expense.scope === "casa" ? "Casa" : "Personal"} · {expense.payer.name}
</span>
```

En el formulario de alta, un toggle que se manda en el body del POST:

```tsx
const [scope, setScope] = useState<"casa" | "personal">("casa");
```

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={scope === "personal"}
    onChange={(e) => setScope(e.target.checked ? "personal" : "casa")}
  />
  Gasto personal (no lo ve la otra persona)
</label>
```

y agregar `scope` al objeto que se serializa en el `fetch` del POST.

- [ ] **Step 5: Verificar a mano**

```bash
npm run build
npm run dev
```

Con dos usuarios registrados, comprobar en el navegador:
1. Un gasto `casa` cargado por A aparece en el listado de B.
2. Un gasto `personal` cargado por A **no** aparece en el listado de B.
3. El filtro `Casa` / `Personal` / `Todos` devuelve lo esperado.
4. El filtro por mes sigue funcionando junto con el de scope (verifica que el `AND`/`OR` del Step 1 quedó bien).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/expenses 'src/app/(dashboard)/dashboard/expenses'
git commit -m "feat: aplica la regla de visibilidad y el scope casa/personal"
```

---

## Task 6: Cliente de Telegram y vinculación de cuenta

**Files:**
- Create: `src/lib/telegram/client.ts`
- Create: `src/app/api/telegram/link/route.ts`

**Interfaces:**
- Consumes: `requireEnv` de la Tarea 4.
- Produces:
  - `export type TelegramMessage = { message_id: number; chat: { id: number } }`
  - `export async function sendMessage(chatId: string | number, text: string, replyMarkup?: unknown): Promise<TelegramMessage>`
  - `POST /api/telegram/link` → `{ code: string }`

- [ ] **Step 1: Crear el cliente**

Crear `src/lib/telegram/client.ts`:

```ts
import { requireEnv } from "@/lib/env";

export type TelegramMessage = { message_id: number; chat: { id: number } };

function apiUrl(method: string) {
  return `https://api.telegram.org/bot${requireEnv("TELEGRAM_BOT_TOKEN")}/${method}`;
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: unknown
): Promise<TelegramMessage> {
  const res = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram sendMessage fallo: ${JSON.stringify(json)}`);
  }
  return json.result as TelegramMessage;
}
```

- [ ] **Step 2: Crear la ruta de vinculación**

Crear `src/app/api/telegram/link/route.ts`:

```ts
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const code = randomBytes(4).toString("hex");

  await prisma.user.update({
    where: { id: session.id },
    data: { telegramLinkCode: code },
  });

  return NextResponse.json({ code });
}
```

- [ ] **Step 3: Verificar**

```bash
npm run build
```

Con la app corriendo y sesión iniciada:

```bash
curl -X POST http://localhost:3000/api/telegram/link -b "token=<tu-jwt>"
```

Expected: `{"code":"a1b2c3d4"}`, y el campo `telegramLinkCode` grabado en el usuario.

El consumo del código (`/start <code>`) se implementa en la Tarea 9, dentro del webhook.

- [ ] **Step 4: Commit**

```bash
git add src/lib/telegram src/app/api/telegram
git commit -m "feat: cliente de Telegram y generacion del codigo de vinculacion"
```

---

## Task 7: Normalización de montos y fechas

Lógica pura, sin red ni base. Es la defensa contra el modo de falla más caro del sistema: un monto guardado con el orden de magnitud equivocado.

**Files:**
- Create: `src/lib/ai/normalize.ts`
- Create: `tests/normalize.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export function normalizeAmount(raw: string | number): number | null`
  - `export function resolveDate(iso: string, today: Date): Date | null`
  - `export function todayInBuenosAires(now: Date): string`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/normalize.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAmount, resolveDate, todayInBuenosAires } from "../src/lib/ai/normalize.ts";

test("normalizeAmount pasa numeros limpios", () => {
  assert.equal(normalizeAmount(12000), 12000);
  assert.equal(normalizeAmount("12000"), 12000);
});

test("normalizeAmount entiende lucas y palos", () => {
  assert.equal(normalizeAmount("12 lucas"), 12000);
  assert.equal(normalizeAmount("2 palos"), 2000000);
  assert.equal(normalizeAmount("1 luca"), 1000);
});

test("normalizeAmount trata el punto de miles como miles", () => {
  assert.equal(normalizeAmount("12.500"), 12500);
  assert.equal(normalizeAmount("1.250.300"), 1250300);
});

test("normalizeAmount trata la coma como decimal", () => {
  assert.equal(normalizeAmount("12500,50"), 12500.5);
});

test("normalizeAmount rechaza basura y no negativos", () => {
  assert.equal(normalizeAmount("panaderia"), null);
  assert.equal(normalizeAmount(""), null);
  assert.equal(normalizeAmount(-100), null);
  assert.equal(normalizeAmount(0), null);
});

test("resolveDate acepta una fecha de hoy", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  const result = resolveDate("2026-08-22", today);
  assert.ok(result instanceof Date);
  assert.equal(result?.toISOString().slice(0, 10), "2026-08-22");
});

test("resolveDate rechaza fechas futuras", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("2026-08-23", today), null);
});

test("resolveDate rechaza fechas de mas de 6 meses atras", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("2025-12-01", today), null);
});

test("resolveDate rechaza basura", () => {
  const today = new Date("2026-08-22T12:00:00Z");
  assert.equal(resolveDate("ayer", today), null);
  assert.equal(resolveDate("", today), null);
});

test("todayInBuenosAires usa la zona de Argentina y no UTC", () => {
  // 02:30 UTC del 22 son las 23:30 del 21 en Buenos Aires (UTC-3)
  assert.equal(todayInBuenosAires(new Date("2026-08-22T02:30:00Z")), "2026-08-21");
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/ai/normalize.ts'`

- [ ] **Step 3: Implementar**

Crear `src/lib/ai/normalize.ts`. Sin imports.

```ts
const MAX_MONTHS_BACK = 6;

/**
 * Convierte lo que devolvio el LLM a un monto en pesos.
 *
 * El caso peligroso es el separador: "12.500" son doce mil quinientos, no
 * doce con cincuenta. La regla es que el punto con tres digitos detras es
 * separador de miles, y la coma siempre es decimal.
 */
export function normalizeAmount(raw: string | number): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }

  const text = raw.trim().toLowerCase();
  if (!text) return null;

  const multiplier = /\b(lucas?|k)\b/.test(text)
    ? 1000
    : /\b(palos?|millon(es)?)\b/.test(text)
      ? 1_000_000
      : 1;

  let numeric = text.replace(/[^\d.,]/g, "");
  if (!numeric) return null;

  // La coma es siempre decimal; el punto es miles cuando lo siguen 3 digitos.
  if (numeric.includes(",")) {
    numeric = numeric.replace(/\./g, "").replace(",", ".");
  } else {
    numeric = numeric.replace(/\.(?=\d{3}(\D|$))/g, "");
  }

  const value = Number(numeric) * multiplier;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Valida la fecha ISO que devolvio el LLM. No interpreta lenguaje natural:
 * eso se resuelve pasandole `today` en el prompt y pidiendole ISO de vuelta.
 */
export function resolveDate(iso: string, today: Date): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;

  const parsed = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const todayEnd = new Date(today);
  todayEnd.setUTCHours(23, 59, 59, 999);
  if (parsed > todayEnd) return null;

  const floor = new Date(today);
  floor.setUTCMonth(floor.getUTCMonth() - MAX_MONTHS_BACK);
  if (parsed < floor) return null;

  return parsed;
}

/** La fecha de hoy en la zona de negocio, como "YYYY-MM-DD". */
export function todayInBuenosAires(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — los 10 tests nuevos más los 6 de la Tarea 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/normalize.ts tests/normalize.test.ts
git commit -m "feat: normalizacion de montos en jerga y validacion de fechas"
```

---

## Task 8: AiProvider y parseMessage

**Files:**
- Create: `src/lib/ai/types.ts`
- Create: `src/lib/ai/provider.ts`
- Create: `src/lib/ai/grok.ts`
- Create: `src/lib/ai/parse.ts`
- Create: `tests/parse.test.ts`

**Interfaces:**
- Consumes: `normalizeAmount`, `resolveDate` de la Tarea 7.
- Produces:
  - `export type ParseContext = { categories: string[]; members: { id: string; name: string }[]; senderId: string; today: string; aliases: { pattern: string; categoryName: string; description: string | null; scope: string | null }[] }`
  - `export type ParseResult = { intent: "gasto"; amount: number; description: string; date: Date; categoryName: string; scope: "casa" | "personal"; payerName: string | null; installments: number | null; cardName: string | null } | { intent: "desconocido"; reason: string }`
  - `export interface AiProvider { complete(system: string, user: string): Promise<string> }`
  - `export async function parseMessage(text: string, ctx: ParseContext, provider: AiProvider): Promise<ParseResult>`
  - `export function getAiProvider(): AiProvider`

- [ ] **Step 1: Definir los tipos**

Crear `src/lib/ai/types.ts`:

```ts
import type { ExpenseScope } from "../visibility.ts";

export type { ExpenseScope };

export type ParseContext = {
  categories: string[];
  members: { id: string; name: string }[];
  senderId: string;
  /** "YYYY-MM-DD" en America/Argentina/Buenos_Aires */
  today: string;
  aliases: {
    pattern: string;
    categoryName: string;
    description: string | null;
    scope: string | null;
  }[];
};

export type GastoResult = {
  intent: "gasto";
  amount: number;
  description: string;
  date: Date;
  categoryName: string;
  scope: ExpenseScope;
  payerName: string | null;
  installments: number | null;
  cardName: string | null;
};

export type DesconocidoResult = {
  intent: "desconocido";
  reason: string;
};

export type ParseResult = GastoResult | DesconocidoResult;
```

- [ ] **Step 2: Escribir los tests que fallan**

Los tests usan un `AiProvider` falso que devuelve un JSON fijo. No pegan contra la red.

Crear `tests/parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage } from "../src/lib/ai/parse.ts";
import type { ParseContext } from "../src/lib/ai/types.ts";

const CTX: ParseContext = {
  categories: ["Supermercado", "Comida y delivery", "Ropa", "Otros"],
  members: [
    { id: "joel-id", name: "Joel" },
    { id: "ella-id", name: "Ana" },
  ],
  senderId: "joel-id",
  today: "2026-08-22",
  aliases: [],
};

function fakeProvider(response: string) {
  return { complete: async () => response };
}

test("parsea un gasto simple", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: "12 lucas",
      description: "Panaderia",
      date: "2026-08-22",
      categoryName: "Comida y delivery",
      scope: "casa",
      payerName: null,
      installments: null,
      cardName: null,
    })
  );

  const result = await parseMessage("12 lucas panaderia", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.amount, 12000);
  assert.equal(result.categoryName, "Comida y delivery");
  assert.equal(result.scope, "casa");
});

test("cae a desconocido si el JSON es invalido", async () => {
  const result = await parseMessage("hola", CTX, fakeProvider("no soy json"));
  assert.equal(result.intent, "desconocido");
});

test("cae a desconocido si el monto no se puede normalizar", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: "un rato",
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  const result = await parseMessage("gaste un rato", CTX, provider);
  assert.equal(result.intent, "desconocido");
});

test("cae a desconocido si la fecha es futura", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-09-01",
      categoryName: "Otros",
      scope: "casa",
    })
  );
  const result = await parseMessage("gaste 5000 manana", CTX, provider);
  assert.equal(result.intent, "desconocido");
});

test("fuerza a Otros una categoria que no existe", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Criptomonedas",
      scope: "casa",
    })
  );
  const result = await parseMessage("5000 en cripto", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.categoryName, "Otros");
});

test("un scope invalido cae a casa", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 5000,
      description: "algo",
      date: "2026-08-22",
      categoryName: "Otros",
      scope: "ambos",
    })
  );
  const result = await parseMessage("5000", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.scope, "casa");
});

test("extrae el pagador cuando lo nombra", async () => {
  const provider = fakeProvider(
    JSON.stringify({
      intent: "gasto",
      amount: 80000,
      description: "Zapatillas",
      date: "2026-08-22",
      categoryName: "Ropa",
      scope: "personal",
      payerName: "Joel",
    })
  );
  const result = await parseMessage("Joel compro zapatillas 80 lucas", CTX, provider);
  assert.equal(result.intent, "gasto");
  if (result.intent !== "gasto") return;
  assert.equal(result.payerName, "Joel");
  assert.equal(result.scope, "personal");
});
```

- [ ] **Step 3: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/ai/parse.ts'`

- [ ] **Step 4: Implementar el parser**

Crear `src/lib/ai/parse.ts`. Sin imports con alias y sin Prisma: recibe todo por parámetro.

```ts
import { normalizeAmount, resolveDate } from "./normalize.ts";
import type { ParseContext, ParseResult } from "./types.ts";

export interface AiProvider {
  complete(system: string, user: string): Promise<string>;
}

const FALLBACK_CATEGORY = "Otros";

function buildSystemPrompt(ctx: ParseContext): string {
  const aliasLines = ctx.aliases.length
    ? ctx.aliases
        .map(
          (a) =>
            `- "${a.pattern}" => categoria "${a.categoryName}"` +
            (a.description ? `, descripcion "${a.description}"` : "") +
            (a.scope ? `, scope "${a.scope}"` : "")
        )
        .join("\n")
    : "(todavia no hay ninguno)";

  return `Sos un asistente que registra gastos de una pareja en Argentina.
Devolves UNICAMENTE un objeto JSON, sin markdown y sin texto alrededor.

Hoy es ${ctx.today} (zona America/Argentina/Buenos_Aires).

Integrantes: ${ctx.members.map((m) => m.name).join(", ")}.
Categorias disponibles (elegi exactamente una de esta lista):
${ctx.categories.map((c) => `- ${c}`).join("\n")}

Equivalencias ya conocidas:
${aliasLines}

Formato de respuesta para un gasto:
{
  "intent": "gasto",
  "amount": <numero o el texto tal cual aparece, ej "12 lucas">,
  "description": "<comercio o concepto, corto>",
  "date": "<YYYY-MM-DD>",
  "categoryName": "<una de la lista>",
  "scope": "casa" | "personal",
  "payerName": "<nombre del integrante que pago, o null si es quien escribe>",
  "installments": <cantidad de cuotas o null>,
  "cardName": "<nombre de la tarjeta o null>"
}

Si el mensaje no describe un gasto:
{ "intent": "desconocido", "reason": "<motivo breve>" }

Reglas:
- "scope" es "casa" si el gasto es del hogar y lo aprovechan los dos
  (supermercado, servicios, alquiler, delivery compartido). Es "personal" si
  es de una sola persona (ropa, un hobby, algo propio).
- Nunca inventes una categoria que no este en la lista.
- Para la fecha, resolve expresiones como "ayer" o "el viernes" contra la
  fecha de hoy y devolve SIEMPRE el formato YYYY-MM-DD.
- Nunca devuelvas una fecha futura.`;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function parseMessage(
  text: string,
  ctx: ParseContext,
  provider: AiProvider
): Promise<ParseResult> {
  let raw: string;
  try {
    raw = await provider.complete(buildSystemPrompt(ctx), text);
  } catch (error) {
    return { intent: "desconocido", reason: `El proveedor de IA fallo: ${error}` };
  }

  const parsed = extractJson(raw) as Record<string, unknown> | null;
  if (!parsed) {
    return { intent: "desconocido", reason: "La IA no devolvio JSON valido" };
  }

  if (parsed.intent !== "gasto") {
    const reason = typeof parsed.reason === "string" ? parsed.reason : "No parece un gasto";
    return { intent: "desconocido", reason };
  }

  const amount = normalizeAmount(parsed.amount as string | number);
  if (amount === null) {
    return { intent: "desconocido", reason: "No pude entender el monto" };
  }

  const today = new Date(`${ctx.today}T12:00:00.000Z`);
  const date = resolveDate(String(parsed.date ?? ""), today);
  if (date === null) {
    return { intent: "desconocido", reason: "No pude entender la fecha" };
  }

  const description =
    typeof parsed.description === "string" && parsed.description.trim()
      ? parsed.description.trim()
      : "Sin descripcion";

  const categoryName = ctx.categories.includes(parsed.categoryName as string)
    ? (parsed.categoryName as string)
    : FALLBACK_CATEGORY;

  const scope = parsed.scope === "personal" ? "personal" : "casa";

  const payerName =
    typeof parsed.payerName === "string" &&
    ctx.members.some((m) => m.name.toLowerCase() === parsed.payerName!.toString().toLowerCase())
      ? (parsed.payerName as string)
      : null;

  const rawInstallments = Number(parsed.installments);
  const installments =
    Number.isInteger(rawInstallments) && rawInstallments > 1 ? rawInstallments : null;

  const cardName = typeof parsed.cardName === "string" && parsed.cardName.trim()
    ? parsed.cardName.trim()
    : null;

  return {
    intent: "gasto",
    amount,
    description,
    date,
    categoryName,
    scope,
    payerName,
    installments,
    cardName,
  };
}
```

Cada validación es deliberada: una categoría inventada cae a `Otros` en vez de romper, un scope raro cae a `casa`, y un pagador que no es integrante se ignora. El sistema nunca se cuelga por una respuesta rara del LLM, pero tampoco escribe datos inventados.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — los 7 tests nuevos y los 16 anteriores.

- [ ] **Step 6: Implementar el provider de Grok**

Crear `src/lib/ai/grok.ts`:

```ts
import { requireEnv } from "@/lib/env";
import type { AiProvider } from "./parse";

export function createGrokProvider(): AiProvider {
  return {
    async complete(system: string, user: string): Promise<string> {
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireEnv("XAI_API_KEY")}`,
        },
        body: JSON.stringify({
          model: process.env.XAI_MODEL || "grok-4-fast",
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`xAI respondio ${res.status}: ${await res.text()}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error(`Respuesta inesperada de xAI: ${JSON.stringify(json)}`);
      }
      return content;
    },
  };
}
```

Crear `src/lib/ai/provider.ts`:

```ts
import type { AiProvider } from "./parse";
import { createGrokProvider } from "./grok";

export type { AiProvider };

export function getAiProvider(): AiProvider {
  return createGrokProvider();
}
```

**Antes de este paso, verificar el free tier de xAI y el nombre del modelo vigente.** Si `XAI_MODEL` no existe, la llamada devuelve 404 y `parseMessage` cae a `desconocido` con el motivo en el mensaje del bot — falla visible, no silenciosa. Si el free tier no alcanza, esta es la única capa a cambiar.

- [ ] **Step 7: Verificar el provider contra la API real**

```bash
node --experimental-strip-types -e "
  process.env.XAI_API_KEY = process.env.XAI_API_KEY;
  const { createGrokProvider } = await import('./src/lib/ai/grok.ts');
  const p = createGrokProvider();
  console.log(await p.complete('Responde solo con JSON.', 'Devolve {\"ok\":true}'));
"
```

Expected: un JSON con `ok: true`. Si falla, el mensaje de error dice si es de credenciales, de modelo o de cuota.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai tests/parse.test.ts
git commit -m "feat: parseMessage con validacion en codigo y provider de Grok"
```

---

## Task 9: Webhook con secret, whitelist e idempotencia

El webhook sin la parte de IA todavía: valida, descarta reintentos, resuelve el usuario, atiende `/start` y responde algo. Así se puede verificar la plomería antes de sumarle el parser.

**Files:**
- Create: `src/lib/telegram/intake.ts`
- Create: `src/lib/idempotency.ts`
- Create: `src/app/api/telegram/webhook/route.ts`
- Create: `tests/intake.test.ts`

**Interfaces:**
- Consumes: `sendMessage` de la Tarea 6.
- Produces:
  - `export type Intake = { updateId: string; chatId: string; text: string | null; photoFileId: string | null; replyToMessageId: string | null; callbackData: string | null }`
  - `export function toIntake(update: unknown): Intake | null`
  - `export async function claimUpdate(client: { processedUpdate: { create(args: unknown): Promise<unknown> } }, updateId: string): Promise<boolean>`

- [ ] **Step 1: Escribir el test de `toIntake` que falla**

Crear `tests/intake.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toIntake } from "../src/lib/telegram/intake.ts";

test("normaliza un mensaje de texto", () => {
  const intake = toIntake({
    update_id: 100,
    message: { message_id: 5, chat: { id: 4242 }, text: "12 lucas panaderia" },
  });
  assert.deepEqual(intake, {
    updateId: "100",
    chatId: "4242",
    text: "12 lucas panaderia",
    photoFileId: null,
    replyToMessageId: null,
    callbackData: null,
  });
});

test("toma la foto de mayor resolucion", () => {
  const intake = toIntake({
    update_id: 101,
    message: {
      message_id: 6,
      chat: { id: 4242 },
      photo: [
        { file_id: "chica", file_size: 100 },
        { file_id: "grande", file_size: 900 },
      ],
    },
  });
  assert.equal(intake?.photoFileId, "grande");
});

test("registra el mensaje al que responde", () => {
  const intake = toIntake({
    update_id: 102,
    message: {
      message_id: 7,
      chat: { id: 4242 },
      text: "eso fue personal",
      reply_to_message: { message_id: 5 },
    },
  });
  assert.equal(intake?.replyToMessageId, "5");
});

test("normaliza un callback de boton", () => {
  const intake = toIntake({
    update_id: 103,
    callback_query: {
      data: "scope:abc123",
      message: { message_id: 5, chat: { id: 4242 } },
    },
  });
  assert.equal(intake?.callbackData, "scope:abc123");
  assert.equal(intake?.chatId, "4242");
});

test("devuelve null para un update sin chat", () => {
  assert.equal(toIntake({ update_id: 104 }), null);
  assert.equal(toIntake(null), null);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/telegram/intake.ts'`

- [ ] **Step 3: Implementar `toIntake`**

Crear `src/lib/telegram/intake.ts`. Sin imports.

```ts
export type Intake = {
  updateId: string;
  chatId: string;
  text: string | null;
  photoFileId: string | null;
  replyToMessageId: string | null;
  callbackData: string | null;
};

type Photo = { file_id?: unknown; file_size?: unknown };

function biggestPhoto(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const sorted = [...(photos as Photo[])].sort(
    (a, b) => Number(b.file_size ?? 0) - Number(a.file_size ?? 0)
  );
  const fileId = sorted[0]?.file_id;
  return typeof fileId === "string" ? fileId : null;
}

export function toIntake(update: unknown): Intake | null {
  if (!update || typeof update !== "object") return null;
  const u = update as Record<string, any>;
  if (u.update_id === undefined || u.update_id === null) return null;

  const source = u.callback_query?.message ?? u.message;
  const chatId = source?.chat?.id;
  if (chatId === undefined || chatId === null) return null;

  return {
    updateId: String(u.update_id),
    chatId: String(chatId),
    text: typeof u.message?.text === "string" ? u.message.text : null,
    photoFileId: biggestPhoto(u.message?.photo),
    replyToMessageId:
      u.message?.reply_to_message?.message_id !== undefined
        ? String(u.message.reply_to_message.message_id)
        : null,
    callbackData:
      typeof u.callback_query?.data === "string" ? u.callback_query.data : null,
  };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — 5 tests nuevos.

- [ ] **Step 5: Implementar la idempotencia**

Crear `src/lib/idempotency.ts`:

```ts
type ProcessedUpdateClient = {
  processedUpdate: { create(args: { data: { updateId: string } }): Promise<unknown> };
};

/**
 * Reclama un update_id de Telegram. Devuelve true si es la primera vez.
 *
 * Telegram reintenta el update si el webhook tarda en responder, y el OCR mas
 * la llamada a la IA pueden pasar los 15s. Sin esto, un reintento carga el
 * gasto dos veces. La exclusion la garantiza el indice unico de updateId, no
 * una lectura previa: dos reintentos concurrentes pasarian un findFirst.
 */
export async function claimUpdate(
  client: ProcessedUpdateClient,
  updateId: string
): Promise<boolean> {
  try {
    await client.processedUpdate.create({ data: { updateId } });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 6: Implementar el webhook**

Crear `src/app/api/telegram/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { toIntake } from "@/lib/telegram/intake";
import { claimUpdate } from "@/lib/idempotency";
import { sendMessage } from "@/lib/telegram/client";

/** Telegram reintenta ante cualquier respuesta que no sea 200. Siempre 200. */
const OK = () => NextResponse.json({ ok: true });

export async function POST(req: Request) {
  if (
    req.headers.get("x-telegram-bot-api-secret-token") !==
    requireEnv("TELEGRAM_WEBHOOK_SECRET")
  ) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let intake;
  try {
    intake = toIntake(await req.json());
  } catch {
    return OK();
  }
  if (!intake) return OK();

  if (!(await claimUpdate(prisma, intake.updateId))) return OK();

  try {
    // /start <codigo>: vincula el chat con el usuario
    const startMatch = intake.text?.match(/^\/start\s+([a-f0-9]{8})$/i);
    if (startMatch) {
      const user = await prisma.user.findFirst({
        where: { telegramLinkCode: startMatch[1].toLowerCase() },
      });
      if (!user) {
        await sendMessage(intake.chatId, "Ese codigo no es valido o ya se uso.");
        return OK();
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: intake.chatId, telegramLinkCode: null },
      });
      await sendMessage(intake.chatId, `Listo ${user.name}, ya podes mandarme gastos.`);
      return OK();
    }

    // Whitelist: solo los chats vinculados. El resto se ignora en silencio.
    const user = await prisma.user.findFirst({
      where: { telegramChatId: intake.chatId },
    });
    if (!user) return OK();

    await sendMessage(intake.chatId, "Te escucho. (el parser llega en la tarea 10)");
    return OK();
  } catch (error) {
    console.error("Error procesando update de Telegram", error);
    return OK();
  }
}
```

Tres cosas deliberadas: el `401` por secret inválido es el **único** caso que no devuelve 200 (ese request no viene de Telegram); el `catch` general responde 200 para que un error interno no genere un reintento que duplique trabajo; y la whitelist no responde nada a un desconocido.

- [ ] **Step 7: Verificar la plomería de punta a punta**

Exponer el dev server y registrar el webhook:

```bash
npm run dev
# en otra terminal, con un tunel (ngrok, cloudflared, o el deploy de Vercel):
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://<tu-host>/api/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
```

Comprobar en Telegram:
1. `/start <codigo>` con el código de la Tarea 6 → responde "Listo <nombre>".
2. Cualquier mensaje después → responde "Te escucho".
3. Un mensaje desde otra cuenta de Telegram → sin respuesta.
4. Reenviar el mismo update a mano dos veces con `curl` y el mismo `update_id` → sólo la primera responde.

- [ ] **Step 8: Commit**

```bash
git add src/lib/telegram/intake.ts src/lib/idempotency.ts src/app/api/telegram/webhook tests/intake.test.ts
git commit -m "feat: webhook de Telegram con secret, whitelist e idempotencia"
```

---

## Task 10: Cablear el gasto de punta a punta

La tarea que cierra la rebanada: el webhook usa el parser, crea el `Expense` y confirma.

**Files:**
- Create: `src/lib/expenses/create-from-bot.ts`
- Modify: `src/app/api/telegram/webhook/route.ts` (reemplazar el "Te escucho")
- Create: `tests/create-from-bot.test.ts`

**Interfaces:**
- Consumes: `parseMessage`, `getAiProvider` (Tarea 8); `todayInBuenosAires` (Tarea 7); `sendMessage` (Tarea 6).
- Produces: `export function buildConfirmation(e: { amount: number; description: string; categoryName: string; scope: string; payerName: string; date: Date; anomalous: boolean }): string`

- [ ] **Step 1: Escribir el test del mensaje de confirmación**

Crear `tests/create-from-bot.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfirmation } from "../src/lib/expenses/create-from-bot.ts";

const BASE = {
  amount: 12000,
  description: "Panaderia",
  categoryName: "Comida y delivery",
  scope: "casa",
  payerName: "Joel",
  date: new Date("2026-08-22T12:00:00Z"),
  anomalous: false,
};

test("la confirmacion incluye monto, descripcion, categoria y scope", () => {
  const text = buildConfirmation(BASE);
  assert.match(text, /12\.000/);
  assert.match(text, /Panaderia/);
  assert.match(text, /Comida y delivery/);
  assert.match(text, /casa/i);
});

test("la confirmacion nombra al pagador", () => {
  assert.match(buildConfirmation(BASE), /Joel/);
});

test("un monto anomalo se marca con advertencia", () => {
  const text = buildConfirmation({ ...BASE, anomalous: true });
  assert.match(text, /revisa|verifica|⚠/i);
});

test("un monto normal no lleva advertencia", () => {
  assert.doesNotMatch(buildConfirmation(BASE), /⚠/);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/lib/expenses/create-from-bot.ts'`

- [ ] **Step 3: Implementar el mensaje y la creación**

Crear `src/lib/expenses/create-from-bot.ts`:

```ts
const ANOMALY_FACTOR = 10;

export function formatArs(amount: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function buildConfirmation(e: {
  amount: number;
  description: string;
  categoryName: string;
  scope: string;
  payerName: string;
  date: Date;
  anomalous: boolean;
}): string {
  const fecha = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(e.date);

  const lines = [
    `✓ <b>${formatArs(e.amount)}</b> · ${e.description}`,
    `${e.categoryName} · ${e.scope} · pago ${e.payerName} · ${fecha}`,
  ];

  if (e.anomalous) {
    lines.push("⚠ El monto es muy alto para esta categoria, revisa que este bien.");
  }

  return lines.join("\n");
}

/**
 * Un monto es anomalo si supera por mucho el promedio historico de su
 * categoria. Se guarda igual: la senal reemplaza a un tap de confirmacion.
 */
export function isAnomalous(amount: number, categoryAverage: number | null): boolean {
  if (categoryAverage === null || categoryAverage <= 0) return false;
  return amount > categoryAverage * ANOMALY_FACTOR;
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm test`
Expected: PASS — 4 tests nuevos.

- [ ] **Step 5: Cablear el webhook**

En `src/app/api/telegram/webhook/route.ts`, reemplazar la línea del `sendMessage("Te escucho...")` por el flujo completo:

```ts
    if (!intake.text) {
      await sendMessage(intake.chatId, "Por ahora solo entiendo texto. Las fotos llegan pronto.");
      return OK();
    }

    const [categories, members] = await Promise.all([
      prisma.category.findMany({ select: { id: true, name: true } }),
      prisma.user.findMany({ select: { id: true, name: true } }),
    ]);

    const parsed = await parseMessage(
      intake.text,
      {
        categories: categories.map((c) => c.name),
        members,
        senderId: user.id,
        today: todayInBuenosAires(new Date()),
        aliases: [],
      },
      getAiProvider()
    );

    if (parsed.intent !== "gasto") {
      await sendMessage(intake.chatId, `No lo pude registrar: ${parsed.reason}`);
      return OK();
    }

    const category = categories.find((c) => c.name === parsed.categoryName)!;
    const payer =
      (parsed.payerName &&
        members.find((m) => m.name.toLowerCase() === parsed.payerName!.toLowerCase())) ||
      user;

    const average = await prisma.expense.aggregate({
      where: { categoryId: category.id },
      _avg: { amount: true },
    });

    const expense = await prisma.expense.create({
      data: {
        amount: parsed.amount,
        description: parsed.description,
        date: parsed.date,
        categoryId: category.id,
        userId: payer.id,
        createdById: user.id,
        scope: parsed.scope,
        source: "bot",
        totalInstallments: parsed.installments,
        installments: parsed.installments
          ? {
              create: Array.from({ length: parsed.installments }, (_, i) => {
                const due = new Date(parsed.date);
                due.setMonth(due.getMonth() + i);
                return {
                  installmentNumber: i + 1,
                  dueDate: due,
                  amount: parsed.amount / parsed.installments!,
                };
              }),
            }
          : undefined,
      },
    });

    const sent = await sendMessage(
      intake.chatId,
      buildConfirmation({
        amount: parsed.amount,
        description: parsed.description,
        categoryName: parsed.categoryName,
        scope: parsed.scope,
        payerName: payer.name,
        date: parsed.date,
        anomalous: isAnomalous(parsed.amount, average._avg.amount),
      })
    );

    await prisma.expense.update({
      where: { id: expense.id },
      data: { botChatId: intake.chatId, botMessageId: String(sent.message_id) },
    });

    return OK();
```

Agregar los imports:

```ts
import { parseMessage } from "@/lib/ai/parse";
import { getAiProvider } from "@/lib/ai/provider";
import { todayInBuenosAires } from "@/lib/ai/normalize";
import { buildConfirmation, isAnomalous } from "@/lib/expenses/create-from-bot";
```

`botMessageId` se graba en un `update` posterior porque el `message_id` sólo existe después de mandar el mensaje. Los botones inline no se agregan acá: son Rebanada 2.

Las filas de `Installment` se crean igual que en el POST de la web, y no es opcional: el `GET /api/expenses` filtra los gastos con `totalInstallments > 1` por `installments: { some: { dueDate: ... } }`. Un gasto en cuotas sin sus filas de `Installment` **desaparecería del filtro por mes** — un gasto invisible, que es justo el fallo que erosiona la confianza en el sistema.

- [ ] **Step 6: Verificación de punta a punta**

```bash
npm test
npm run build
npm run dev
```

Con el webhook registrado, en Telegram:

1. Mandar `12 lucas panaderia` → llega la confirmación con `$12.000`, categoría y scope.
2. Abrir `/dashboard/expenses` con la sesión de ese usuario → el gasto está en la lista, con el pagador.
3. Mandar `Ana compro zapatillas 80 lucas` desde el chat de Joel → el gasto queda con `userId` = Ana y `createdById` = Joel. Si salió `personal`, **no** aparece en el listado de Joel, y sí en el de Ana.
4. Mandar `hola que tal` → responde que no lo pudo registrar, y no crea nada. Verificar con `prisma.expense.count()` antes y después.
5. Mandar `gaste 500000 en pan` (con historial en esa categoría) → la confirmación trae la advertencia de monto anómalo, y el gasto se guarda igual.
6. Mandar `heladera 600 lucas en 12 cuotas con la visa` → el gasto queda con `totalInstallments: 12` y **12 filas** en `Installment`, y aparece en el filtro del mes actual. Si aparece con `totalInstallments: 12` pero sin filas, el listado lo va a esconder.

- [ ] **Step 7: Commit**

```bash
git add src/lib/expenses src/app/api/telegram/webhook tests/create-from-bot.test.ts
git commit -m "feat: registra gastos de texto desde Telegram de punta a punta"
```

---

## Verificación final de la rebanada

- [ ] `npm test` verde (26 tests: 6 visibilidad, 10 normalize, 7 parse, 5 intake, 4 confirmación — los conteos por archivo pueden variar si se agregan casos).
- [ ] `npm run build` sin errores.
- [ ] `npx tsc --noEmit` sin errores.
- [ ] `grep -rn 'expenseShare\|recurringShare\|periodShare\|monthlyIncome\|prisma.budget\|prisma.group' src/` sin resultados.
- [x] Ese chequeo ya no es un grep a mano: lo hace `tests/read-paths.test.ts`, que
  corre en `npm test` y falla si una lectura de Expense/RecurringExpense filtra
  por `userId: session.id` fuera de la allowlist documentada.
- [ ] Mandar `12 lucas panaderia` al bot y ver el gasto en `/dashboard/expenses`.
- [ ] Un gasto `personal` de una persona no aparece en el listado de la otra.
- [ ] `CLAUDE.md` no menciona grupos, splits, sueldos ni balance.
