/**
 * Migration script: Assign all unshared expenses/recurring of group members
 * to the specified group with splitMode="auto" and create proportional shares
 * based on MonthlyIncome data.
 *
 * Usage:
 *   npx ts-node scripts/migrate-expenses-to-shared.ts --groupId=<id> [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Parse CLI args: --key=value or --flag → { key: "value" } | { flag: "true" }
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    })
);

const groupId: string = args.groupId ?? "";
const dryRun: boolean = args["dry-run"] === "true";

if (!groupId) {
  console.error("Error: Se requiere --groupId=<id>");
  console.error("Uso: npx ts-node scripts/migrate-expenses-to-shared.ts --groupId=<id> [--dry-run]");
  process.exit(1);
}

if (dryRun) {
  console.log("🔍 MODO DRY-RUN — no se escribirán cambios en la base de datos\n");
}

// Calculates expense shares for non-payer members based on MonthlyIncome.
// Falls back to equal split if totalIncome = 0 or incomeMap is empty.
function calculateSplit(
  memberIds: string[],
  payerId: string,
  totalAmount: number,
  incomeMap: Map<string, number>
): { userId: string; percentage: number; amount: number }[] {
  const nonPayerIds = memberIds.filter((id) => id !== payerId);
  if (nonPayerIds.length === 0) return [];

  const totalIncome = memberIds.reduce((sum, id) => sum + (incomeMap.get(id) ?? 0), 0);

  if (totalIncome > 0) {
    return nonPayerIds.map((uid) => {
      const userIncome = incomeMap.get(uid) ?? 0;
      const pct = (userIncome / totalIncome) * 100;
      return { userId: uid, percentage: pct, amount: (totalAmount * pct) / 100 };
    });
  } else {
    // Equal split across ALL members (including payer) — then exclude payer from shares
    const pct = 100 / memberIds.length;
    return nonPayerIds.map((uid) => ({
      userId: uid,
      percentage: pct,
      amount: (totalAmount * pct) / 100,
    }));
  }
}

async function main() {
  // 1. Load group + members
  const group = await prisma.group.findFirst({
    where: { id: groupId },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!group) {
    console.error(`Error: Grupo con id "${groupId}" no encontrado`);
    process.exit(1);
  }

  const memberIds = group.members.map((m) => m.userId);
  console.log(`Grupo: "${group.name}" (${memberIds.length} miembros)`);
  for (const m of group.members) {
    console.log(`  - ${m.user.name} (${m.userId})`);
  }
  console.log();

  if (memberIds.length < 2) {
    console.warn("⚠ El grupo tiene menos de 2 miembros — no hay shares que crear.");
  }

  // ──────────────────────────────────────────────
  // 2. EXPENSES
  // ──────────────────────────────────────────────
  const expenses = await prisma.expense.findMany({
    where: {
      userId: { in: memberIds },
      OR: [{ groupId: null }, { isShared: false }],
    },
    select: { id: true, userId: true, amount: true, date: true, description: true },
  });

  console.log(`Gastos a migrar: ${expenses.length}`);

  // Group by (month, year) to minimize MonthlyIncome queries
  const periodMap = new Map<string, typeof expenses>();
  for (const e of expenses) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!periodMap.has(key)) periodMap.set(key, []);
    periodMap.get(key)!.push(e);
  }

  let expenseMigratedCount = 0;
  let expenseShareCount = 0;
  let expenseSkippedCount = 0;

  for (const [periodKey, periodExpenses] of periodMap) {
    const [yearStr, monthStr] = periodKey.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    const incomes = await prisma.monthlyIncome.findMany({
      where: { userId: { in: memberIds }, month, year },
    });
    const incomeMap = new Map<string, number>(incomes.map((i) => [i.userId, i.amount]));

    const BATCH = 50;
    for (let i = 0; i < periodExpenses.length; i += BATCH) {
      const batch = periodExpenses.slice(i, i + BATCH);

      for (const expense of batch) {
        // Skip if payer is not in the group
        if (!memberIds.includes(expense.userId)) {
          console.warn(`  ⚠ Gasto id=${expense.id} ("${expense.description}") — pagador no está en el grupo, omitido`);
          expenseSkippedCount++;
          continue;
        }

        const shares = calculateSplit(memberIds, expense.userId, expense.amount, incomeMap);

        if (dryRun) {
          console.log(`  [DRY RUN] Gasto id=${expense.id} "${expense.description}" → groupId=${groupId}, isShared=true, splitMode=auto`);
          for (const s of shares) {
            const member = group.members.find((m) => m.userId === s.userId);
            console.log(`    share: ${member?.user.name ?? s.userId} ${s.percentage.toFixed(2)}% $${s.amount.toFixed(2)}`);
          }
        } else {
          await prisma.expense.update({
            where: { id: expense.id },
            data: { groupId, isShared: true, splitMode: "auto" },
          });
          if (shares.length > 0) {
            for (const s of shares) {
              await prisma.expenseShare.upsert({
                where: { expenseId_userId: { expenseId: expense.id, userId: s.userId } },
                update: { percentage: s.percentage, amount: s.amount },
                create: { expenseId: expense.id, ...s },
              });
            }
          }
        }

        expenseMigratedCount++;
        expenseShareCount += shares.length;
      }
    }
  }

  console.log(`✓ Gastos migrados: ${expenseMigratedCount} | shares creados: ${expenseShareCount} | omitidos: ${expenseSkippedCount}`);
  console.log();

  // ──────────────────────────────────────────────
  // 3. RECURRING EXPENSES
  // ──────────────────────────────────────────────
  const recurringList = await prisma.recurringExpense.findMany({
    where: {
      userId: { in: memberIds },
      OR: [{ groupId: null }, { isShared: false }],
    },
    select: { id: true, userId: true, payerId: true, amount: true, description: true, createdAt: true },
  });

  console.log(`Recurrentes a migrar: ${recurringList.length}`);

  // Group by (month, year) based on createdAt
  const recurringPeriodMap = new Map<string, typeof recurringList>();
  for (const r of recurringList) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    if (!recurringPeriodMap.has(key)) recurringPeriodMap.set(key, []);
    recurringPeriodMap.get(key)!.push(r);
  }

  let recurringMigratedCount = 0;
  let recurringShareCount = 0;
  let recurringSkippedCount = 0;

  for (const [periodKey, periodRecurring] of recurringPeriodMap) {
    const [yearStr, monthStr] = periodKey.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);

    const incomes = await prisma.monthlyIncome.findMany({
      where: { userId: { in: memberIds }, month, year },
    });
    const incomeMap = new Map<string, number>(incomes.map((i) => [i.userId, i.amount]));

    for (const rec of periodRecurring) {
      const effectivePayerId = rec.payerId ?? rec.userId;

      if (!memberIds.includes(effectivePayerId)) {
        console.warn(`  ⚠ Recurrente id=${rec.id} ("${rec.description}") — pagador no está en el grupo, omitido`);
        recurringSkippedCount++;
        continue;
      }

      const shares = calculateSplit(memberIds, effectivePayerId, rec.amount, incomeMap);

      if (dryRun) {
        console.log(`  [DRY RUN] Recurrente id=${rec.id} "${rec.description}" → groupId=${groupId}, isShared=true, splitMode=auto`);
        for (const s of shares) {
          const member = group.members.find((m) => m.userId === s.userId);
          console.log(`    share: ${member?.user.name ?? s.userId} ${s.percentage.toFixed(2)}% $${s.amount.toFixed(2)}`);
        }
      } else {
        await prisma.recurringExpense.update({
          where: { id: rec.id },
          data: { groupId, isShared: true, splitMode: "auto" },
        });
        if (shares.length > 0) {
          for (const s of shares) {
            await prisma.recurringShare.upsert({
              where: { recurringExpenseId_userId: { recurringExpenseId: rec.id, userId: s.userId } },
              update: { percentage: s.percentage, amount: s.amount },
              create: { recurringExpenseId: rec.id, ...s },
            });
          }
        }
      }

      recurringMigratedCount++;
      recurringShareCount += shares.length;
    }
  }

  console.log(`✓ Recurrentes migrados: ${recurringMigratedCount} | shares creados: ${recurringShareCount} | omitidos: ${recurringSkippedCount}`);
  console.log();

  if (dryRun) {
    console.log("🔍 DRY-RUN completado — ningún dato fue modificado.");
  } else {
    console.log("✅ Migración completada.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
