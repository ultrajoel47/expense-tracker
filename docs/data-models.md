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
como string) es único: si el mismo update llega dos veces —y Telegram reintenta—
el segundo se descarta y no se duplica el gasto.

## Pasos manuales en Mongo

Cosas que `prisma db push` no puede hacer y hay que hacer a mano en la base.

### Índices únicos sparse en User (obligatorio)

`User.telegramChatId` y `User.telegramLinkCode` son opcionales y únicos. Prisma
genera un índice único **plano**, y MongoDB indexa el campo ausente como `null`:
con dos usuarios sin vincular, los dos indexan `null` y el índice falla al
crearse con `E11000 duplicate key error ... dup key: { telegramChatId: null }`.

Prisma no puede expresar `sparse` en el schema, así que los índices se crean a
mano con **exactamente los nombres que Prisma espera**. Prisma los acepta como
equivalentes y `db push` queda en sync:

```js
db.User.createIndexes([
  { key: { telegramChatId: 1 },   name: "User_telegramChatId_key",   unique: true, sparse: true },
  { key: { telegramLinkCode: 1 }, name: "User_telegramLinkCode_key", unique: true, sparse: true },
]);
```

Si se levanta la base desde cero, hay que crearlos **antes** del primer
`db push`, o el push va a fallar en cuanto exista más de un usuario sin vincular.

### Índice TTL en ProcessedUpdate

`processedAt` con TTL, para que la tabla de idempotencia no crezca sin límite.

### Índice único parcial en Expense

Sobre `(recurringExpenseId, recurringPeriod)`, filtrando los documentos donde
`recurringExpenseId` no es `null`, para que la materialización de recurrentes sea
idempotente a nivel base y no sólo a nivel código. El índice que crea `db push`
es no-único.

## Modelos que existieron y ya no

`MonthlyIncome`, `Group`, `GroupMember`, `ExpenseShare`, `RecurringShare`,
`Budget`, `RecurringExpensePeriod` y `PeriodShare`. Eran el motor de los gastos
compartidos con split proporcional al sueldo y balance de deudas entre pares, un
dominio que dejó de existir.

Las colecciones se dropearon de la base en `scripts/backfill-rebanada1.ts`. Si
aparece una referencia a cualquiera de esos modelos en el código o en los docs,
es residuo.
