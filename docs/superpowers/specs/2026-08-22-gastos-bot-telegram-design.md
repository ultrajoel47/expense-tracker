# Diseño — Gastos por Telegram con IA y OCR

**Fecha:** 2026-08-22
**Estado:** aprobado, pendiente de plan de implementación

## 1. Contexto y objetivo

El proyecto actual es un expense tracker multiusuario con grupos, splits
proporcionales al sueldo, ledger de deudas y presupuestos. Los usuarios reales
son **dos** (una pareja) y no necesitan casi nada de eso.

El objetivo es doble:

1. **Recortar el overengineering.** Sacar sueldos, grupos, splits, ledger de
   balance y presupuestos.
2. **Llegar a "cero forms".** Registrar gastos mandando un mensaje de texto o
   una captura de comprobante a un bot de Telegram, que interpreta, categoriza
   y guarda sin intervención.

La web deja de ser el lugar donde se **carga** y pasa a ser el lugar donde se
**consulta y corrige**.

## 2. Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Canal de ingesta | Telegram | Bot token inmediato, sin verificación de negocio, imágenes sin fricción. WhatsApp Cloud API exige cuenta de negocio y número dedicado. |
| Balance entre personas | **No existe** | Comparten la plata. Se registra quién pagó como dato informativo, sin deudas calculadas. |
| Data existente | Se descarta | Era mayormente seed y pruebas. Evita escribir migraciones. |
| Capa de IA | Grok (xAI) para texto | Elección del usuario. Queda detrás de una interfaz para poder cambiarlo. |
| OCR | Tesseract local | Los comprobantes de transferencia argentinos (MercadoPago, apps de banco) son **capturas de pantalla**: texto digital, alto contraste, tipografía limpia. Tesseract rinde bien en ese material. |
| Hosting | Vercel Hobby ahora, VPS después | Obliga a que el OCR esté detrás de una interfaz: `tesseract.js` (WASM) en Vercel, binario nativo en el VPS. |
| Confirmación | Guarda y avisa | Guarda al toque y responde con lo que entendió + botones de corrección. Un tap por gasto lo volvería un mini-form. |
| Subsistemas que sobreviven | Recurrentes, tarjetas/cuotas, gráficos | Uso real. Presupuestos se descartan. |
| Ámbito de un gasto | `casa` \| `personal`, **inferido por la IA** | Un campo en vez de un ledger. |
| Consultas por el bot | **Dentro de v1** | "¿cuánto gastamos en super este mes?" |

## 3. Fuera de alcance

- Cualquier noción de deuda, liquidación o balance entre personas.
- Presupuestos por categoría.
- Grupos y membresías (el "grupo" implícito son los dos usuarios).
- Registro de ingresos / sueldos.
- WhatsApp como canal (el seam de ingesta queda limpio para sumarlo después).
- Migración de la data existente.

## 4. Modelo de datos

De **14 modelos a 8**. Se eliminan `MonthlyIncome`, `Group`, `GroupMember`,
`ExpenseShare`, `RecurringShare`, `Budget`, `RecurringExpensePeriod` y
`PeriodShare`.

`RecurringExpensePeriod` y `PeriodShare` se eliminan porque sus **únicos
consumidores** son `groups/[id]/balance`, `groups/[id]/summary` y `shared` — las
tres rutas que se borran. Sin el motor de balance no tienen razón de existir.

### Schema final

```prisma
model User {
  id                String   @id @default(auto()) @map("_id") @db.ObjectId
  email             String   @unique
  password          String
  name              String
  telegramChatId    String?  @unique   // vinculación con el bot
  telegramLinkCode  String?  @unique   // código de un solo uso para /start
  createdAt         DateTime @default(now())

  expensesPaid      Expense[]          @relation("ExpensePayer")
  expensesCreated   Expense[]          @relation("ExpenseCreator")
  creditCards       CreditCard[]
  recurringExpenses RecurringExpense[]
}

model Category {
  id                String   @id @default(auto()) @map("_id") @db.ObjectId
  name              String   @unique
  icon              String   @default("tag")
  color             String   @default("#6366f1")

  expenses          Expense[]
  recurringExpenses RecurringExpense[]
  aliases           Alias[]
}

model Expense {
  id                 String   @id @default(auto()) @map("_id") @db.ObjectId
  amount             Float
  description        String
  date               DateTime @default(now())

  userId             String   @db.ObjectId   // quién PAGÓ
  createdById        String   @db.ObjectId   // quién lo REGISTRÓ
  categoryId         String   @db.ObjectId
  creditCardId       String?  @db.ObjectId

  scope              String   @default("casa")   // "casa" | "personal"
  source             String   @default("web")    // "bot" | "web" | "recurring"

  totalInstallments  Int?

  recurringExpenseId String?  @db.ObjectId
  recurringPeriod    String?                     // "2026-08"

  botChatId          String?                     // chat donde se confirmó
  botMessageId       String?                     // id del mensaje de confirmación

  createdAt          DateTime @default(now())

  payer              User              @relation("ExpensePayer",   fields: [userId],      references: [id])
  createdBy          User              @relation("ExpenseCreator", fields: [createdById], references: [id])
  category           Category          @relation(fields: [categoryId],   references: [id])
  creditCard         CreditCard?       @relation(fields: [creditCardId], references: [id])
  recurringExpense   RecurringExpense? @relation(fields: [recurringExpenseId], references: [id])
  installments       Installment[]

  @@index([scope, userId, date])
  @@index([botChatId, botMessageId])
  @@index([recurringExpenseId, recurringPeriod])
}

model Installment {
  id                String    @id @default(auto()) @map("_id") @db.ObjectId
  expenseId         String    @db.ObjectId
  installmentNumber Int
  dueDate           DateTime
  amount            Float
  paid              Boolean   @default(false)
  paidAt            DateTime?
  expense           Expense   @relation(fields: [expenseId], references: [id])

  @@unique([expenseId, installmentNumber])
}

model CreditCard {
  id                String   @id @default(auto()) @map("_id") @db.ObjectId
  userId            String   @db.ObjectId
  name              String
  lastFour          String?
  color             String   @default("#6366f1")
  createdAt         DateTime @default(now())
  user              User     @relation(fields: [userId], references: [id])
  expenses          Expense[]
  recurringExpenses RecurringExpense[]
}

model RecurringExpense {
  id           String    @id @default(auto()) @map("_id") @db.ObjectId
  userId       String    @db.ObjectId    // quién lo paga habitualmente
  categoryId   String    @db.ObjectId
  creditCardId String?   @db.ObjectId
  amount       Float
  description  String
  frequency    Frequency
  dayOfMonth   Int?
  nextDue      DateTime
  active       Boolean   @default(true)
  scope        String    @default("casa")
  createdAt    DateTime  @default(now())

  user         User        @relation(fields: [userId],       references: [id])
  category     Category    @relation(fields: [categoryId],   references: [id])
  creditCard   CreditCard? @relation(fields: [creditCardId], references: [id])
  expenses     Expense[]
}

model Alias {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  pattern     String   @unique   // normalizado: minúsculas, sin acentos
  categoryId  String   @db.ObjectId
  description String?            // "Panadería La Esquina"
  scope       String?            // "casa" | "personal" | null (no fuerza)
  hits        Int      @default(0)
  createdAt   DateTime @default(now())
  category    Category @relation(fields: [categoryId], references: [id])
}

model ProcessedUpdate {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  updateId    String   @unique   // update_id de Telegram, como string
  processedAt DateTime @default(now())
}
```

`Frequency` se mantiene tal como está hoy.

### Reinterpretación de campos existentes

- `Expense.userId` ya no significa "el dueño del registro" sino **quién pagó**.
- `Expense.createdById` es nuevo y significa **quién lo registró**. No es
  redundante: es lo que permite resolver "mi último gasto" cuando una persona
  carga un gasto de la otra y después lo corrige.

## 5. Regla de visibilidad

Tres ámbitos: los gastos personales de cada uno son privados, los de la casa son
compartidos.

```ts
// src/lib/visibility.ts
export function visibleExpensesWhere(userId: string) {
  return {
    OR: [
      { scope: "casa" },
      { scope: "personal", userId },   // userId = quién pagó
    ],
  };
}
```

`personal` lo ve **sólo quien pagó**, no quien lo registró.

Esto reemplaza el `userId: session.id` que hoy está esparcido por
`expenses/route.ts`, `expenses/stats/route.ts`, `expenses/export/route.ts` y las
páginas del dashboard. **Debe existir en un solo lugar**; que un gasto personal
se filtre a las consultas de la otra persona es el peor fallo posible de este
sistema.

### Borde conocido y aceptado

Si A registra un gasto de B y la IA lo marca `personal`, el pagador es B, así
que **A deja de verlo**: la confirmación del bot es la última vez que lo ve. Es
coherente con la regla y fue una decisión explícita.

## 6. Pipeline de ingesta

```
POST /api/telegram/webhook
 1. Valida el header X-Telegram-Bot-Api-Secret-Token
 2. Descarta si el update_id ya fue procesado (idempotencia)
 3. Resuelve User por telegramChatId; si no está en la whitelist, ignora en silencio
 4. Normaliza -> Intake { senderId, texto?, imagen?, replyToMessageId?, callbackData? }
 5. Si hay imagen -> OcrEngine.extractText(buffer) -> se concatena al texto
 6. Carga contexto: categorías, alias, nombres de los dos usuarios,
    último gasto registrado por el sender, gasto apuntado por replyToMessageId
 7. parseMessage(intake, contexto) -> ParseResult
 8. Aplica el intent
 9. Responde confirmación + inline keyboard; guarda botChatId y botMessageId
```

### Idempotencia (crítico)

Telegram **reintenta** el update si el webhook no responde rápido. OCR con WASM
más una llamada a Grok puede tardar 15-20s en Vercel Hobby. Sin protección, el
reintento **carga el gasto dos veces**.

Mitigación: insertar el `update_id` en `ProcessedUpdate` **antes** de procesar.
Si el insert viola el índice único, es un reintento y se descarta. El webhook
responde `200` siempre, incluso ante error interno, para que Telegram no
reintente.

Se eligió esto por sobre `waitUntil` de Vercel: `waitUntil` resolvería la
latencia pero ata el diseño a la plataforma, y el destino declarado es un VPS.

La tabla se limpia con un **índice TTL de Mongo sobre `processedAt`**, creado a
mano — Prisma no puede declarar índices TTL para MongoDB. Queda como paso
documentado de setup.

### Whitelist

El webhook es público. Sólo se procesan los `telegramChatId` de los dos
usuarios; cualquier otro chat se ignora sin responder.

### Vinculación de cuentas

La web genera un `telegramLinkCode` de un solo uso. El usuario manda
`/start <código>` al bot, que resuelve el código, graba el `telegramChatId` y lo
invalida. Se usa dos veces en la vida del sistema.

### Correcciones

Dos caminos, ambos apuntando a un gasto sin ambigüedad cuando es posible:

- **Botones inline**: el `callback_data` lleva el `expenseId`, así que tocar un
  botón de un mensaje viejo corrige *ese* gasto. Cubre toggle de scope, cambio
  de categoría y borrado.
- **Texto libre**: "eso fue personal", "en realidad fueron 15 lucas". Si el
  mensaje es un **reply** a una confirmación, el objetivo se resuelve por
  `botChatId` + `botMessageId`. Si no, se aplica al último gasto **registrado
  por el sender** (`createdById`), no al último que pagó.

El texto libre es el camino principal porque es más expresivo: no hay botón para
corregir un monto.

## 7. Capa de IA y OCR

Tres seams, una responsabilidad cada uno:

```
src/lib/ocr/index.ts        OcrEngine.extractText(buffer: Buffer) => Promise<string>
                            tesseract-wasm.ts   (Vercel, hoy)
                            tesseract-native.ts (VPS, después)
                            se elige por la env var OCR_ENGINE

src/lib/ai/provider.ts      AiProvider.complete(prompt, schema) => Promise<unknown>
                            grok.ts implementa esto; cambiar de proveedor = un archivo

src/lib/ai/parse.ts         parseMessage(intake, contexto) => Promise<ParseResult>
                            el único lugar que conoce el prompt
```

### ParseResult

Unión discriminada, validada contra un schema antes de tocar la base:

```ts
type ParseResult =
  | { intent: "gasto"; amount: number; description: string; date: string;
      categoryName: string; scope: "casa" | "personal"; payerName?: string;
      installments?: number; cardName?: string }
  | { intent: "correccion"; target: "ultimo" | { expenseId: string };
      patch: { amount?: number; description?: string; date?: string;
               categoryName?: string; scope?: "casa" | "personal" } }
  | { intent: "consulta"; query: { metric: "total" | "por_categoria" | "tendencia";
      period: { from: string; to: string }; categoryName?: string;
      scope?: "casa" | "personal" } }
  | { intent: "desconocido"; reason: string }
```

### Trabajo que se le saca deliberadamente al LLM

Cuatro reglas, cada una cubriendo un modo de falla concreto:

1. **Las consultas no las resuelve el LLM.** Grok traduce la pregunta a un
   objeto de consulta acotado; **el código hace la agregación con Prisma y
   formatea la respuesta**. El LLM nunca ve los totales ni genera queries. Si
   pudiera producir el número, en algún momento inventaría uno — y un número
   inventado en una app de gastos es peor que un error visible.

2. **Las fechas se calculan en código.** Se le pasa `today` en
   `America/Argentina/Buenos_Aires` y devuelve ISO; el código valida que no sea
   futura ni de más de 6 meses atrás. Los LLM son malos con aritmética de
   fechas, y el repo ya tiene un commit `fix utc` que documenta el dolor.

3. **Los montos se validan.** "12 lucas" -> 12000, "2 palos" -> 2000000, y el
   caso feo: `12.500` (miles) vs `12.50` (decimal). El prompt pide el valor
   normalizado, el código lo valida. Si el monto es anómalo para su categoría se
   **guarda igual** pero la confirmación lo marca con una advertencia visible.
   No se agrega un tap; se agrega una señal.

4. **Nada se guarda a medias.** Si Grok falla o el OCR devuelve basura, el bot
   dice qué no entendió y no escribe nada. Si el OCR sale vacío, pide el monto
   por texto.

### Casos de prueba del parser

Un archivo con ~20 mensajes reales de los usuarios, incluida al menos una
captura de MercadoPago, y un test que corre `parseMessage` contra ellos. Sin
esto no hay forma de saber si un cambio en el prompt mejoró o empeoró — y el
prompt se va a tocar muchas veces.

### Verificación pendiente

El free tier de xAI debe verificarse antes de escribir código: los free tiers
cambian seguido. Si no alcanza, el seam de `AiProvider` hace que cambiarlo sea
un archivo, no un refactor.

## 8. Aliases y aprendizaje

Resuelve el pedido explícito: "que sepa que una transferencia a tal persona es
la panadería".

- Antes de llamar a Grok se cargan los alias y se inyectan en el prompt como
  contexto.
- El `pattern` se guarda **normalizado** (minúsculas, sin acentos) para que
  "Panaderia" y "panadería" resuelvan igual.
- Cuando el usuario corrige la categoría o el scope de un gasto, **el alias se
  graba o se actualiza solo**, tomando el patrón del texto original o del
  destinatario detectado en el comprobante.
- `hits` cuenta los aciertos, para poder ver qué alias se usan y limpiar los que
  no.

El sistema aprende sin que nadie llene un form.

## 9. Materialización de recurrentes

Hoy los recurrentes viven en `RecurringExpensePeriod` y **no entran en los
gráficos**: `stats/route.ts` lee sólo `Expense` y muestra los recurrentes
únicamente como "próximos vencimientos". Es decir, el total mensual que ve el
usuario hoy está **subestimado** — no cuenta el alquiler ni las expensas.

`RecurringExpense` queda como plantilla pura y cada período se materializa
directamente como un `Expense` con `source: "recurring"`, `recurringExpenseId` y
`recurringPeriod` ("2026-08"). Una sola tabla: los gráficos se corrigen solos y
el bot puede corregir un recurrente como cualquier otro gasto.

### Disparo

**Lazy e idempotente**, no por cron: al leer un mes se crean los `Expense`
faltantes de las plantillas activas. Vercel Hobby limita los cron jobs y el VPS
sería otro mecanismo; lazy es portable a los dos sin cambios.

### Idempotencia

Un `@@unique([recurringExpenseId, recurringPeriod])` de Prisma **no sirve acá**:
en MongoDB un índice único trata el campo ausente como `null` y admite un solo
documento con `null`, así que todos los gastos manuales — que tienen ambos
campos vacíos — colisionarían entre sí. Los índices *sparse* / *partial* que lo
resolverían no se pueden declarar desde Prisma para MongoDB.

La materialización corre entonces dentro de un `$transaction` con guarda
`findFirst`, que es el patrón que ya usa `createPeriodFromRecurringIfMissing` en
`src/lib/recurring-periods.ts` — código probado en este repo. Como red de
seguridad se crea a mano en Mongo un índice único **parcial** sobre
`(recurringExpenseId, recurringPeriod)` filtrado a los documentos donde
`recurringExpenseId` existe, junto al índice TTL, como paso documentado de
setup.

`src/lib/recurring-periods.ts` se reemplaza por
`src/lib/recurring-materialize.ts`.

## 10. La web y los gráficos

La web pasa a ser **lectura y corrección**. Los forms de alta se mantienen como
escape hatch (cargar algo viejo, o si el bot está caído), pero no son el camino
principal.

### Gráficos (`/dashboard`)

Se mantiene `recharts` y lo que ya funciona: total del mes, por categoría,
acumulado diario y comparativa con el mes anterior. Se suma **tendencia de los
últimos 12 meses**, que fue pedida explícitamente y hoy no existe.

Todo respeta la regla de visibilidad: los gráficos de la casa los ven los dos, y
cada uno ve además sus propios gastos personales sumados.

Los recurrentes ahora **sí** entran en los totales, por la materialización.

## 11. Inventario de cambios

### Se borra

```
src/app/api/budgets/route.ts
src/app/api/groups/**                                  (6 routes, incl. balance y summary)
src/app/api/income/route.ts
src/app/api/shared/route.ts
src/app/api/expenses/[id]/shares/route.ts
src/app/api/recurring-expenses/[id]/shares/route.ts
src/app/api/recurring-expenses/[id]/periods/route.ts

src/app/(dashboard)/dashboard/budgets/page.tsx
src/app/(dashboard)/dashboard/groups/page.tsx
src/app/(dashboard)/dashboard/groups/[id]/page.tsx
src/app/(dashboard)/dashboard/income/page.tsx
src/app/(dashboard)/dashboard/shared/page.tsx

src/lib/recurring-periods.ts                           (reemplazado)
tests/recurring-periods.test.ts / .mjs                 (reescritos)
scripts/seed-shares.ts
scripts/migrate-expenses-to-shared.ts

docs/shared-expenses.md
docs/balance-calculation.md
docs/groups.md
```

Del nav de `(dashboard)/layout.tsx` se quitan "Grupos" y "Presupuestos".

### Se reescribe

| Archivo | Cambio |
|---|---|
| `src/app/api/expenses/route.ts` | Se van las ~70 líneas de `createExpenseShares` y la rama de grupos. El POST queda en ~50 líneas. Aplica la regla de visibilidad en el GET. |
| `src/app/api/expenses/stats/route.ts` | Aplica visibilidad; ahora incluye recurrentes materializados; suma la tendencia de 12 meses. |
| `src/app/api/expenses/export/route.ts` | Aplica visibilidad. |
| `src/app/api/recurring-expenses/**` | Se van shares, splitMode, groupId, payerId. Suma `scope`. |
| `src/app/(dashboard)/dashboard/home/page.tsx` | Vista de la casa sobre `scope: "casa"`, sin `ShareDetail` ni `CombinedEntry`. |
| `src/app/(dashboard)/dashboard/expenses/page.tsx` | Afuera la UI de shares y grupos; adentro filtro por scope y por pagador. |
| `src/app/(dashboard)/dashboard/recurring/page.tsx` | Afuera shares; adentro `scope`. |
| `src/app/(dashboard)/dashboard/page.tsx` | Suma el gráfico de tendencia 12 meses. |
| `prisma/schema.prisma` | Schema de la sección 4. Se aplica con `prisma db push`. |
| `CLAUDE.md` | Ver sección 14. |

### Es nuevo

```
src/app/api/telegram/webhook/route.ts    webhook (mensajes y callbacks)
src/app/api/telegram/link/route.ts       genera el telegramLinkCode

src/lib/visibility.ts                    la regla de scope, en un solo lugar
src/lib/recurring-materialize.ts         reemplaza recurring-periods.ts

src/lib/telegram/client.ts               sendMessage, editMessage, getFile
src/lib/telegram/intake.ts               update de Telegram -> Intake

src/lib/ocr/index.ts                     interfaz OcrEngine + selector por env
src/lib/ocr/tesseract-wasm.ts
src/lib/ocr/tesseract-native.ts

src/lib/ai/provider.ts                   interfaz AiProvider
src/lib/ai/grok.ts
src/lib/ai/parse.ts                      parseMessage + el prompt
src/lib/ai/types.ts                      ParseContext, ParseResult

src/lib/queries/aggregate.ts             resuelve el intent "consulta" con Prisma
src/lib/aliases.ts                       lookup, normalización y aprendizaje

.env.example
```

### Base de datos

Se descarta la data existente. Se aplica el schema nuevo con `prisma db push` y
se siembran las categorías iniciales. `scripts/seed-gastos.ts` y
`scripts/gastos-data.json` se conservan como fuente opcional para repoblar
historial, adaptados al schema nuevo.

## 12. Configuración y entorno

`.env` hoy sólo tiene `DATABASE_URL`. Variables necesarias, documentadas en un
`.env.example` que hoy no existe:

```
DATABASE_URL
JWT_SECRET                  # obligatorio, ver abajo
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET     # el secret token del header
XAI_API_KEY
OCR_ENGINE                  # "wasm" | "native"
```

**`JWT_SECRET` pasa a ser obligatorio.** Hoy `src/lib/auth.ts:4` tiene el
fallback `"expense-tracker-secret-demo-key"`. Con la app en un dominio público,
un secret conocido permite forjar sesiones. La app debe fallar al arrancar si
falta.

Pasos manuales de setup en Mongo, documentados:

- Índice TTL sobre `ProcessedUpdate.processedAt`.
- Índice único parcial sobre `Expense (recurringExpenseId, recurringPeriod)`.

## 13. Testing

Hoy hay un único test (`tests/recurring-periods.test.ts`) que muere con el
modelo viejo. Cobertura objetivo, por orden de valor:

1. **`parseMessage` contra los casos reales.** El corazón del sistema.
2. **La regla de visibilidad.** Que un gasto personal de una persona no se
   filtre a las consultas de la otra, en `expenses`, `stats` y `export`.
3. **Idempotencia.** Mismo `update_id` dos veces = un solo gasto. Misma
   materialización dos veces = un solo alquiler.
4. **Normalización de montos y fechas.** "12 lucas", "2 palos", `12.500` vs
   `12.50`, "ayer", "el viernes pasado", y el rechazo de fechas futuras.
5. **Correcciones.** Que el objetivo se resuelva por reply cuando existe, y por
   `createdById` (no por pagador) cuando no.

## 14. Documentación a actualizar

`CLAUDE.md` tiene una sección entera —"Reglas de dominio — Gastos
compartidos"— que queda **enteramente falsa**: habla del pagador al 100%, del
ledger de deudas entre pares, del split proporcional a `MonthlyIncome` y de los
porcentajes de `GroupMember`. Un `CLAUDE.md` desactualizado desorienta
activamente a las próximas sesiones de IA, así que se reescribe como parte del
trabajo, no después.

- `CLAUDE.md` — reescribir stack, convenciones, reglas de dominio y archivos
  críticos.
- `docs/architecture.md` — reescribir con los seams nuevos (ingesta, IA, OCR).
- `docs/data-models.md` — reescribir con el schema de 8 modelos.
- `docs/shared-expenses.md`, `docs/balance-calculation.md`, `docs/groups.md` —
  borrar.
- `docs/features-backlog.md` — revisar y purgar lo que refiera a lo eliminado.

## 15. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Telegram reintenta y duplica gastos | Alto: números falsos silenciosos | `ProcessedUpdate` con índice único, `200` siempre |
| Gasto personal filtrado a la otra persona | Alto: privacidad | La regla en un solo archivo, con test dedicado |
| Monto mal parseado (`12.500` vs `12.50`) | Alto: datos corruptos | Validación en código + advertencia visible ante anomalía |
| El LLM inventa un total en una consulta | Alto: pérdida de confianza | El LLM no ve los números; agrega y formatea el código |
| `tesseract.js` lento o pesado en Vercel Hobby | Medio: timeouts | El `traineddata` se bundlea; fallback a pedir el monto por texto; el VPS lo resuelve de fondo |
| El free tier de xAI no alcanza | Medio | Verificar antes de codear; el seam de `AiProvider` lo hace intercambiable |
| Corrección aplicada al gasto equivocado | Medio: corrupción silenciosa | Reply + `botMessageId`, y `callback_data` con `expenseId` en los botones |

## 16. Fases de implementación

El alcance total es demasiado grande para un solo plan (borrado de 11 archivos,
reescritura de 9, y ~15 archivos nuevos entre bot, IA, OCR y consultas). Se
divide en tres fases, cada una **utilizable por sí sola** y con su propio plan de
implementación.

### Fase 1 — El recorte

Schema nuevo con `prisma db push`, borrado de los modelos, rutas y páginas
listados en la sección 11, `src/lib/visibility.ts` aplicado en todas las
consultas, materialización de recurrentes, gráficos (incluida la tendencia de 12
meses), `JWT_SECRET` obligatorio y `.env.example`.

**Resultado:** la app queda simplificada y funcionando, sin bot. Sirve sola.

### Fase 2 — El bot y la IA de texto

Webhook con validación de secret, whitelist e idempotencia; vinculación por
`/start`; `AiProvider` + `parseMessage` para los intents `gasto` y `correccion`;
confirmación con botones inline y correcciones por reply o por último gasto.

**Resultado:** cero forms para gastos escritos. Es el objetivo central del
proyecto.

### Fase 3 — Comprobantes, aliases y consultas

`OcrEngine` con el backend WASM; el intent `consulta` con la agregación en
Prisma; los aliases con su aprendizaje automático al corregir.

**Resultado:** comprobantes por foto, memoria de destinatarios y preguntas al
bot.

El orden importa: la fase 1 deja el modelo de datos estable antes de construir
encima, y la fase 3 depende de que las correcciones de la fase 2 existan para
poder aprender de ellas.
