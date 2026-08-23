# Modelos de datos (Prisma + MongoDB)

8 modelos. El schema completo está en `prisma/schema.prisma`; esto es la
explicación de lo que significa cada campo no obvio.

Los IDs son ObjectId (`@db.ObjectId`). No hay migrations: se aplica con
`npx prisma db push`.

## User

Cuenta de usuario, con password hasheada con bcryptjs. Son **dos** y no hay alta
pública prevista más allá del registro existente.

- `telegramChatId` — el chat de Telegram vinculado. `null` hasta que la persona
  hace `/start`. Es la whitelist: un update de un chat que no matchea ningún
  usuario se ignora en silencio.
- `telegramLinkCode` — código de un solo uso que la web genera para vincular el
  chat. Se consume en el `/start`.

Relaciones con `Expense`: **dos**, no una. `expensesPaid` (por `userId`) y
`expensesCreated` (por `createdById`).

## Category

Categoría de gasto con ícono y color. `name` es único, y es la clave con la que
`scripts/seed-categories.ts` hace upsert.

No se borran ni renombran categorías con gastos apuntando a ellas: rompería la
relación. La semilla agrega las que faltan y deja intactas las existentes.

## Expense

El modelo central. Un gasto puntual.

- `userId` — **quién pagó**. Es informativo: no se calcula ninguna deuda a partir
  de él. No significa "el dueño del registro", que es lo que significaba en el
  modelo viejo de gastos compartidos.
- `createdById` — **quién lo registró**. Puede diferir de `userId` cuando una
  persona carga un gasto que pagó la otra. Es lo que permite resolver "mi último
  gasto" para corregirlo, y lo que habilita `canEditViaBot`.
- `scope` — `"casa"` | `"personal"`. Gobierna la visibilidad: los de casa los ven
  los dos, los personales sólo quien pagó. Lo infiere la IA al parsear el
  mensaje. Ver `src/lib/visibility.ts`.
- `source` — `"bot"` | `"web"` | `"recurring"`. De dónde salió el gasto.
- `totalInstallments` — cantidad de cuotas, o `null`. Si es `> 1`, hay
  `Installment` asociadas y el gasto se imputa por `installment.dueDate`, no por
  `expense.date`.
- `recurringExpenseId` + `recurringPeriod` — materialización de un recurrente.
  `recurringPeriod` es `"2026-08"`. El par es la clave de idempotencia: garantiza
  un solo alquiler por mes aunque la materialización corra varias veces.
- `botChatId` + `botMessageId` — el mensaje de confirmación en Telegram. Es lo
  que permite resolver una corrección hecha por reply sobre ese mensaje.
  `botMessageId` se graba en un update posterior, porque el `message_id` sólo
  existe después de mandar el mensaje.

Índices: `[scope, userId, date]` para las lecturas con visibilidad,
`[botChatId, botMessageId]` para resolver correcciones por reply, y
`[recurringExpenseId, recurringPeriod]` para la idempotencia de la
materialización.

## Installment

Cuota de un gasto en cuotas. `[expenseId, installmentNumber]` es único.

`dueDate` es la fecha que importa para imputar el gasto a un mes: una compra en
12 cuotas aparece con su monto parcial en 12 meses distintos, no entera en el mes
de la compra.

## CreditCard

Tarjeta asociada a gastos y recurrentes. `lastFour` es opcional.

## RecurringExpense

Plantilla de un gasto que se repite (`DAILY` / `WEEKLY` / `MONTHLY` / `YEARLY`).

- `userId` — quién lo paga habitualmente.
- `scope` — igual que en `Expense`.
- `nextDue` — próximo vencimiento. `active` permite pausarlo sin borrarlo.

Es una **plantilla**: los gastos reales que genera son `Expense` con
`recurringExpenseId` y `recurringPeriod` seteados y `source: "recurring"`. La
plantilla en sí no entra en ningún total.

## Alias

Aprendizaje de categorización. Un `pattern` normalizado (minúsculas, sin
acentos) que mapea a una categoría, y opcionalmente a una descripción linda y a
un `scope`.

- `scope` acá es **nullable**: un alias puede no forzar el ámbito.
- `hits` cuenta los usos, para poder ordenar y para inyectar los más frecuentes
  en el prompt de la IA.

## ProcessedUpdate

Idempotencia del webhook de Telegram. `updateId` (el `update_id` de Telegram,
como string) es único.

**El orden es parte del mecanismo, no un detalle.** El `update_id` se inserta
**ANTES** de procesar el update, y **la violación del índice único ES la señal de
reintento**: si el insert falla con `E11000`, ese update ya se está procesando (o
se procesó), así que se descarta y se responde `200`.

Insertarlo *después* de procesar no sirve, y es el error natural de cometer.
Telegram reintenta cuando el webhook tarda, y OCR con WASM más una llamada a Grok
puede tardar 15-20s en Vercel Hobby: en esa ventana el registro todavía no
existiría, el reintento pasaría el chequeo y **el gasto se cargaría dos veces**.
Es justamente el bug que este modelo existe para evitar.

Ver la §6 del [diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md).

## Pasos manuales en Mongo

Cosas que `prisma db push` no puede hacer y hay que hacer a mano en la base.

Las tres son la **misma familia de bug**: en MongoDB un campo ausente se indexa
como `null`, así que dos documentos a los que les falta el campo colisionan entre
sí en un índice único plano. Prisma no puede expresar `sparse` ni
`partialFilterExpression` en el schema, así que el índice se crea a mano.

### Índices únicos sparse en User (OBLIGATORIO — la app se rompe sin esto)

`User.telegramChatId` y `User.telegramLinkCode` son `String?  @unique`. Los dos
índices **tienen que existir en la base como `unique: true, sparse: true`**, con
exactamente estos nombres.

**Hay que borrar el índice plano antes de crear el sparse.** `createIndexes` con
un nombre que ya existe y opciones distintas **no lo reemplaza**: MongoDB lo
rechaza con `IndexOptionsConflict` (código 85) y el índice plano queda como
estaba. Y en una base nueva el plano casi siempre ya está, porque lo creó el
primer `prisma db push` sobre la colección vacía (con 0 o 1 usuario no hay
colisión, así que el push pasa sin problema). Por eso el procedimiento es
**drop-then-recreate**, no `createIndexes` a secas.

El `dropIndex` tiene que tolerar que el índice todavía no exista
(`IndexNotFound`, código 27) — pasa si `db push` nunca corrió, o si un push
anterior abortó **durante** ese index build y lo dejó sin crear:

```js
// Correr en mongosh, sobre la base de la app.
for (const name of ["User_telegramChatId_key", "User_telegramLinkCode_key"]) {
  try {
    db.User.dropIndex(name);
    print(`dropeado ${name}`);
  } catch (e) {
    if (e.code === 27) {          // IndexNotFound: todavia no existia, todo bien
      print(`${name} no existia`);
    } else {
      throw e;                    // cualquier otra cosa NO se ignora
    }
  }
}

db.User.createIndexes([
  { key: { telegramChatId: 1 },   name: "User_telegramChatId_key",   unique: true, sparse: true },
  { key: { telegramLinkCode: 1 }, name: "User_telegramLinkCode_key", unique: true, sparse: true },
]);

// Control: los dos tienen que salir con unique:true y sparse:true.
db.User.getIndexes();
```

**Cuándo hay que crearlos en una base nueva: antes de que se registre el SEGUNDO
usuario.** No es "antes del primer `db push`" — con un solo usuario sin vincular
hay un único `null` y el índice único plano se crea sin problema. Lo que colisiona
es la **segunda registración**: ahí hay dos documentos con `telegramChatId`
ausente, los dos se indexan como `null`, y salta:

```
E11000 duplicate key error collection: expense-tracker.User
index: User_telegramChatId_key dup key: { telegramChatId: null }
```

Según el orden, eso rompe el `db push` (si los usuarios ya estaban) o rompe el
`POST /api/auth/register` del segundo usuario (si el índice plano ya estaba). Con
los sparse creados, ninguno de los dos falla.

**Por qué `@unique` se queda en el schema.** Podría parecer que la solución es
sacar `@unique` y crear el índice a mano — no funciona: **`db push` borra los
índices que no están declarados en el schema**, así que el sparse desaparecería en
el push siguiente. Declarado, Prisma ve un índice con el nombre y las claves que
espera y lo deja intacto: no lo lista como cambio pendiente y `db push` reporta
`already in sync`. Verificado en tres pushes consecutivos.

### Índice TTL en ProcessedUpdate

`processedAt` con TTL, para que la tabla de idempotencia no crezca sin límite.

### Índice único parcial en Expense

Sobre `(recurringExpenseId, recurringPeriod)`, con un
`partialFilterExpression` que excluya los documentos donde `recurringExpenseId`
es `null` — si no, todos los gastos que no vienen de un recurrente colisionan
entre sí, que es exactamente el mismo problema que en `User`. Sirve para que la
materialización de recurrentes sea idempotente a nivel base y no sólo a nivel
código. El índice que crea `db push` es no-único.

## Modelos que existieron y ya no

`MonthlyIncome`, `Group`, `GroupMember`, `ExpenseShare`, `RecurringShare`,
`Budget`, `RecurringExpensePeriod` y `PeriodShare`. Eran el motor de los gastos
compartidos con split proporcional al sueldo y balance de deudas entre pares, un
dominio que dejó de existir.

Las colecciones se dropearon de la base en `scripts/backfill-rebanada1.ts`. Si
aparece una referencia a cualquiera de esos modelos en el código o en los docs,
es residuo.
