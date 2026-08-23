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
- **`HOUSEHOLD_EMAILS`** es la allowlist de emails habilitados a tener cuenta, y
  es la **fuente única de verdad de quién es miembro del hogar**. Sin definir,
  falla **cerrado** en producción (nadie se registra, nadie ve los gastos de
  casa) y abre fuera de producción para no romper el dev local. Ver
  `src/lib/household.ts`.

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
3. **`Expense.scope` es `"casa"` o `"personal"`.** Los de casa los ven los dos
   **miembros del hogar**; los personales los ve únicamente quien pagó. La
   lectura se resuelve **siempre** con `visibleExpensesWhere(session.id,
   householdUserIds)` de `src/lib/visibility.ts`; nunca con `userId: session.id`
   a mano (hay un test que lo verifica: `tests/read-paths.test.ts`). Que un gasto
   personal se filtre a las consultas de la otra persona es el peor fallo posible
   de este sistema.
4. **La privacidad tiene DOS mitades y las dos son obligatorias:** qué ve un
   miembro (`visibleExpensesWhere`) y **quién es miembro**
   (`HOUSEHOLD_EMAILS` → `getHouseholdUserIds()` de `src/lib/household.ts`). La
   rama de `scope: "casa"` **nunca** puede quedar sin predicado de identidad:
   sin los ids del hogar, cualquiera que se registrara leía —y podía borrar— el
   historial financiero completo. Los ids los pasa el llamador porque
   `visibility.ts` es un módulo puro y sincrónico que se testea sin base.
5. **El permiso de edición vía bot es más amplio que la lectura** y vive en
   `canEditViaBot()`. Quien registró un gasto puede corregirlo desde el mensaje
   de confirmación de su chat aunque no pueda verlo en la web. **No unificar las
   dos funciones**: si se usa el permiso de edición para leer, se filtran gastos
   personales; si se usa el de lectura para editar, nadie puede arreglar lo que
   acaba de cargar mal.
6. **La ingesta principal es el bot de Telegram. La web es lectura y
   corrección.** Los formularios de alta se mantienen como escape hatch (cargar
   algo viejo, o si el bot está caído), pero no son el camino principal.
7. **Un alias (`src/lib/aliases.ts`) solo enseña la categoría, y solo se
   aprende de un gasto de casa.** Los aliases se inyectan en el prompt de los
   DOS miembros del hogar y ese prompt se manda a un proveedor de IA externo
   en cada mensaje: aprender de un gasto `personal` llevaría su descripción
   (un tratamiento médico, un regalo sorpresa) al contexto de la otra persona
   y de un tercero, indefinidamente — no es una lectura de `Expense`, así que
   ningún guard de visibilidad lo detecta. Por el mismo motivo un alias ya no
   enseña el ámbito: `Alias` no tiene `userId`, así que una corrección de UNA
   persona marcando algo como "personal" arrastraba a la OTRA a cargar lo
   mismo como personal, invisible para quien no lo pagó.

## Docs de referencia

- [docs/architecture.md](docs/architecture.md) — Stack, estructura de carpetas, los seams de ingesta/IA/OCR
- [docs/data-models.md](docs/data-models.md) — Los 8 modelos de Prisma
- [docs/features-backlog.md](docs/features-backlog.md) — Backlog pendiente
- [docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md](docs/superpowers/specs/2026-08-22-gastos-bot-telegram-design.md) — Diseño completo del bot, la IA y el OCR

## Archivos críticos

| Propósito | Archivo |
|-----------|---------|
| Schema DB | `prisma/schema.prisma` |
| Regla de visibilidad, permiso de edición y política de membresía | `src/lib/visibility.ts` |
| Miembros del hogar (allowlist → ids) | `src/lib/household.ts` |
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
| Aliases del bot (aprender/inyectar equivalencias en el prompt) | `src/lib/aliases.ts` |
| Agregación de las consultas del bot ("cuánto gastamos...") | `src/lib/queries/aggregate.ts` |
| Corrección y borrado de un gasto (bot y web) | `src/lib/expenses/correct.ts` |
| Botones de la confirmación del bot y su `callback_data` | `src/lib/telegram/callbacks.ts` |

Los módulos del bot (`src/lib/telegram/`), de la IA (`src/lib/ai/`) y del OCR
(`src/lib/ocr/`), más `src/app/api/telegram/`, están descritos en
[docs/architecture.md](docs/architecture.md) y se agregan a medida que avanzan
las rebanadas de implementación.
