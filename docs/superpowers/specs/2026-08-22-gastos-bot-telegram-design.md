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

> **Enmienda (2026-08-23) — esta sección tenía un agujero de seguridad.**
>
> Lo de abajo especifica **qué ve un miembro del hogar** y no especificaba nada
> sobre **quién es miembro**. La rama `{ scope: "casa" }` no tiene ningún
> predicado de identidad, y `POST /api/auth/register` quedó abierto: implementado
> tal cual, cualquiera que se registrara en el dominio público leía los 386
> gastos, el dashboard, el CSV y los emails de los dos, y podía **editar y
> borrar** el historial (el DELETE/PUT usan la misma regla). Antes de esta rama
> los filtros eran `userId: session.id`, así que un desconocido veía una app
> vacía: la regla "mejor" era una **regresión** de privacidad.
>
> El modelo de privacidad tiene **dos mitades** y las dos son parte del diseño:
>
> 1. **Qué ve un miembro** — lo de esta sección.
> 2. **Quién es miembro** — la allowlist de emails `HOUSEHOLD_EMAILS`, que es la
>    fuente única de verdad: cierra el registro (403 al resto) y de ella se
>    derivan los ids con los que se acota la rama de `casa`. Sin definir, falla
>    **cerrado** en producción y abre fuera de producción, para no romper el dev
>    local. No hay flag en la base a propósito: sería un segundo lugar donde vive
>    la misma verdad.
>
> La firma real quedó `visibleExpensesWhere(userId, householdUserIds)`, con los
> ids pasados por el llamador para que `visibility.ts` siga siendo un módulo
> puro y sincrónico, testeable sin base. La rama de casa queda acotada por los
> **dos** extremos: el lector tiene que ser miembro, y el pagador también.
>
> Ver `src/lib/household.ts`, `src/lib/visibility.ts`, `tests/visibility.test.ts`
> y `tests/read-paths.test.ts`.

Tres ámbitos: los gastos personales de cada uno son privados, los de la casa son
compartidos.

```ts
// src/lib/visibility.ts — forma final, con las dos mitades
export function visibleExpensesWhere(userId: string, householdUserIds: readonly string[]) {
  const own = { scope: "personal", userId };          // userId = quién pagó
  if (!householdUserIds.includes(userId)) {
    return { OR: [own] };                            // no es del hogar: no ve nada de casa
  }
  return {
    OR: [
      { scope: "casa", userId: { in: [...householdUserIds] } },
      own,
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

### Leer y editar son permisos distintos

La regla de arriba gobierna la **lectura**: la web, los gráficos, las
exportaciones y las consultas al bot. La **edición vía Telegram** se rige por
otra regla, y la distinción es deliberada:

| | Puede leerlo | Puede editarlo por el bot |
|---|---|---|
| `scope: casa` | los dos | los dos |
| `scope: personal` | sólo `userId` (quién pagó) | `userId` **o** `createdById` |

El razonamiento: la web es la vista propia de cada uno, detrás de su login, y no
tiene sentido que muestre un gasto que no es tuyo. El mensaje de confirmación en
Telegram, en cambio, es un artefacto del acto de cargarlo — y poder arreglar una
carga mal hecha es legítimo.

Concretamente: si A registra un gasto `personal` de B, A **no lo ve** en la web
ni en sus totales, pero **sí puede corregirlo** desde los botones o el reply del
mensaje de confirmación que quedó en su chat. Nada más que eso.

**Implementación:** son dos funciones separadas, no una. `visibleExpensesWhere`
para lectura, y una comprobación aparte en el handler de callbacks y de replies
del bot. Colapsarlas en una sola es el error a evitar: si se usa el permiso de
edición para leer, se filtran gastos personales; si se usa el de lectura para
editar, A no puede arreglar lo que acaba de cargar.

**Consecuencia aceptada:** los botones muestran el estado del gasto al
redibujar el mensaje, así que si B modifica ese gasto después, A lo vería
actualizado al tocar un botón viejo. Con dos usuarios que comparten la plata es
irrelevante, pero queda dicho para que no aparezca después como sorpresa.

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
HOUSEHOLD_EMAILS            # allowlist del hogar, ver la enmienda de la §5
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET     # el secret token del header
XAI_API_KEY
OCR_ENGINE                  # "wasm" | "native"
```

**`HOUSEHOLD_EMAILS` es obligatoria en producción** (agregada por la enmienda de
la §5): es la allowlist de emails habilitados a registrarse y la fuente de la que
salen los miembros del hogar. Sin definir falla cerrado en producción y abre
fuera de producción.

**`JWT_SECRET` pasa a ser obligatorio.** Hoy `src/lib/auth.ts:4` tiene el
fallback `"expense-tracker-secret-demo-key"`. Con la app en un dominio público,
un secret conocido permite forjar sesiones. La app debe fallar al arrancar si
falta.

Pasos manuales de setup en Mongo, documentados (comandos exactos, nombres de
índice y por qué esos nombres, en
[docs/data-models.md](../../data-models.md#pasos-manuales-en-mongo)):

- Índices únicos **sparse** sobre `User.telegramChatId` y `User.telegramLinkCode`.
- Índice **TTL** sobre `ProcessedUpdate.processedAt` (7 días).
- Índice único **parcial** sobre `Expense (recurringExpenseId, recurringPeriod)`.

Y el registro del webhook en producción con `setWebhook` + `secret_token`, en el
[README](../../../README.md#deploy): sin ese paso el bot desplegado no recibe
nada, y sin el `secret_token` recibe todo y contesta 401 a cada update.

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

## 16. Rebanadas de implementación

El alcance total es demasiado grande para un solo plan: 11 archivos borrados, 9
reescritos y ~15 nuevos entre bot, IA, OCR y consultas.

El corte es **vertical**: cada rebanada atraviesa todo el stack y queda
**funcional de punta a punta**, en vez de completar una capa por vez. Cada una
tiene su propio plan de implementación.

| # | Rebanada | Qué se puede hacer al terminarla |
|---|---|---|
| 1 | Un gasto escrito, punta a punta | Mandar "12 lucas panadería" al bot y verlo en la web |
| 2 | Correcciones | Botones, texto libre y reply sobre un gasto ya guardado |
| 3 | Recurrentes y gráficos | El alquiler entra en los totales; tendencia de 12 meses |
| 4 | Comprobantes por foto | Mandar una captura de MercadoPago y que salga el gasto |
| 5 | Aliases | Una transferencia a un destinatario conocido ya sale categorizada |
| 6 | Consultas | Preguntarle al bot cuánto se gastó en una categoría |

### Rebanada 1 — Un gasto escrito, punta a punta

Es la más grande y **no se puede adelgazar**: el schema nuevo rompe la
compilación de todas las páginas que sobreviven, porque usan `shares`, `groupId`
y `splitMode`. La demolición y el arreglo de esos archivos entran acá por
necesidad, no por inflación de alcance. No hay forma de tener un gasto andando
punta a punta sobre un schema que no compila.

Incluye: schema completo de la sección 4 con `prisma db push`; borrado de todo lo
listado en la sección 11; arreglo de los archivos que sobreviven; `visibility.ts`
aplicado en `expenses` y `export`; `JWT_SECRET` obligatorio y `.env.example`;
vinculación por `/start`; webhook con secret, whitelist e idempotencia;
`AiProvider` + `parseMessage` limitado al intent `gasto`; confirmación en
Telegram; y el gasto visible en `/dashboard/expenses`.

El schema se aplica **completo** desde el principio, con los campos que las
rebanadas siguientes van a usar (`botMessageId`, `recurringPeriod`, `Alias`,
`ProcessedUpdate`), para no volver a migrar en cada rebanada.

### Rebanadas 2 a 6

Cada una suma una capacidad sobre una base que ya funciona:

- **2 — Correcciones.** Intent `correccion`, botones inline con `expenseId` en el
  `callback_data`, resolución por reply vía `botMessageId` y por último gasto vía
  `createdById`, y la comprobación de permiso de edición de la sección 5.
- **3 — Recurrentes y gráficos.** `recurring-materialize.ts`, la reescritura de
  `stats/route.ts` y la tendencia de 12 meses.
- **4 — Comprobantes.** `OcrEngine` con el backend WASM y el fallback a pedir el
  monto por texto.
- **5 — Aliases.** Lookup, normalización, inyección en el prompt y el aprendizaje
  automático al corregir. Depende de la rebanada 2: sin correcciones no hay de
  qué aprender.
- **6 — Consultas.** Intent `consulta` y `queries/aggregate.ts`.

La documentación de la sección 14 se actualiza en la rebanada que la invalida,
no al final: `CLAUDE.md` y `docs/data-models.md` en la 1, el resto a medida.

---

## Enmienda 1 — Semántica de cuotas (decidida 2026-08-23, Rebanada 3)

La Rebanada 1 dejó las dos rutas de lectura en desacuerdo, y el usuario lo notó
a los cinco minutos de usar la app: el listado contaba un gasto en cuotas en cada
mes que vence una cuota, mientras los gráficos lo contaban entero en el mes de la
compra. El mismo mes daba dos totales distintos, sin forma de reconciliarlos.

**Decisión: semántica de FLUJO en las dos rutas.** Lo que se muestra en un mes es
lo que efectivamente se paga en ese mes:

- Un gasto sin cuotas cuenta por su monto, en el mes de su `date`.
- Un gasto en cuotas cuenta por el monto de la cuota, en el mes del `dueDate` de
  esa cuota — no por su monto total, y no en el mes de la compra.

Razón: es la pregunta que una pareja se hace de verdad ("cuánto estamos pagando
este mes"), no "cuánto nos comprometimos". Y es la semántica que el listado ya
usaba, así que alinear los gráficos hacia ella conserva la vista de "qué cuotas
me vencen" en vez de perderla.

**Consecuencia aceptada:** los gráficos históricos cambian. Los meses con compras
grandes bajan y los siguientes suben. En marzo 2026, sobre datos reales, el total
pasa de $2.397.806 a $2.301.704. El usuario aprobó el cambio con esos números a
la vista.

Alcance: 9 de 386 gastos tienen cuotas, pero son los de mayor monto (televisor
$309.999 en 6, aspiradora $250.000 en 12, árbol de navidad $160.000 en 3).

Esto reemplaza lo que la sección 10 decía sobre `stats`, y el ítem del backlog
que se marcaba como completo era falso para una de las dos rutas.
