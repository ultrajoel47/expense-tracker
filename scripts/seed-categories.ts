/**
 * Semilla de categorias.
 *
 * Hace `upsert` por `name`, asi que es seguro correrlo sobre una base que ya
 * tiene categorias: las existentes no se tocan y las que faltan se crean.
 *
 * NO borra ni renombra categorias que no esten en esta lista: hay gastos
 * apuntando a ellas y se romperia la relacion.
 *
 * Correr:  node --env-file=.env scripts/seed-categories.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Supermercado", icon: "shopping-cart", color: "#16a34a" },
  { name: "Comida y delivery", icon: "utensils", color: "#f97316" },
  { name: "Transporte", icon: "car", color: "#0ea5e9" },
  { name: "Servicios", icon: "zap", color: "#eab308" },
  { name: "Alquiler", icon: "home", color: "#6366f1" },
  { name: "Salud", icon: "heart", color: "#ef4444" },
  { name: "Farmacia", icon: "pill", color: "#ec4899" },
  { name: "Ropa", icon: "shirt", color: "#8b5cf6" },
  { name: "Entretenimiento", icon: "film", color: "#a855f7" },
  { name: "Hogar", icon: "sofa", color: "#14b8a6" },
  { name: "Mascotas", icon: "paw-print", color: "#84cc16" },
  { name: "Regalos", icon: "gift", color: "#f43f5e" },
  { name: "Otros", icon: "tag", color: "#64748b" },
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

  // Informe de solapamiento: que se reuso y que quedo afuera de la lista.
  const seedNames = CATEGORIES.map((c) => c.name);
  const matched = beforeNames.filter((n) => seedNames.includes(n));
  const extra = beforeNames.filter((n) => !seedNames.includes(n));
  const created = seedNames.filter((n) => !beforeNames.includes(n));

  console.log(`Ya existian: ${beforeNames.length} -> ${beforeNames.join(", ")}`);
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
