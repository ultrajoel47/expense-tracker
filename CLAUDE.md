# CLAUDE.md — Contexto para IA

Este archivo provee contexto esencial para sesiones de IA en este proyecto.

## Qué es esto

Un tracker de gastos de un hogar de **dos personas**. La ingesta principal es un
**bot de Telegram**: se le manda "12 lucas panadería" y el gasto queda cargado.
La web es donde se **consulta y corrige**, no donde se carga.

No es una app multiusuario. No hay grupos, ni splits, ni presupuestos, ni
registro de sueldos, ni deudas entre personas. Si encontrás código o docs que
hablen de eso, es residuo: reportalo.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** — frontend y API routes
- **MongoDB** + **Prisma ORM** — base de datos (sin migrations, usar `prisma db push`)
- **JWT custom** — autenticación via cookie httpOnly (`src/lib/auth.ts`)
- **Tailwind CSS** — estilos
- **Recharts** — gráficos del dashboard
- **Telegram Bot API** — canal de ingesta
- **Groq o Grok (xAI)** — parseo de los mensajes, detrás de la interfaz `AiProvider`; se elige con `AI_PROVIDER` (default `groq`)
- **Tesseract** — OCR de comprobantes, detrás de la interfaz `OcrEngine`

## Convenciones de código

### API Routes
- Siempre validar sesión al inicio: `const session = await getSession(); if (!session) return 401`
- Errores en español, en formato `{ error: "mensaje" }`
- Usar el singleton de Prisma: `import { prisma } from "@/lib/prisma"`

### Autenticación
- `getSession()` decodifica el JWT de la cookie y retorna `{ id, email, name }` o `null`
- No hay middleware de auth — cada route handler lo valida manualmente
- `JWT_SECRET` es **obligatorio y sin fallback** (`requireEnv` de `src/lib/env.ts`).
  La app no arranca si falta. Un secret conocido en un dominio público permite
  forjar sesiones de cualquiera de los dos usuarios.

### Variables de entorno
- Toda variable obligatoria se lee con `requireEnv(name)` de `src/lib/env.ts`,
  nunca con `process.env.X || "default"`.
- La plantilla de todas las variables está en `.env.example`.

### Prisma / MongoDB
- Provider: MongoDB. No usar `prisma migrate` — usar `npx prisma db push`
- Los IDs son ObjectId (`@db.ObjectId`)
- El CLI de Prisma **no** carga el `.env` porque existe `prisma.config.ts`. Hay que
  pasarle `DATABASE_URL` en el entorno del comando.
- Hay índices que Prisma no puede expresar y se crean a mano. Ver
  [docs/data-models.md](docs/data-models.md#pasos-manuales-en-mongo).
- **`User_telegramChatId_key` y `User_telegramLinkCode_key` tienen que existir
  como `unique + sparse`.** En MongoDB un campo ausente se indexa como `null`, así
  que en un índice único plano el **segundo** usuario sin vincular colisiona con el
  primero y rompe el `db push` o el registro. `@unique` se queda en el schema: sin
  declararlo, `db push` borraría el índice hecho a mano. Comando exacto y detalle
  en [docs/data-models.md](docs/data-models.md#pasos-manuales-en-mongo).
- **En un campo `@unique`, nunca escribir `null` — usar `{ unset: true }`.** Un
  índice sparse ignora un campo ausente pero SÍ indexa un `null` explícito, así que
  dos `null` colisionan igual. Detalle en
  [docs/data-models.md](docs/data-models.md#peligro-nombrado-nunca-escribir-null-en-un-campo-unique-ni-con-índice-sparse).

### Scripts
- Viven en `scripts/`, que está en el `exclude` del `tsconfig.json`: no se
  type-checkean.
- Se corren con `node --env-file=.env scripts/<script>.ts`.

## Reglas de dominio

1. **No existe balance ni deuda entre personas.** Comparten la plata.
   `Expense.userId` es **quién pagó** y es informativo: no se calcula ninguna
   deuda a partir de él.
2. **`Expense.createdById` es quién lo registró.** Puede diferir del pagador
   (una persona carga un gasto que pagó la otra). No es redundante con `userId`:
   es lo que permite resolver "mi último gasto" para corregirlo.
3. **`Expense.scope` es `"casa"` o `"personal"`.** Los de casa los ven los dos;
   los personales los ve únicamente quien pagó. La lectura se resuelve
   **siempre** con `visibleExpensesWhere()` de `src/lib/visibility.ts`; nunca con
   `userId: session.id` a mano. Que un gasto personal se filtre a las consultas
   de la otra persona es el peor fallo posible de este sistema.
4. **El permiso de edición vía bot es más amplio que la lectura** y vive en
   `canEditViaBot()`. Quien registró un gasto puede corregirlo desde el mensaje
   de confirmación de su chat aunque no pueda verlo en la web. **No unificar las
   dos funciones**: si se usa el permiso de edición para leer, se filtran gastos
   personales; si se usa el de lectura para editar, nadie puede arreglar lo que
   acaba de cargar mal.
5. **La ingesta principal es el bot de Telegram. La web es lectura y
   corrección.** Los formularios de alta se mantienen como escape hatch (cargar
   algo viejo, o si el bot está caído), pero no son el camino principal.

## Docs de referencia

- [docs/architecture.md](docs/architecture.md) — Stack, estructura de carpetas, los seams de ingesta/IA/OCR
- [docs/data-models.md](docs/data-models.md) — Los 8 modelos de Prisma
- [docs/features-backlog.md](docs/features-backlog.md) — Backlog pendiente
- [docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md](docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md) — Diseño completo del bot, la IA y el OCR

## Archivos críticos

| Propósito | Archivo |
|-----------|---------|
| Schema DB | `prisma/schema.prisma` |
| Regla de visibilidad y permiso de edición | `src/lib/visibility.ts` |
| Sesión y JWT | `src/lib/auth.ts` |
| Variables de entorno obligatorias | `src/lib/env.ts` |
| Singleton de Prisma | `src/lib/prisma.ts` |
| Gastos (GET con visibilidad, POST) | `src/app/api/expenses/route.ts` |
| Stats de los gráficos | `src/app/api/expenses/stats/route.ts` |
| Export | `src/app/api/expenses/export/route.ts` |
| Recurrentes | `src/app/api/recurring-expenses/route.ts` |
| Listado de gastos | `src/app/(dashboard)/dashboard/expenses/page.tsx` |
| Dashboard y gráficos | `src/app/(dashboard)/dashboard/page.tsx` |
| Semilla de categorías | `scripts/seed-categories.ts` |

Los módulos del bot (`src/lib/telegram/`), de la IA (`src/lib/ai/`) y del OCR
(`src/lib/ocr/`), más `src/app/api/telegram/`, están descritos en
[docs/architecture.md](docs/architecture.md) y se agregan a medida que avanzan
las rebanadas de implementación.
