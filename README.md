# Expense Tracker

Tracker de gastos de un hogar de dos personas. La ingesta principal es un **bot
de Telegram**: se le manda "12 lucas panadería" y el gasto queda cargado, con
monto, fecha y categoría inferidos. La web es donde se consulta y se corrige.

Construido con Next.js 16, Prisma y MongoDB.

## Caracteristicas

- Carga de gastos por Telegram, con parseo del mensaje por IA (Grok / xAI)
- OCR de comprobantes de transferencia, detrás de una interfaz intercambiable
  (`tesseract.js` en Vercel, binario nativo en el VPS)
- Autenticacion con JWT en cookie httpOnly
- CRUD de gastos con categorias, tarjetas de crédito y cuotas
- Gastos recurrentes que se materializan mes a mes
- Ambito `casa` / `personal`: los de casa los ven los dos, los personales sólo
  quien pagó
- Dashboard con graficos (Recharts)
- Exportacion a CSV

## Tech Stack

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4
- **Backend:** Next.js API Routes
- **Base de datos:** MongoDB + Prisma ORM
- **Ingesta:** Telegram Bot API
- **IA:** Grok (xAI)
- **OCR:** Tesseract
- **Graficos:** Recharts

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

## Base de Datos

```bash
# Sincronizar el schema con la base
npx prisma db push
npx prisma generate

# Sembrar las categorias iniciales
node --env-file=.env scripts/seed-categories.ts
```

Hay índices que Prisma no puede expresar y se crean a mano; sin ellos el primer
`db push` puede fallar. Ver
[docs/data-models.md](docs/data-models.md#pasos-manuales-en-mongo).

## Desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) en el navegador.

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
