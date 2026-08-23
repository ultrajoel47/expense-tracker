# Arquitectura del proyecto

Tracker de gastos de un hogar de dos personas. La ingesta principal es un bot de
Telegram; la web consulta y corrige.

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) + React 19 |
| Estilos | Tailwind CSS |
| Base de datos | MongoDB vía Prisma ORM |
| Auth | JWT custom (`src/lib/auth.ts`), cookie httpOnly |
| Charts | Recharts |
| Ingesta | Telegram Bot API (webhook) |
| IA | Groq o Grok (xAI), seleccionable con `AI_PROVIDER`, detrás de `AiProvider` |
| OCR | Tesseract, detrás de `OcrEngine` |

## Estructura de carpetas

```
src/
├── app/
│   ├── (auth)/                  # Rutas públicas: login, registro
│   ├── (dashboard)/             # Rutas protegidas
│   │   └── dashboard/
│   │       ├── expenses/        # Listado y alta de gastos
│   │       ├── categories/      # Categorías
│   │       ├── credit-cards/    # Tarjetas de crédito
│   │       └── export/          # Exportación
│   └── api/
│       ├── auth/                # Login, registro, logout, me, users
│       ├── categories/          # CRUD
│       ├── credit-cards/        # CRUD + pendientes
│       ├── expenses/            # CRUD + stats + export + cuotas
│       ├── recurring-expenses/  # CRUD de plantillas
│       └── telegram/            # Webhook del bot y vinculación de cuenta
├── lib/
│   ├── auth.ts                  # JWT y getSession()
│   ├── env.ts                   # requireEnv() para variables obligatorias
│   ├── format.ts                # Formato de moneda y fechas
│   ├── prisma.ts                # Singleton del Prisma client
│   ├── theme.tsx                # Dark mode
│   ├── visibility.ts            # Regla de scope: lectura y permiso de edición
│   ├── telegram/                # Cliente del bot y normalización de updates
│   ├── ai/                      # AiProvider, parseMessage y el prompt
│   ├── ocr/                     # OcrEngine y sus backends
│   └── queries/                 # Agregaciones para las consultas del bot
├── prisma/
│   └── schema.prisma            # Los 8 modelos
└── scripts/                     # Semillas y migraciones puntuales (sin type-check)
```

Las páginas de la vista de casa y de recurrentes, y varios de los módulos de
`lib/` de arriba, se agregan a medida que avanzan las rebanadas de
implementación descritas en la sección 16 del
[diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md).

## Patrones clave

- **API Routes**: cada ruta valida sesión con `getSession()` al inicio. Retorna
  JSON con errores en español, en formato `{ error: "mensaje" }`.
- **Auth**: token JWT en cookie httpOnly. `getSession()` decodifica y retorna
  `{ id, email, name }`. No hay middleware: cada handler lo valida.
- **Variables obligatorias**: `requireEnv()` en `src/lib/env.ts`. Nunca
  `process.env.X || "default"` para un secreto. `JWT_SECRET` es obligatorio.
- **Prisma**: se usa el singleton en `src/lib/prisma.ts` para evitar múltiples
  conexiones.
- **Sin migrations**: MongoDB no las requiere, se usa `npx prisma db push`. Hay
  índices que Prisma no puede expresar y se crean a mano; ver
  [data-models.md](data-models.md#pasos-manuales-en-mongo).

## Los tres seams

El diseño mete tres dependencias externas (Telegram, un LLM, un motor de OCR).
Cada una queda detrás de una interfaz para poder cambiarla sin tocar el pipeline.
Los tres son seams **deliberados**, no accidentales.

### `src/lib/telegram/` — el canal de ingesta

- `client.ts` — `sendMessage` contra la Bot API. `editMessage` y `getFile` se
  suman cuando los necesiten las rebanadas de corrección y de OCR.
- `intake.ts` — convierte un update de Telegram en un `Intake` neutral
  (`{ senderId, texto?, imagen?, replyToMessageId?, callbackData? }`).

El resto del pipeline consume `Intake` y no sabe nada de Telegram. Es lo que
permitiría sumar WhatsApp después sin reescribir la ingesta.

El webhook (`src/app/api/telegram/webhook/route.ts`) valida el header
`X-Telegram-Bot-Api-Secret-Token`, inserta el `update_id` en `ProcessedUpdate`
**antes de procesar** —y trata la violación del índice único como la señal de que
es un reintento, descartándolo— y resuelve el usuario por `telegramChatId`
(whitelist).

El orden importa: insertar *después* de procesar deja abierta la ventana de 15-20s
que puede tardar OCR + LLM, y en esa ventana el reintento de Telegram pasa el
chequeo y carga el gasto dos veces.

#### Las tres regiones del manejo de errores

Telegram reintenta ante cualquier respuesta que no sea 2xx, así que la regla es
**responder 200 casi siempre**. «Casi»: el manejo de errores está partido en tres
regiones porque la respuesta correcta no es la misma en las tres. Un único catch
que devolviera 200 siempre convierte cualquier falla en silencio, y el silencio
hace que la persona reenvíe — con un **`update_id` nuevo**, que `ProcessedUpdate`
no puede deduplicar. Un mensaje perdido se vuelve un gasto duplicado.

| Región | Dónde | Respuesta |
|--------|-------|-----------|
| 1 | `claimUpdate` tira (error transitorio de Mongo) | **503** — única excepción deliberada al 200 |
| 2 | Entre el claim y `expense.create` | 200 + `sendMessage` pidiendo que reenvíe |
| 3 | Después de `expense.create` | 200 + log; **no** se pide reenvío |

La Región 1 es la excepción porque es el único punto donde el reintento es
*demostrablemente* seguro: o no se escribió nada y el reintento entra limpio, o la
fila se escribió sin que llegáramos a contestar y el reintento choca con `P2002` y
se descarta como duplicado. Ahí romper la regla la mejora.

En la Región 2 nada se escribió todavía, así que pedir un reenvío es seguro. En la
Región 3 el gasto ya existe y pedir un reenvío **causaría** el duplicado: lo único
que queda es el log, y por eso son dos catches separados (el del `sendMessage` y el
del update de `botChatId`/`botMessageId`), para que ninguno afirme algo falso sobre
si la persona recibió la confirmación.

### `src/lib/ai/` — el parseo del mensaje

- `provider.ts` — la interfaz `AiProvider` y `getAiProvider()`, que elige la
  implementación según `AI_PROVIDER` (`"groq"`, default, o `"grok"`).
- `groq.ts` — la implementación con Groq (API compatible con OpenAI).
- `grok.ts` — la implementación con xAI, queda como alternativa.
- `parse.ts` — `parseMessage` y el prompt.
- `types.ts` — `ParseContext` y `ParseResult`.

**Al LLM se le saca trabajo deliberadamente.** No ve números para agregarlos: la
normalización de montos y fechas ("12 lucas", "2 palos", `12.500` vs `12.50`,
"ayer", "el viernes pasado") y las agregaciones de las consultas se hacen en
código. El LLM inventa totales; el código no. El seam existe para poder cambiar
de proveedor, y porque el free tier puede no alcanzar — y esto se validó en la
práctica, no en teoría: el primer proveedor elegido (xAI/Grok) resultó no tener
free tier, y cambiarlo por Groq costó agregar un solo archivo (`groq.ts`) más
una rama en `getAiProvider()`, sin tocar `parse.ts` ni los tests.

### `src/lib/ocr/` — los comprobantes por foto

- `index.ts` — la interfaz `OcrEngine` y el selector por `OCR_ENGINE`.
- `tesseract-wasm.ts` — `tesseract.js`, para Vercel.
- `tesseract-native.ts` — el binario nativo, para el VPS.

Este seam existe por el hosting: en Vercel Hobby no hay binario nativo, en el VPS
sí y es mucho más rápido. El texto extraído se concatena al mensaje y sigue por
el mismo pipeline que un gasto escrito.

## Reglas transversales

- **Visibilidad**: toda lectura de gastos pasa por `visibleExpensesWhere()`. Ver
  las reglas de dominio en [CLAUDE.md](../CLAUDE.md).
- **Idempotencia**: el webhook inserta `ProcessedUpdate.updateId` **antes** de
  procesar y usa el fallo del índice único como señal de reintento; la
  materialización de recurrentes va por `(recurringExpenseId, recurringPeriod)`.
  Las dos son defensas contra duplicados silenciosos, que es la falla más
  peligrosa del sistema porque no se nota. En las dos, **escribir la marca
  después del trabajo anula la defensa**.
