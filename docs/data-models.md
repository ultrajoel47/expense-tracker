# Modelos de datos (Prisma + MongoDB)

## User
Cuenta de usuario con autenticación por email/password (bcryptjs). Relacionado con todos los demás modelos.

## Expense
Gasto puntual de un usuario.
- `userId`: quién pagó (siempre paga el 100%)
- `isShared`: si el gasto es compartido con otros
- `splitMode`: "auto" | "manual"
- `groupId`: grupo opcional al que pertenece
- `shares`: lista de `ExpenseShare`

## ExpenseShare
Representa la parte que le corresponde a un participante en un `Expense`.
- `expenseId`, `userId`: par único
- `percentage`: porcentaje asignado
- `amount`: monto calculado = `expense.amount * percentage / 100`
- El pagador del gasto **nunca tiene un share propio** — los shares son de los otros participantes

## RecurringExpense
Gasto recurrente (DAILY / WEEKLY / MONTHLY / YEARLY).
- `userId`: creador del registro
- `payerId`: quién realmente paga (puede diferir del creador). Si es null, se usa `userId`
- `isShared`, `splitMode`, `groupId`: igual que `Expense`
- `shares`: lista de `RecurringShare`

## RecurringShare
Equivalente a `ExpenseShare` pero para gastos recurrentes.

## RecurringExpensePeriod
Instancia histórica de un gasto recurrente para un período específico.
- `shares`: lista de `PeriodShare`

## PeriodShare
Equivalente a `ExpenseShare` pero para un período de recurrente.

## Group / GroupMember
Ver [groups.md](./groups.md).

## MonthlyIncome
Ingreso mensual de un usuario, usado para el split automático proporcional.
- `userId`, `month`, `year`: clave única
- `amount`: ingreso del mes

## Budget
Presupuesto mensual por categoría y usuario.

## Category
Categoría de gasto con ícono y color.

## CreditCard
Tarjeta de crédito asociada a gastos y recurrentes.
