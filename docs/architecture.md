# Arquitectura del proyecto

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js (App Router) + React |
| Estilos | Tailwind CSS |
| Base de datos | MongoDB vía Prisma ORM |
| Auth | JWT custom (`src/lib/auth.ts`) |
| Charts | Recharts |

## Estructura de carpetas

```
src/
├── app/
│   ├── (auth)/              # Rutas públicas: login, registro
│   ├── (dashboard)/         # Rutas protegidas del dashboard
│   │   └── dashboard/
│   │       ├── expenses/    # Gestión de gastos
│   │       ├── categories/  # Categorías
│   │       ├── budgets/     # Presupuestos
│   │       ├── credit-cards/ # Tarjetas de crédito
│   │       ├── income/      # Ingresos mensuales
│   │       ├── recurring/   # Gastos recurrentes
│   │       ├── groups/      # Grupos de gastos compartidos
│   │       │   └── [id]/    # Detalle de grupo
│   │       └── shared/      # Resumen de gastos compartidos del usuario
│   └── api/                 # API routes de Next.js
│       ├── auth/            # Login, registro, logout, me
│       ├── expenses/        # CRUD + stats + shares
│       ├── groups/          # CRUD + balance + summary + members
│       ├── recurring-expenses/ # CRUD + periods + shares
│       └── shared/          # Vista consolidada de shares del usuario
├── lib/
│   ├── auth.ts              # Utilidades JWT y getSession()
│   └── prisma.ts            # Singleton de Prisma client
└── prisma/
    └── schema.prisma        # Modelos de la base de datos
```

## Patrones clave

- **API Routes**: Cada ruta valida sesión con `getSession()` al inicio. Retorna JSON con errores en español.
- **Auth**: Token JWT en cookie httpOnly. `getSession()` decodifica y retorna `{ id, email, name }`.
- **Prisma**: Se usa el singleton en `src/lib/prisma.ts` para evitar múltiples conexiones.
- **Sin migrations**: MongoDB no requiere migraciones, se usa `prisma db push` para sincronizar el schema.
