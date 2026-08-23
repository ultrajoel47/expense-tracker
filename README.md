# Expense Tracker

Tracker de gastos de un hogar de dos personas. La ingesta principal es un **bot
de Telegram**: se le manda "12 lucas panadería" y el gasto queda cargado, con
monto, fecha y categoría inferidos. La web es donde se consulta y se corrige.

Construido con Next.js 16, Prisma y MongoDB.

## Caracteristicas

- Carga de gastos por Telegram, con parseo del mensaje por IA (Groq, con xAI/Grok
  como alternativa detrás de la misma interfaz)
- Corrección de un gasto desde el propio chat: por los botones de la
  confirmación (cambiar el ámbito, la categoría, o borrar con un segundo tap
  de confirmación), o por texto libre ("eso fue personal", "en realidad fueron
  15 lucas") apuntando al gasto por reply o, si no hay reply, al último que
  esa persona registró
- Autenticacion con JWT en cookie httpOnly, y registro cerrado por allowlist de
  emails (`HOUSEHOLD_EMAILS`)
- CRUD de gastos con categorias, tarjetas de crédito y cuotas
- Ambito `casa` / `personal`: los de casa los ven los dos miembros del hogar, los
  personales sólo quien pagó
- Gastos recurrentes: plantillas administradas desde `dashboard/recurring/`, con
  materialización automática mensual (perezosa, al leer un mes se crean los
  `Expense` que falten — ver `src/lib/recurring-materialize.ts`)
- Dashboard con graficos (Recharts)
- Exportacion a CSV

Todavía **no** está, aunque el diseño lo contempla: el OCR de comprobantes por
foto, y las consultas por el bot ("cuánto gasté este mes en comida" sigue
contestando que todavía no puede responder preguntas — ver
`consulta_no_soportada` y `src/lib/queries/` en
[docs/architecture.md](docs/architecture.md)). Ver
[docs/features-backlog.md](docs/features-backlog.md).

## Tech Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4
- **Backend:** Next.js API Routes
- **Base de datos:** MongoDB + Prisma ORM
- **Ingesta:** Telegram Bot API
- **IA:** Groq (default) o Grok/xAI, seleccionable con `AI_PROVIDER`
- **Graficos:** Recharts

## Requisitos

- **Node.js >= 22.18.** Todos los scripts de `scripts/` y los tests se corren
  directamente en TypeScript (`node scripts/x.ts`), que necesita el type
  stripping nativo estable de esa versión. Está declarado en `engines` del
  `package.json`.

## Instalacion

```bash
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales
```

## Variables de Entorno

Ver [`.env.example`](.env.example) para la plantilla completa. `DATABASE_URL` y
`JWT_SECRET` son **obligatorias**: la app no arranca sin ellas.

`HOUSEHOLD_EMAILS` (la allowlist de emails que pueden tener cuenta) es
obligatoria **en produccion**: sin ella el registro se cierra por completo y
nadie ve los gastos de casa. Fuera de produccion, si no está, no restringe nada.

## Base de Datos

```bash
# Sincronizar el schema con la base
npx prisma db push
npx prisma generate

# Sembrar las categorias iniciales
node --env-file=.env scripts/seed-categories.ts
```

Hay índices que Prisma no puede expresar y se crean a mano; sin ellos el primer
`db push` puede fallar, y el TTL de idempotencia no existe. Ver
[docs/data-models.md](docs/data-models.md#pasos-manuales-en-mongo).

## Desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) en el navegador.

Para probar el bot en local sin túnel ni webhook:

```bash
node --env-file=.env scripts/telegram-poll.ts
```

Hace long polling contra la Bot API y reenvía cada update al webhook local.
`getUpdates` y un webhook son **mutuamente excluyentes**, así que el script se
niega a arrancar si el bot tiene un webhook registrado.

## Deploy

1. **Variables de entorno en el hosting.** `DATABASE_URL`, `JWT_SECRET`,
   `HOUSEHOLD_EMAILS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
   `AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL` y (opcional)
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. **`TELEGRAM_API_BASE_URL` se deja sin
   definir**: es sólo para pruebas locales contra un mock.

2. **Los índices manuales de Mongo**, si la base es nueva. Ver
   [docs/data-models.md](docs/data-models.md#pasos-manuales-en-mongo).

3. **Registrar el webhook del bot.** Sin este paso el bot desplegado no recibe
   nada, y sin `secret_token` recibe todo pero contesta 401 a cada update:

   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://TU-DOMINIO.vercel.app/api/telegram/webhook",
       "secret_token": "EL_MISMO_VALOR_QUE_TELEGRAM_WEBHOOK_SECRET",
       "allowed_updates": ["message"],
       "drop_pending_updates": true
     }'
   ```

   - `secret_token` tiene que ser **byte a byte igual** a
     `TELEGRAM_WEBHOOK_SECRET` en el hosting. El webhook compara el header
     `X-Telegram-Bot-Api-Secret-Token` con esa variable y devuelve 401 si no
     coincide, o si la variable no está configurada. El síntoma es un bot que
     parece muerto: Telegram entrega, la app rechaza y nadie ve un error.
   - `drop_pending_updates` descarta la cola acumulada mientras no había
     webhook. Sin esto, el primer deploy procesa todos los mensajes viejos.
   - Registrar un webhook es **global por bot**: pisa cualquier otro que haya.

   Verificar:

   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
   ```

   Tiene que devolver la `url` correcta, `has_custom_certificate: false`,
   `pending_update_count: 0` y **ningún** `last_error_message`.

4. **Para volver a probar en local**, liberar el webhook (Telegram no entrega por
   `getUpdates` mientras haya uno activo):

   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/deleteWebhook"
   ```

## Verificacion

```bash
npx tsc --noEmit
npm run build
npm test
```

## Documentacion

- [CLAUDE.md](CLAUDE.md) — contexto y reglas de dominio
- [docs/architecture.md](docs/architecture.md) — estructura y los seams de ingesta/IA/OCR
- [docs/data-models.md](docs/data-models.md) — los 8 modelos de Prisma
- [docs/features-backlog.md](docs/features-backlog.md) — backlog pendiente
