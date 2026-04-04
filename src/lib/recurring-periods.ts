type ShareSnapshot = {
  userId: string;
  percentage: number;
  amount: number;
};

type RecurringTemplate = {
  id: string;
  userId: string;
  payerId: string | null;
  categoryId: string;
  groupId: string | null;
  amount: number;
  description: string;
  frequency: string;
  splitMode: string;
  nextDue: Date;
  createdAt: Date;
  shares: ShareSnapshot[];
};

type PeriodRecord = {
  id: string;
  recurringExpenseId: string;
  periodStart: Date;
};

type PrismaLike = {
  recurringExpense: {
    findMany(args: unknown): Promise<RecurringTemplate[]>;
  };
  recurringExpensePeriod: {
    findMany(args: unknown): Promise<PeriodRecord[]>;
    create(args: unknown): Promise<PeriodRecord>;
  };
  periodShare: {
    createMany(args: unknown): Promise<unknown>;
  };
  $transaction<T>(callback: (tx: PrismaLike) => Promise<T>): Promise<T>;
};

export function getPeriodMonthStart(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1));
}

export function getNextPeriodMonthStart(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1));
}

function sameMonth(date: Date, year: number, month: number) {
  return date.getFullYear() === year && date.getMonth() === month - 1;
}

export async function createPeriodFromRecurringIfMissing(
  prisma: PrismaLike,
  recurring: RecurringTemplate,
  year: number,
  month: number
) {
  const periodStart = getPeriodMonthStart(year, month);
  const existing = await prisma.recurringExpensePeriod.findMany({
    where: {
      recurringExpenseId: recurring.id,
      periodStart: {
        gte: periodStart,
        lt: getNextPeriodMonthStart(year, month),
      },
    },
  });

  if (existing.length > 0) return null;

  return prisma.$transaction(async (tx) => {
    const created = await tx.recurringExpensePeriod.create({
      data: {
        recurringExpenseId: recurring.id,
        payerId: recurring.payerId ?? null,
        periodStart,
        amount: recurring.amount,
        description: recurring.description,
        categoryId: recurring.categoryId,
        splitMode: recurring.splitMode,
      },
    });

    if (recurring.shares.length > 0) {
      await tx.periodShare.createMany({
        data: recurring.shares.map((share) => ({
          periodId: created.id,
          userId: share.userId,
          percentage: share.percentage,
          amount: share.amount,
        })),
      });
    }

    return created;
  });
}

export async function ensureRecurringPeriodsForMonth(
  prisma: PrismaLike,
  {
    year,
    month,
    groupId,
  }: {
    year: number;
    month: number;
    groupId?: string | null;
  }
) {
  const nextPeriodStart = getNextPeriodMonthStart(year, month);
  const recurringExpenses = await prisma.recurringExpense.findMany({
    where: {
      active: true,
      frequency: "MONTHLY",
      ...(groupId ? { groupId } : {}),
      nextDue: { lt: nextPeriodStart },
    },
    include: {
      shares: true,
    },
  });

  const created = [];
  for (const recurring of recurringExpenses) {
    if (recurring.createdAt >= nextPeriodStart) continue;
    if (recurring.nextDue > nextPeriodStart && !sameMonth(recurring.nextDue, year, month)) continue;
    const period = await createPeriodFromRecurringIfMissing(prisma, recurring, year, month);
    if (period) created.push(period);
  }

  return created;
}
