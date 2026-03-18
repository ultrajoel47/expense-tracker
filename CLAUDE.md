# CLAUDE.md — Contexto para IA

Este archivo provee contexto esencial para sesiones de IA en este proyecto.

## Stack

- **Next.js** (App Router) + **React** — frontend y API routes
- **MongoDB** + **Prisma ORM** — base de datos (sin migrations, usar `prisma db push`)
- **JWT custom** — autenticación via cookie httpOnly (`src/lib/auth.ts`)
- **Tailwind CSS** — estilos

## Convenciones de código

### API Routes
- Siempre validar sesión al inicio: `const session = await getSession(); if (!session) return 401`
- Errores en español, en formato `{ error: "mensaje" }`
- Usar el singleton de Prisma: `import { prisma } from "@/lib/prisma"`

### Autenticación
- `getSession()` decodifica el JWT de la cookie y retorna `{ id, email, name }` o `null`
- No hay middleware de auth — cada route handler lo valida manualmente

### Prisma / MongoDB
- Provider: MongoDB. No usar `prisma migrate` — usar `prisma db push`
- Los IDs son ObjectId (`@db.ObjectId`)

## Reglas de dominio — Gastos compartidos

1. **El pagador paga el 100%** del gasto. Los `ExpenseShare` / `RecurringShare` representan la deuda de los **otros** participantes, no del pagador.
2. **No existe liquidación**: no hay campo `settled` ni concepto de marcar gastos como pagados. El balance es acumulativo e informativo.
3. **Split modes**: `auto` (proporcional a `MonthlyIncome`) o `manual` (porcentajes explícitos). Si se asigna a un grupo sin shares explícitos, se usan los porcentajes de `GroupMember`.
4. **Balance neto**: se calcula con un ledger de deudas entre pares, neteando montos mutuos. Refleja todas las transacciones históricas.
5. **variabilidad del balance**: cuando cualquier integrante paga algo (gasto o recurrente a su nombre), el balance se actualiza automáticamente — no hay intervención manual.

## Docs de referencia

- [docs/architecture.md](docs/architecture.md) — Stack, estructura de carpetas, patrones
- [docs/shared-expenses.md](docs/shared-expenses.md) — Lógica de gastos compartidos y splits
- [docs/balance-calculation.md](docs/balance-calculation.md) — Algoritmo de cálculo de balance
- [docs/groups.md](docs/groups.md) — Grupos y miembros
- [docs/data-models.md](docs/data-models.md) — Modelos Prisma clave

## Archivos críticos

| Propósito | Archivo |
|-----------|---------|
| Schema DB | `prisma/schema.prisma` |
| Balance API | `src/app/api/groups/[id]/balance/route.ts` |
| Summary API | `src/app/api/groups/[id]/summary/route.ts` |
| Shared API | `src/app/api/shared/route.ts` |
| Creación de gastos (con shares) | `src/app/api/expenses/route.ts` |
| Creación de recurrentes (con shares) | `src/app/api/recurring-expenses/route.ts` |
| Página Compartidos | `src/app/(dashboard)/dashboard/shared/page.tsx` |
| Página Detalle Grupo | `src/app/(dashboard)/dashboard/groups/[id]/page.tsx` |
