/**
 * Backfill de la Rebanada 1 — migra la data existente al schema de 8 modelos.
 *
 * En MongoDB `prisma db push` no borra documentos: sincroniza indices. Los
 * gastos historicos siguen ahi, pero les faltan los campos nuevos
 * OBLIGATORIOS del schema nuevo, y Prisma falla al leer un documento sin un
 * campo requerido:
 *
 *   Inconsistent query result: Field scope is required to return data, got `null` instead.
 *
 * Asi que la migracion es un BACKFILL sobre los documentos que ya estan, no una
 * reinsercion: preserva los `_id`, las relaciones (las cuotas siguen apuntando a
 * su gasto) y todo el historial.
 *
 * Se hace con comandos raw porque Prisma no puede escribir campos que su propio
 * schema no conoce, ni leer documentos a los que les falta un campo requerido.
 *
 * ES IDEMPOTENTE: cada update filtra por `$exists: false`, asi que nunca
 * sobreescribe un documento que ya tiene el campo. Correrlo dos veces no
 * cambia nada la segunda vez.
 *
 * Correr:  node --env-file=.env scripts/backfill-rebanada1.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Colecciones de los 6 modelos que salen del schema. Se dropean al final. */
const ORPHAN_COLLECTIONS = [
  "MonthlyIncome",
  "Group",
  "GroupMember",
  "ExpenseShare",
  "RecurringShare",
  "Budget",
  "RecurringExpensePeriod",
  "PeriodShare",
];

/** Colecciones que tienen que sobrevivir, con la cantidad de filas esperada. */
const EXPECTED_COUNTS: Record<string, number> = {
  Expense: 386,
  Installment: 66,
  RecurringExpense: 10,
  CreditCard: 6,
  User: 2,
};

async function listCollections(): Promise<string[]> {
  const res = (await prisma.$runCommandRaw({ listCollections: 1 })) as {
    cursor: { firstBatch: { name: string }[] };
  };
  return res.cursor.firstBatch.map((c) => c.name).sort();
}

async function count(collection: string): Promise<number> {
  const res = (await prisma.$runCommandRaw({ count: collection })) as { n: number };
  return res.n;
}

/**
 * Devuelve la distribucion de tipos BSON reales de un campo, leida desde Mongo
 * y no desde Prisma. Es la unica forma de detectar la trampa de haber guardado
 * un ObjectId como string.
 */
async function bsonTypes(collection: string, field: string) {
  const res = (await prisma.$runCommandRaw({
    aggregate: collection,
    pipeline: [
      { $project: { t: { $type: "$" + field } } },
      { $group: { _id: "$t", n: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ],
    cursor: {},
  })) as { cursor: { firstBatch: { _id: string; n: number }[] } };
  return res.cursor.firstBatch;
}

/**
 * Aplica un update raw y devuelve cuantos documentos modifico.
 * `u` puede ser un pipeline de agregacion (array) para preservar tipos BSON.
 */
async function applyUpdate(
  collection: string,
  label: string,
  q: Record<string, unknown>,
  u: unknown
): Promise<number> {
  const res = (await prisma.$runCommandRaw({
    update: collection,
    updates: [{ q, u, multi: true }],
  } as never)) as { n: number; nModified: number };
  console.log(`  ${label}: ${res.nModified} documentos modificados`);
  return res.nModified;
}

async function backfill(collections: string[]) {
  console.log("\n== BACKFILL ==");

  if (collections.includes("Expense")) {
    console.log("Expense:");
    // Todo el historial se cargo cuando la app era de gastos compartidos del
    // hogar, asi que "casa" es el scope correcto.
    await applyUpdate("Expense", "scope = 'casa'", { scope: { $exists: false } }, {
      $set: { scope: "casa" },
    });
    // `userId` era el dueño del registro y tambien quien pago, asi que
    // createdById = userId es exacto para el historial.
    //
    // OJO: `u` es un PIPELINE (array). Sin los corchetes, `$set` guardaria el
    // string literal "$userId" en los 386 documentos en vez del ObjectId, y el
    // backfill pareceria exitoso hasta que la app intente leer.
    await applyUpdate(
      "Expense",
      "createdById = userId (ObjectId)",
      { createdById: { $exists: false } },
      [{ $set: { createdById: "$userId" } }]
    );
    // Ninguno vino del bot: el bot todavia no existia.
    await applyUpdate("Expense", "source = 'web'", { source: { $exists: false } }, {
      $set: { source: "web" },
    });
  }

  if (collections.includes("RecurringExpense")) {
    console.log("RecurringExpense:");
    await applyUpdate("RecurringExpense", "scope = 'casa'", { scope: { $exists: false } }, {
      $set: { scope: "casa" },
    });
  }
}

/**
 * Corta el proceso si el backfill quedo corto. Se corre ANTES de dropear las
 * colecciones huerfanas: no se destruye nada si la migracion no cerro bien.
 */
async function assertBackfillComplete() {
  console.log("\n== CONTROL PREVIO AL DROP ==");
  const checks: [string, string][] = [
    ["Expense", "scope"],
    ["Expense", "createdById"],
    ["Expense", "source"],
    ["RecurringExpense", "scope"],
  ];
  let ok = true;
  for (const [collection, field] of checks) {
    const missing = (await prisma.$runCommandRaw({
      count: collection,
      query: { [field]: { $exists: false } },
    } as never)) as { n: number };
    console.log(`  ${collection}.${field} faltante en ${missing.n} documentos`);
    if (missing.n > 0) ok = false;
  }
  // La trampa: createdById tiene que haber quedado como objectId, no string.
  const types = await bsonTypes("Expense", "createdById");
  const bad = types.filter((t) => t._id !== "objectId");
  if (bad.length > 0) {
    console.log(`  Expense.createdById tiene tipos no-objectId: ${JSON.stringify(bad)}`);
    ok = false;
  }
  if (!ok) {
    throw new Error(
      "El backfill quedo incompleto. NO se dropea nada. Revisar y volver a correr."
    );
  }
  console.log("  OK: el backfill esta completo y con los tipos correctos.");
}

async function dropOrphans(collections: string[]) {
  console.log("\n== DROP DE COLECCIONES HUERFANAS ==");
  for (const name of ORPHAN_COLLECTIONS) {
    if (!collections.includes(name)) {
      console.log(`  ${name}: ya no existe, nada que hacer`);
      continue;
    }
    const n = await count(name);
    await prisma.$runCommandRaw({ drop: name });
    console.log(`  ${name}: dropeada (${n} documentos)`);
  }
}

async function verify() {
  console.log("\n== VERIFICACION ==");

  console.log("Colecciones:");
  const collections = await listCollections();
  console.log("  " + collections.join(", "));
  const survivingOrphans = ORPHAN_COLLECTIONS.filter((c) => collections.includes(c));
  console.log(
    survivingOrphans.length === 0
      ? "  OK: ninguna coleccion huerfana quedo en la base."
      : `  FALLA: quedaron huerfanas: ${survivingOrphans.join(", ")}`
  );

  console.log("Conteos:");
  for (const [name, expected] of Object.entries(EXPECTED_COUNTS)) {
    const n = await count(name);
    console.log(`  ${name}: ${n} (esperado ${expected}) ${n === expected ? "OK" : "FALLA"}`);
  }

  console.log("Tipos BSON reales (desde Mongo, no desde Prisma):");
  for (const [collection, field] of [
    ["Expense", "createdById"],
    ["Expense", "userId"],
    ["Expense", "scope"],
    ["Expense", "source"],
    ["RecurringExpense", "scope"],
  ] as [string, string][]) {
    const types = await bsonTypes(collection, field);
    console.log(`  ${collection}.${field}: ${JSON.stringify(types)}`);
  }

  console.log("Lectura real con Prisma (es lo que falla si el backfill quedo corto):");
  const sample = await prisma.expense.findMany({
    take: 5,
    include: { category: true, installments: true },
  });
  console.log(`  findMany(take: 5) devolvio ${sample.length} gastos`);
  for (const e of sample) {
    console.log(
      `    ${e.id} ${e.date.toISOString().slice(0, 10)} ${e.description} $${e.amount} ` +
        `scope=${e.scope} source=${e.source} cat=${e.category.name} ` +
        `createdById=${e.createdById} cuotas=${e.installments.length}`
    );
  }

  const casa = await prisma.expense.count({ where: { scope: "casa" } });
  const noCasa = await prisma.expense.count({ where: { scope: { not: "casa" } } });
  console.log(`  expense.count(scope = 'casa'):  ${casa}`);
  console.log(`  expense.count(scope != 'casa'): ${noCasa}`);

  const withCard = await prisma.expense.findFirst({
    where: { creditCardId: { not: null } },
    include: { creditCard: true, payer: true, createdBy: true },
  });
  console.log(
    withCard
      ? `  relaciones OK: pagador=${withCard.payer.name} registro=${withCard.createdBy.name} tarjeta=${withCard.creditCard?.name}`
      : "  no hay gastos con tarjeta"
  );
}

async function main() {
  console.log("== ESTADO INICIAL ==");
  const collections = await listCollections();
  console.log("Colecciones encontradas (listCollections):");
  console.log("  " + collections.join(", "));

  await backfill(collections);
  await assertBackfillComplete();
  await dropOrphans(collections);
  await verify();

  console.log("\nListo.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
