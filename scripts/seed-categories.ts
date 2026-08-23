/**
 * Semilla de categorias.
 *
 * Son las 8 categorias que el usuario realmente usa. La primera version de este
 * script sembraba 13 inventadas, y varias duplicaban el vocabulario real
 * ("Supermercado" y "Comida y delivery" al lado de "Alimentacion", que tiene 240
 * de los 386 gastos). Se borraron las 8 que quedaron vacias.
 *
 * Que la lista de aca coincida con lo que hay en la base es lo que evita el bug
 * de fondo: si la semilla tuviera nombres que no se usan, la proxima corrida los
 * volveria a crear. Ademas, en la Tarea 8 el prompt de la IA recibe todos los
 * nombres de categoria, asi que los casi-duplicados desparramarian la categoria
 * mas grande en varios baldes.
 *
 * El `icon` y el `color` de cada una son los que ya tenian en la base, no valores
 * nuevos. El upsert usa `update: {}` a proposito: si la categoria existe **no se
 * toca**, asi que nunca le pisa al usuario un icono o un color que haya cambiado
 * a mano. Solo crea las que falten.
 *
 * NO borra ni renombra categorias que no esten en esta lista: puede haber gastos
 * apuntando a ellas y se romperia la relacion.
 *
 * Correr:  node --env-file=.env scripts/seed-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Alimentacion",    icon: "utensils",      color: "#ef4444" },
  { name: "Compras",         icon: "shopping-bag",  color: "#14b8a6" },
  { name: "Educacion",       icon: "book",          color: "#3b82f6" },
  { name: "Entretenimiento", icon: "gamepad",       color: "#a855f7" },
  { name: "Otros",           icon: "tag",           color: "#6b7280" },
  { name: "Salud",           icon: "heart",         color: "#ec4899" },
  { name: "Servicios",       icon: "zap",           color: "#eab308" },
  { name: "Transporte",      icon: "car",           color: "#f97316" },
];

async function main() {
  const before = await prisma.category.findMany({ select: { name: true } });
  const beforeNames = before.map((c) => c.name);

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }
  console.log(`${CATEGORIES.length} categorias sembradas`);

  const seedNames = CATEGORIES.map((c) => c.name);
  const matched = beforeNames.filter((n) => seedNames.includes(n));
  const extra = beforeNames.filter((n) => !seedNames.includes(n));
  const created = seedNames.filter((n) => !beforeNames.includes(n));

  console.log(`Ya existian (${beforeNames.length}): ${beforeNames.join(", ") || "-"}`);
  console.log(`Coinciden con la semilla (${matched.length}): ${matched.join(", ") || "-"}`);
  console.log(`Creadas nuevas (${created.length}): ${created.join(", ") || "-"}`);
  console.log(
    `Existentes fuera de la semilla, se conservan (${extra.length}): ${extra.join(", ") || "-"}`
  );

  const total = await prisma.category.count();
  console.log(`Total de categorias en la base: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
