# Modelos de datos (Prisma + MongoDB)

8 modelos. El schema completo está en `prisma/schema.prisma`; esto es la
explicación de lo que significa cada campo no obvio.

Los IDs son ObjectId (`@db.ObjectId`). No hay migrations: se aplica con
`npx prisma db push`.

## User

Cuenta de usuario, con password hasheada con bcryptjs. Son **dos**, y el alta NO
es pública: `POST /api/auth/register` sólo acepta los emails de la allowlist
`HOUSEHOLD_EMAILS` y devuelve 403 al resto. Esa misma variable define **quién es
miembro del hogar**, que es la otra mitad de la regla de visibilidad — ver
`src/lib/household.ts` y el encabezado de `src/lib/visibility.ts`.

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
materialización — este último tiene además una versión **única y parcial** creada
a mano, ver [Pasos manuales en Mongo](#pasos-manuales-en-mongo).

### `PRIMER_PERIODO_MATERIALIZABLE`

Constante en `src/lib/recurring-materialize.ts`, valor `"2026-08"`. Es el
**piso** de la ventana de meses que la materialización automática puede crear;
el **techo** es el mes actual (en hora de Buenos Aires, no la del proceso —
ver `todayInBuenosAires` en `src/lib/ai/normalize.ts`). Fuera de esa ventana,
`materializeRecurringForMonth` no crea nada y devuelve `0`.

Es un mes fijo, no derivado de `RecurringExpense.createdAt`, y eso es
deliberado: las 10 plantillas reales se crearon en 2026-03, pero marzo a julio
de 2026 **ya contienen** el alquiler, los servicios, el seguro y la cochera
cargados a mano como `Expense` comunes. Derivar el piso de `createdAt`
materializaría esos cinco meses también y duplicaría el alquiler. `2026-08` es
el primer mes en el que los recurrentes dejaron de cargarse a mano.

El guard de `createdAt` (una plantilla no puede materializar un mes anterior a
su propia creación) sigue existiendo aparte y es complementario: cubre
plantillas creadas DESPUES del piso.

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
un `scope`. Lo escribe y lo lee `src/lib/aliases.ts`.

- `scope` acá es **nullable**: un alias puede no forzar el ámbito.
- `hits` cuenta los usos, para poder ordenar y para inyectar los más frecuentes
  en el prompt de la IA.
- **`pattern` es la clave natural del `upsert` con el que se aprende un
  alias.** No hay un id de negocio separado: la fila SE IDENTIFICA por su
  patrón, así que la corrección siguiente sobre el mismo patrón actualiza la
  misma fila (pisa `categoryId` y, si tocó el ámbito, `scope`) en vez de crear
  una segunda. Es lo que hace que un alias aprendido de una corrección
  equivocada no quede mal para siempre: la próxima corrección sobre esa misma
  descripción lo reemplaza.
- **`hits` es una heurística ordenadora, no un dato del dominio.** Nadie puede
  saber si la IA usó de verdad un alias para clasificar un gasto —el prompt lo
  ofrece como contexto, pero la decisión es de la IA—, así que `hits` cuenta
  una señal indirecta (el gasto quedó con la descripción de un alias Y con la
  categoría que ese alias predice). Sirve para decidir qué aliases sobreviven
  al tope que se inyecta en el prompt, no para ningún cálculo del negocio.

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

`@@index([processedAt])` está declarado **sólo** para que `db push` no dropee el
índice TTL que se crea a mano sobre esa misma clave: sin el TTL, esta colección
crece sin límite para siempre. Ver [Pasos manuales en
Mongo](#pasos-manuales-en-mongo).

Ver la §6 del [diseño](superpowers/specs/2026-08-22-gastos-bot-telegram-design.md).

## Pasos manuales en Mongo

Cosas que `prisma db push` no puede hacer y hay que hacer a mano en la base.

Los índices únicos de acá son la **misma familia de bug**: en MongoDB un campo
ausente se indexa como `null`, así que dos documentos a los que les falta el
campo colisionan entre sí en un índice único plano. Prisma no puede expresar
`sparse` ni `partialFilterExpression` en el schema, así que el índice se crea a
mano.

**Regla que atraviesa las tres secciones, y que se verificó a los golpes:
`prisma db push` DROPEA todo índice cuya clave no esté declarada en el schema, y
FALLA si encuentra uno con el nombre que él espera y opciones distintas.** Por
eso cada índice de abajo dice explícitamente qué nombre tiene que tener y por
qué. Los tres sobreviven a `db push` con los nombres que están acá, verificado en
tres pushes consecutivos (`already in sync`, sin cambios en `getIndexes()`).

Los tres están **ya aplicados** a la base de producción (2026-08-23). Lo que
sigue es el procedimiento para una base nueva, y la referencia para cuando algo
se rompa.

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

### Peligro nombrado: nunca escribir `null` en un campo `@unique`, ni con índice sparse

Cuarta aparición de la misma familia de bug en este proyecto (las otras tres:
el índice sparse de arriba, el `E11000` en `telegramChatId` durante el primer
`db push`, y el hallazgo de limpieza de la Tarea 9). Suficientemente repetido
como para nombrarlo aparte en vez de dejarlo disperso:

**En MongoDB, un índice único sparse ignora un documento donde el campo está
ausente, pero SÍ indexa un documento donde el campo vale `null` explícito.**
Escribir `null` con Prisma (`data: { campo: null }`) no deja el campo ausente
— lo deja presente con valor `null`, que el índice sparse indexa igual que
cualquier otro valor. Dos documentos con `null` explícito en el mismo campo
`@unique` colisionan entre sí exactamente como colisionarían con el mismo
string repetido.

Ejemplo real: el handler de `/start` en
`src/app/api/telegram/webhook/route.ts` limpia `telegramLinkCode` al vincular
un chat. Si lo hace con `telegramLinkCode: null`, el primer usuario que se
vincula deja un `null` explícito en su documento; cuando el segundo usuario
completa `/start`, Prisma intenta poner `null` también en el suyo, choca
contra el índice único sparse (`P2002`), el `update` completo tira, y el
código queda sin responder — silencio total en el flujo de vinculación, con
el segundo usuario bloqueado permanentemente sin saber por qué.

**Regla:** para vaciar un campo `String? @unique` (sparse o no), usar la
sintaxis de Prisma `{ unset: true }`, nunca `null`:

```ts
// MAL — dos "null" explícitos colisionan en el índice único sparse.
data: { telegramLinkCode: null }

// BIEN — el campo queda ausente, el índice sparse lo ignora.
data: { telegramLinkCode: { unset: true } }
```

Para confirmar que un campo quedó realmente ausente (no `null`), no alcanza
con leerlo por Prisma — Prisma normaliza "ausente" y "`null`" al mismo `null`
en JS. Hay que ir a Mongo crudo, por ejemplo con `$runCommandRaw` y un
chequeo de tipo:

```js
db.User.find({ telegramLinkCode: { $type: "null" } })  // debería ser []
```

Aplica a los dos campos de `User` con índice sparse (`telegramChatId` y
`telegramLinkCode`) y a cualquier otro campo `@unique` que se agregue más
adelante.

### Índice TTL en ProcessedUpdate (OBLIGATORIO — sin esto la tabla crece sin límite)

`ProcessedUpdate` es la tabla de idempotencia del webhook: **una fila por cada
update de Telegram, para siempre**. Nada la borra desde el código, a propósito —
borrar filas a mano reabre la ventana de duplicados. El TTL es lo único que la
acota.

**`expireAfterSeconds: 604800` (7 días).** La ventana que hay que cubrir es la de
reintentos de Telegram, que se mide en minutos y a lo sumo horas: pasado eso
Telegram abandona el update y ya no hay nada que deduplicar. 7 días deja un
margen enorme para mirar un incidente a mano y no cuesta nada en volumen (una
fila de ~100 bytes por update).

**El índice tiene que llamarse `ProcessedUpdate_processedAt_idx`**, que es
exactamente el nombre que Prisma genera para el `@@index([processedAt])` que está
declarado en el schema. Las dos mitades de esa frase son necesarias, y las dos se
descubrieron rompiéndolo:

- **Sin `@@index([processedAt])` en el schema**, el TTL desaparece en el próximo
  `db push`, con este plan y sin ninguna advertencia:

  ```
  Applying the following changes:
  [-] Index `ProcessedUpdate_processedAt_ttl`
  ```

  Un índice dropeado en silencio es el peor resultado posible acá: la app sigue
  andando igual y la tabla vuelve a crecer sin límite sin que nada avise.

- **Con el `@@index` declarado pero el TTL con OTRO nombre**, Prisma crea su
  índice plano sobre la misma clave y MongoDB después rechaza el TTL con el
  código **85 (`IndexOptionsConflict`)**: «An equivalent index already exists
  with a different name and options». No se puede tener el plano y el TTL sobre
  la misma clave.

Con el nombre correcto pasa lo mismo que con los sparse de `User`: Prisma ve un
índice con el nombre y las claves que espera, no lo lista como cambio pendiente y
`db push` reporta `already in sync`.

```js
// Correr en mongosh, sobre la base de la app.
try {
  db.ProcessedUpdate.dropIndex("ProcessedUpdate_processedAt_idx");
  print("dropeado ProcessedUpdate_processedAt_idx");
} catch (e) {
  if (e.code === 27) {            // IndexNotFound: todavia no existia, todo bien
    print("ProcessedUpdate_processedAt_idx no existia");
  } else {
    throw e;                      // cualquier otra cosa NO se ignora
  }
}

db.ProcessedUpdate.createIndexes([
  {
    key: { processedAt: 1 },
    name: "ProcessedUpdate_processedAt_idx",   // el nombre que espera Prisma
    expireAfterSeconds: 604800,                // 7 dias
  },
]);

// Control: tiene que salir con expireAfterSeconds: 604800.
db.ProcessedUpdate.getIndexes();
```

**Cuándo hay que crearlo:** antes de poner el bot en producción. Si falta no
rompe nada —la idempotencia funciona igual— así que no hay ningún síntoma hasta
que la colección es enorme. Es exactamente el tipo de cosa que no se descubre a
tiempo.

### Índice único parcial en Expense (OBLIGATORIO antes de materializar recurrentes)

Sobre `(recurringExpenseId, recurringPeriod)`, para que la materialización de
recurrentes sea idempotente **a nivel base** y no sólo a nivel código: garantiza
un solo alquiler por mes aunque el job corra dos veces en paralelo. El índice que
crea `db push` es no-único, así que por sí solo no garantiza nada.

Necesita `partialFilterExpression` por la misma razón que los sparse de `User`:
si fuera un único plano, **los 386 gastos que no vienen de un recurrente
colisionan entre sí**, porque a todos les falta `recurringExpenseId` y MongoDB
los indexa a todos como `null`.

**El filtro va con `$exists: true`, NO con `$type: "objectId"`.** Los dos
funcionan en Mongo, pero `$type` deja el índice **imposible de inspeccionar desde
Prisma**: `$runCommandRaw({ listIndexes: "Expense" })` explota con
`Error: Unknown tagged value`, porque Prisma reserva `$type` para su propia
codificación de valores. O sea: el índice queda bien creado, y la herramienta con
la que se revisa todo lo demás deja de servir para verlo. Con `$exists: true`
alcanza, porque la regla de la sección anterior ya prohíbe escribir `null`
explícitos (verificado: hoy los 386 gastos tienen el campo **ausente**, ninguno
en `null`).

**El índice tiene que llamarse distinto del que genera Prisma**
(`Expense_recurringExpenseId_recurringPeriod_idx`). Acá el truco de los sparse de
`User` **no** funciona, porque el schema declara ese índice como `@@index` (no
único) y el de la base es único y parcial: con el nombre de Prisma, `db push`
falla en seco y no aplica nada:

```
Error: MongoDB error
Kind: Command failed: Error code 86 (IndexKeySpecsConflict): An existing index
has the same name as the requested index.
```

Con un nombre propio, `db push` crea su índice plano al lado y **deja el parcial
intacto** (verificado en tres pushes consecutivos). El costo es un índice plano
redundante sobre la misma clave, que en esta colección no se nota.

```js
// Correr en mongosh, sobre la base de la app.
try {
  db.Expense.dropIndex("Expense_recurring_period_unique_partial");
  print("dropeado Expense_recurring_period_unique_partial");
} catch (e) {
  if (e.code === 27) {            // IndexNotFound
    print("Expense_recurring_period_unique_partial no existia");
  } else {
    throw e;
  }
}

db.Expense.createIndexes([
  {
    key: { recurringExpenseId: 1, recurringPeriod: 1 },
    // NO usar Expense_recurringExpenseId_recurringPeriod_idx: ese nombre lo
    // espera Prisma para el @@index no-unico y `db push` falla con el 86.
    name: "Expense_recurring_period_unique_partial",
    unique: true,
    partialFilterExpression: { recurringExpenseId: { $exists: true } },
  },
]);

// Control: unique:true y el partialFilterExpression con $exists.
db.Expense.getIndexes();
```

## Modelos que existieron y ya no

`MonthlyIncome`, `Group`, `GroupMember`, `ExpenseShare`, `RecurringShare`,
`Budget`, `RecurringExpensePeriod` y `PeriodShare`. Eran el motor de los gastos
compartidos con split proporcional al sueldo y balance de deudas entre pares, un
dominio que dejó de existir.

Las colecciones se dropearon de la base en `scripts/backfill-rebanada1.ts`. Si
aparece una referencia a cualquiera de esos modelos en el código o en los docs,
es residuo.
