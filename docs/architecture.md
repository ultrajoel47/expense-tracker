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
│   ├── (auth)/                  # Rutas públicas: login (la pagina de registro
│   │                            # se borro; el alta sigue existiendo como
│   │                            # POST /api/auth/register, cerrado por
│   │                            # allowlist, sin UI propia)
│   ├── (dashboard)/             # Rutas protegidas
│   │   └── dashboard/
│   │       ├── expenses/        # Listado y alta de gastos
│   │       ├── categories/      # Categorías
│   │       ├── credit-cards/    # Tarjetas de crédito
│   │       ├── recurring/       # Plantillas de gastos recurrentes
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
│   ├── visibility.ts            # Regla de scope, permiso de edición y política de membresía
│   ├── household.ts             # Allowlist de emails → ids de los miembros
│   ├── idempotency.ts           # claimUpdate() del webhook: el update_id se reclama antes de procesar
│   ├── recurring-materialize.ts # Crea el Expense del período al materializar una plantilla recurrente
│   ├── aliases.ts               # Aprende equivalencias de las correcciones (ver debajo)
│   ├── expenses/                # installments.ts, charges.ts (expensesToCharges), create-from-bot.ts, correct.ts
│   ├── telegram/                # Cliente del bot y normalización de updates
│   ├── ai/                      # AiProvider, parseMessage y el prompt
│   ├── ocr/                     # (futuro) OcrEngine y sus backends
│   └── queries/                 # (futuro) Agregaciones para las consultas del bot
├── prisma/
│   └── schema.prisma            # Los 8 modelos
└── scripts/                     # Semillas y migraciones puntuales (sin type-check)
```

La página de recurrentes (`dashboard/recurring/`) y la materialización
automática ya existen — son la feature principal de la Rebanada 3. Lo que
sigue pendiente, si algo, se agrega a medida que avanzan las próximas
rebanadas descritas en la sección 16 del
[diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md); ver
[features-backlog.md](features-backlog.md) para lo que falta hoy.

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

- `client.ts` — `sendMessage`, `editMessageText`, `editMessageReplyMarkup` y
  `answerCallbackQuery` contra la Bot API. `getFile` se suma cuando lo
  necesite la rebanada de OCR.
- `intake.ts` — convierte un update de Telegram en un `Intake` neutral
  (`{ senderId, texto?, imagen?, replyToMessageId?, callbackData?,
  callbackQueryId?, callbackMessageId? }`).
- `callbacks.ts` — los botones de la confirmación y el parseo de su
  `callback_data`. El dato lleva el objetivo EXPLICITO ("poner personal"), no
  una orden de invertir ("cambiar el scope"): Telegram no expira los mensajes,
  así que un botón de hace semanas sigue siendo tocable, y con el objetivo
  explícito tocarlo dos veces escribe dos veces lo mismo en vez de invertir el
  estado dos veces y volver al punto de partida.

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

**Un tap de botón no pasa por estas tres regiones.** Se maneja entero dentro de
`handleCallback`, con su propio `try/catch` que nunca deja escapar un error: el
mensaje de la Región 2 le pide a la persona que "reenvíe el mensaje", y no hay
mensaje que reenviar cuando lo que falló es un botón. `handleCallback` siempre
contesta el `callback_query` (incluso en el camino de error), porque sin esa
respuesta Telegram deja el botón girando y la persona no sabe si pasó algo.

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

### `src/lib/aliases.ts` — el bot aprende de las correcciones

Módulo puro con cliente inyectado (mismo patrón que `correct.ts` e
`idempotency.ts`). Implementa la sección 8 del
[diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md): cuando la
pareja corrige la categoría o el ámbito de un gasto, el sistema graba solo la
equivalencia — nadie llena un formulario de aliases.

- **El patrón sale de la `description` del gasto, no del texto del mensaje.**
  La IA ya extrae ahí "el comercio, persona o concepto, corto" — la misma
  granularidad que un alias necesita. De "transferí 12 lucas a Juan Pérez" la
  descripción es "Juan Pérez", y ese es el patrón que se aprende, no la frase
  entera.
- Se aprende solo cuando la corrección cambió la categoría o el ámbito:
  corregir un monto o una fecha no enseña "qué es" un gasto.
- Los aliases inyectados en el prompt (`buildSystemPrompt` en
  `src/lib/ai/parse.ts`, sección "Equivalencias ya conocidas") están acotados a
  un tope (`TOPE_PARA_EL_PROMPT`): la tabla crece sin techo con cada
  corrección, pero el prompt tiene un tamaño finito, y sin el límite las
  equivalencias viejas terminan empujando afuera a las instrucciones. Se
  ordenan por `hits` (usos) descendente, así que lo que sobrevive es lo que de
  verdad se usa.
- El webhook cablea las tres puntas: carga los aliases para el prompt en
  `handleTextMessage`, aprende después de cada corrección (por texto libre y
  por los botones de ámbito/categoría), y cuenta un acierto después de crear
  un gasto. Las tres van con su propio manejo de errores: un alias es una
  mejora del prompt, nunca puede convertir un gasto o una corrección ya
  aplicados en un mensaje de error.

## Reglas transversales

- **Visibilidad**: toda lectura de gastos pasa por `visibleExpensesWhere(userId,
  householdUserIds)`, y los ids del hogar salen de `getHouseholdUserIds()`
  (`src/lib/household.ts`), que los deriva de la allowlist `HOUSEHOLD_EMAILS`.
  Son las **dos mitades** del modelo de privacidad: qué ve un miembro y quién es
  miembro. `tests/read-paths.test.ts` falla si una ruta de lectura se saltea la
  regla. Ver las reglas de dominio en [CLAUDE.md](../CLAUDE.md).
- **Idempotencia**: el webhook inserta `ProcessedUpdate.updateId` **antes** de
  procesar y usa el fallo del índice único como señal de reintento; la
  materialización de recurrentes va por `(recurringExpenseId, recurringPeriod)`.
  Las dos son defensas contra duplicados silenciosos, que es la falla más
  peligrosa del sistema porque no se nota. En las dos, **escribir la marca
  después del trabajo anula la defensa**.
- **Semántica de cuotas**: lo que se muestra en un mes es lo que efectivamente
  se paga ese mes (el monto de la cuota que vence, no el total de la compra) —
  ver la Enmienda 1 del [diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md).
  **Esta regla está implementada dos veces, DE FORMA INDEPENDIENTE, y nada
  automatizado las mantiene sincronizadas:**
  - Para los gráficos: `expensesToCharges` (`src/lib/expenses/charges.ts`),
    un transform en JS sobre gastos ya traídos de la base.
  - Para el listado: `src/app/api/expenses/route.ts`, en un `where` de Prisma
    que filtra en la base (líneas 46-52, la rama `installments: { some: {
    dueDate: { gte, lt } } }`) más un filtro en JS aparte que calcula la
    cuota vigente para la respuesta (líneas 84-89, `currentInstallment`).

  Las dos implementaciones coinciden hoy — se verificó a mano contrastando el
  total de marzo 2026 por ambos caminos (71 cargos) — pero esa coincidencia no
  está garantizada por ningún test ni por compartir código: **quien cambie una
  tiene que cambiar la otra a mano**, o vuelven a divergir, que es exactamente
  el bug que esta rebanada corrigió (ver el ítem 1 de
  [features-backlog.md](features-backlog.md#1-cuotas--filtrado-correcto-por-mes)).
  Unificarlas requeriría que el listado dejara de paginar en la base — un
  cambio de diseño, no de esta rebanada — y quedó anotado como pendiente para
  la próxima (agregar un test que las fije a estar de acuerdo, ejercitando el
  camino de Prisma contra una base real).

  **Hay una TERCERA implementación, deliberadamente distinta y NO alineada con
  la Enmienda 1:** `src/app/api/expenses/export/route.ts` (el CSV) filtra por
  `date: { gte, lt }` — fecha de compra pura, la regla ANTERIOR a la Enmienda
  1 — y no materializa recurrentes. Fue una decisión explícita de mantener el
  alcance de esta rebanada acotado: unificar el export es un cambio de
  semántica de lo que exporta (una fila deja de ser un gasto y pasa a ser un
  cargo) que queda pendiente para una tarea aparte, no algo que se coló sin
  que nadie lo mirara.

  **Consecuencia, mientras esto no se corrija:** el CSV de un mes NO va a
  coincidir con el total que muestra el dashboard para ese mismo mes (una
  compra en cuotas se exporta entera en el mes de la compra, no repartida por
  cuota) y **no va a incluir los gastos recurrentes** materializados ese mes
  (el alquiler, los servicios) porque el export nunca dispara la
  materialización. Quien exporte para chequear el dashboard va a encontrar
  una discrepancia real, no un error de tipeo.
