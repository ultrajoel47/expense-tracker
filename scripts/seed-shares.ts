import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const JOEL_EMAIL = "leandrojoel@hotmail.com";
const VIRGINIA_EMAIL = "virginiapayetta@gmail.com";

const JOEL_INCOME = 2_380_000;
const VIRGINIA_INCOME = 1_436_000;
const TOTAL_INCOME = JOEL_INCOME + VIRGINIA_INCOME;

const JOEL_PCT = (JOEL_INCOME / TOTAL_INCOME) * 100;
const VIRGINIA_PCT = (VIRGINIA_INCOME / TOTAL_INCOME) * 100;

async function main() {
  const joel = await prisma.user.findUnique({ where: { email: JOEL_EMAIL } });
  const virginia = await prisma.user.findUnique({ where: { email: VIRGINIA_EMAIL } });

  if (!joel) throw new Error(`Usuario Joel no encontrado: ${JOEL_EMAIL}`);
  if (!virginia) throw new Error(`Usuario Virginia no encontrado: ${VIRGINIA_EMAIL}`);

  // --- 1. Monthly incomes: Feb 2025 to Mar 2026 ---
  const months: { month: number; year: number }[] = [];
  let y = 2025, m = 2;
  while (y < 2026 || (y === 2026 && m <= 3)) {
    months.push({ month: m, year: y });
    m++;
    if (m > 12) { m = 1; y++; }
  }

  let incomeCount = 0;
  for (const { month, year } of months) {
    for (const [user, amount] of [[joel, JOEL_INCOME], [virginia, VIRGINIA_INCOME]] as const) {
      await prisma.monthlyIncome.upsert({
        where: { userId_month_year: { userId: user.id, month, year } },
        update: { amount },
        create: { userId: user.id, month, year, amount },
      });
      incomeCount++;
    }
  }
  console.log(`✓ MonthlyIncome creados/actualizados: ${incomeCount} (${months.length} meses × 2 usuarios)`);

  // --- 2. Mark all seeded expenses as shared + create ExpenseShare ---
  const expenses = await prisma.expense.findMany({
    where: {
      userId: { in: [joel.id, virginia.id] },
      isShared: false,
    },
    select: { id: true, userId: true, amount: true },
  });

  let shareCount = 0;
  const BATCH = 50;

  for (let i = 0; i < expenses.length; i += BATCH) {
    const batch = expenses.slice(i, i + BATCH);

    await prisma.$transaction(
      batch.map((e) =>
        prisma.expense.update({
          where: { id: e.id },
          data: { isShared: true, splitMode: "auto" },
        })
      )
    );

    const sharesData = batch.map((e) => {
      const isJoelPayer = e.userId === joel.id;
      return {
        expenseId: e.id,
        userId: isJoelPayer ? virginia.id : joel.id,
        percentage: isJoelPayer ? VIRGINIA_PCT : JOEL_PCT,
        amount: e.amount * (isJoelPayer ? VIRGINIA_PCT : JOEL_PCT) / 100,
      };
    });

    await prisma.expenseShare.createMany({ data: sharesData });
    shareCount += sharesData.length;
  }

  console.log(`✓ Expenses marcados como compartidos: ${expenses.length}`);
  console.log(`✓ ExpenseShare creados: ${shareCount}`);
  console.log(`  Joel paga ${JOEL_PCT.toFixed(2)}% | Virginia paga ${VIRGINIA_PCT.toFixed(2)}%`);

  // --- 3. Mark recurring expenses as shared + create RecurringShare ---
  const group = await prisma.group.findFirst({
    where: {
      OR: [
        { ownerId: joel.id, members: { some: { userId: virginia.id } } },
        { ownerId: virginia.id, members: { some: { userId: joel.id } } },
      ],
    },
  });

  if (!group) {
    console.log("⚠ No se encontró grupo con ambos usuarios — se omiten RecurringShare");
  } else {
    const recurringList = await prisma.recurringExpense.findMany({
      where: {
        userId: { in: [joel.id, virginia.id] },
        isShared: false,
      },
      select: { id: true, userId: true, amount: true },
    });

    for (let i = 0; i < recurringList.length; i += BATCH) {
      const batch = recurringList.slice(i, i + BATCH);
      await prisma.$transaction(
        batch.map((r) =>
          prisma.recurringExpense.update({
            where: { id: r.id },
            data: { isShared: true, splitMode: "auto", groupId: group.id },
          })
        )
      );
    }

    const recurringShareData = recurringList.map((r) => {
      const isJoelPayer = r.userId === joel.id;
      return {
        recurringExpenseId: r.id,
        userId: isJoelPayer ? virginia.id : joel.id,
        percentage: isJoelPayer ? VIRGINIA_PCT : JOEL_PCT,
        amount: (r.amount * (isJoelPayer ? VIRGINIA_PCT : JOEL_PCT)) / 100,
      };
    });

    for (const share of recurringShareData) {
      await prisma.recurringShare.upsert({
        where: { recurringExpenseId_userId: { recurringExpenseId: share.recurringExpenseId, userId: share.userId } },
        update: { percentage: share.percentage, amount: share.amount },
        create: share,
      });
    }

    console.log(`✓ RecurringExpenses marcados como compartidos: ${recurringList.length}`);
    console.log(`✓ RecurringShare creados: ${recurringShareData.length}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
