# Grupos

## Concepto

Un grupo permite organizar gastos compartidos entre un conjunto de personas con porcentajes definidos. El dueño del grupo lo administra y puede agregar/modificar miembros.

## Modelos

### Group
- `name`: nombre del grupo
- `ownerId`: usuario que creó el grupo
- `members`: lista de `GroupMember`
- `expenses`: gastos puntuales asociados al grupo
- `recurring`: gastos recurrentes asociados al grupo

### GroupMember
- `groupId` + `userId`: par único (un usuario no puede estar dos veces en el mismo grupo)
- `percentage`: porcentaje del gasto que le corresponde a este miembro
- Los porcentajes de todos los miembros deben sumar ~100%

## Reglas

- El dueño siempre es incluido como miembro al crear el grupo
- Los porcentajes deben sumar 100% (±1% de tolerancia)
- Cuando se asigna un gasto a un grupo sin especificar shares manualmente, se usan los porcentajes de `GroupMember`

## API endpoints

- `GET /api/groups` — Lista grupos donde el usuario es owner o miembro
- `POST /api/groups` — Crear grupo con miembros y porcentajes
- `GET /api/groups/[id]` — Detalle del grupo
- `PUT /api/groups/[id]` — Actualizar nombre del grupo
- `DELETE /api/groups/[id]` — Eliminar grupo
- `PUT /api/groups/[id]/members` — Reemplazar lista de miembros (elimina todos y recrea)
- `GET /api/groups/[id]/balance` — Balance neto acumulado entre miembros
- `GET /api/groups/[id]/summary?month=&year=` — Resumen mensual con estadísticas por miembro

## Páginas

- `/dashboard/groups` — Lista y gestión de grupos
- `/dashboard/groups/[id]` — Detalle: tabla de miembros con stats, balance de deudas, gastos del mes
