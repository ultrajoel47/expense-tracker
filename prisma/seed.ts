import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { name: "Alimentacion", icon: "utensils", color: "#ef4444" },
  { name: "Transporte", icon: "car", color: "#f97316" },
  { name: "Entretenimiento", icon: "gamepad", color: "#a855f7" },
  { name: "Salud", icon: "heart", color: "#ec4899" },
  { name: "Educacion", icon: "book", color: "#3b82f6" },
  { name: "Servicios", icon: "zap", color: "#eab308" },
  { name: "Compras", icon: "shopping-bag", color: "#14b8a6" },
  { name: "Otros", icon: "tag", color: "#6b7280" },
];

async function main() {
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: cat,
    });
  }
  console.log("Seed completed: categories created");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
