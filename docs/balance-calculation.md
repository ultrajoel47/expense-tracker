# Cálculo de balance

## Algoritmo: ledger con net settlement

El balance entre miembros de un grupo se calcula en `src/app/api/groups/[id]/balance/route.ts`.

### Paso 1: Construir el ledger

Para cada gasto compartido del grupo:
- El pagador es el **acreedor** (le deben)
- Los shares son los **deudores** (deben)

```
ledger[debtorId][creditorId] += share.amount
```

Se procesa tanto gastos puntuales como recurrentes.

### Paso 2: Netting entre pares

Para cada par (A, B) se calcula la diferencia neta:
- Si A debe $50 a B y B debe $20 a A → A debe $30 neto a B
- Se procesa cada par una sola vez usando un Set de claves ordenadas

### Paso 3: Resultado

Se retorna una lista de `{ debtorId, debtorName, creditorId, creditorName, amount }` con las deudas netas mayores a $0.01.

## Regla de variabilidad del balance

Cuando **cualquier integrante** paga un gasto compartido (puntual o recurrente), ese pago se refleja en el ledger:
- El pagador se convierte en acreedor por el monto que los demás deben
- Los demás acumulan deuda hacia ese pagador
- El balance neto se recalcula automáticamente considerando todos los cruces

Ejemplo:
- A paga $100, B debe $40 → ledger[B][A] = $40
- B paga $60, A debe $30 → ledger[A][B] = $30
- Neto: A debe $10 a B (40 - 30 = 10)

## Resumen de miembro (summary API)

El endpoint `GET /api/groups/[id]/summary` calcula por miembro:
- **totalPaid**: suma de gastos donde el miembro es pagador (monto completo)
- **totalCharged**: suma de sus shares asignados (lo que le corresponde pagar)
- **netBalance**: `totalPaid - totalCharged`
  - Positivo → el miembro adelantó más de lo que le tocaba (le deben)
  - Negativo → el miembro pagó menos de lo que le corresponde (debe)

Este resumen es filtrado por mes/año. El balance de deudas acumuladas es histórico (sin filtro de fecha).
