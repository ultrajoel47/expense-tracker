import assert from "node:assert/strict";
import { ensureRecurringPeriodsForMonth, getPeriodMonthStart } from "../src/lib/recurring-periods.ts";

function createPrismaMock() {
  const createdPeriods = [];
  const createdShares = [];

  const recurringExpenses = [
    {
      id: "rec-1",
      userId: "payer-1",
      payerId: null,
      categoryId: "cat-1",
      groupId: "group-1",
      amount: 1000,
      description: "Alquiler",
      frequency: "MONTHLY",
      splitMode: "manual",
      nextDue: new Date(2026, 2, 18),
      createdAt: new Date(2026, 0, 10),
      shares: [{ userId: "user-2", percentage: 40, amount: 400 }],
    },
  ];

  const existingPeriods = [];

  const prisma = {
    recurringExpense: {
      findMany: async ({ where }) =>
        recurringExpenses.filter(
          (rec) => (!where.groupId || rec.groupId === where.groupId) && rec.nextDue < where.nextDue.lt
        ),
    },
    recurringExpensePeriod: {
      findMany: async ({ where }) =>
        existingPeriods.filter(
          (period) =>
            (!where.recurringExpenseId || period.recurringExpenseId === where.recurringExpenseId) &&
            period.periodStart >= where.periodStart.gte &&
            period.periodStart < where.periodStart.lt
        ),
      create: async ({ data }) => {
        const created = { id: `period-${createdPeriods.length + 1}`, ...data };
        createdPeriods.push(created);
        existingPeriods.push(created);
        return created;
      },
    },
    periodShare: {
      createMany: async ({ data }) => {
        createdShares.push(...data);
        return { count: data.length };
      },
    },
    $transaction: async (callback) => callback(prisma),
  };

  return { createdPeriods, createdShares, prisma };
}

async function run() {
  const start = getPeriodMonthStart(2026, 4);
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 3);
  assert.equal(start.getDate(), 1);

  const mock = createPrismaMock();
  const createdFirst = await ensureRecurringPeriodsForMonth(mock.prisma, { year: 2026, month: 4, groupId: "group-1" });

  assert.equal(createdFirst.length, 1);
  assert.equal(mock.createdPeriods.length, 1);
  assert.equal(mock.createdShares.length, 1);
  assert.equal(mock.createdPeriods[0].periodStart.toISOString(), new Date(2026, 3, 1).toISOString());
  assert.equal(mock.createdShares[0].amount, 400);

  const createdSecond = await ensureRecurringPeriodsForMonth(mock.prisma, { year: 2026, month: 4, groupId: "group-1" });
  assert.equal(createdSecond.length, 0);
  assert.equal(mock.createdPeriods.length, 1);
  assert.equal(mock.createdShares.length, 1);

  console.log("recurring-periods tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
