# Gastos compartidos

## Concepto central

Cuando un usuario crea un gasto compartido, **paga el 100% del monto**. Los shares registran la parte que le corresponde a cada otro participante. No existe liquidación: el sistema es puramente informativo sobre quién pagó qué y cuánto le corresponde a cada uno.

## Tipos de gastos que se pueden compartir

- **Gastos puntuales** (`Expense` + `ExpenseShare`)
- **Gastos recurrentes** (`RecurringExpense` + `RecurringShare`)

## Modos de split

### Auto (proporcional al ingreso)
- Calcula la proporción según `MonthlyIncome` del mes actual de cada participante
- Si algún participante no tiene ingreso registrado, se divide en partes iguales
- Se aplica por defecto cuando `splitMode = "auto"`

### Manual
- El usuario define explícitamente el porcentaje de cada participante
- Los porcentajes deben sumar ~100% (tolerancia ±1%)

### Por grupo
- Si se asocia un gasto a un grupo (`groupId`) sin shares explícitos, se usan los porcentajes definidos en `GroupMember`

## Reglas importantes

- **El pagador nunca aparece en sus propios shares**: los shares solo representan lo que los otros deben
- Los shares almacenan `percentage` y `amount` calculado = `totalAmount * percentage / 100`
- El campo `payerId` en `RecurringExpense` permite que el pagador sea distinto al creador del registro
- No existe el concepto de "liquidado" — no hay campo `settled` ni forma de marcar pagos

## API endpoints relacionados

- `POST /api/expenses` — Crea un gasto con shares opcionales
- `POST /api/recurring-expenses` — Crea recurrente con shares opcionales
- `GET /api/shared` — Devuelve todos los shares del usuario actual (como deudor)
- `GET /api/expenses/[id]/shares` — Devuelve los shares de un gasto específico
