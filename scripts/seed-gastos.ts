import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const JOEL_EMAIL = "leandrojoel@hotmail.com";
const VIRGINIA_EMAIL = "virginiapayetta@gmail.com";

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Alimentacion: [
    "carne", "pollo", "pechuga", "alitas", "huevo", "pan", "leche", "queso",
    "verdura", "fruta", "verduleria", "polleria", "fiambre", "almacen",
    "supermercado", "coto", "carrefour", "mercado", "dia", "walmart",
    "pizza", "milanesa", "alfajor", "chocolate", "cafe", "mate", "yerba",
    "azucar", "aceite", "fideos", "arroz", "harina", "cerveza", "vino",
    "gaseosa", "agua", "jugo", "comida", "ollas", "cena", "almuerzo",
    "desayuno", "merienda", "helado", "postre", "galletita", "snack",
    "maple", "huevos", "manteca", "crema", "yogur", "queso", "jamon",
    "salchicha", "atun", "sardina", "pasta", "puré", "sopa", "caldo",
    "sal", "pimienta", "condimento", "salsa", "ketchup", "mayonesa",
    "mostaza", "vinagre", "limón", "limon", "naranja", "manzana",
    "banana", "tomate", "papa", "cebolla", "ajo", "zanahoria",
  ],
  Transporte: [
    "nafta", "combustible", "gasoil", "estacionamiento", "cochera",
    "cabify", "uber", "taxi", "remis", "peaje", "autopista",
    "auto", "taller", "mecanico", "neumatico", "goma", "bateria",
    "patente", "vtv", "colectivo", "subte", "tren", "micro",
  ],
  Entretenimiento: [
    "disco", "boliche", "bar", "restaurant", "restaurante", "resto",
    "finde", "fin de semana", "viaje", "vacaciones", "hotel", "airbnb",
    "cine", "teatro", "show", "recital", "partido", "entrada",
    "netflix", "spotify", "amazon", "disney", "streaming",
    "juego", "videojuego", "libro", "revista",
  ],
  Salud: [
    "farmacia", "medicamento", "remedios", "medico", "doctor",
    "hospital", "clinica", "dentista", "odontologia", "veterinaria",
    "veterinario", "vacuna", "analisis", "laboratorio", "optica",
    "anteojos", "lentes",
  ],
  Servicios: [
    "internet", "wifi", "telefono", "celular", "luz", "gas", "agua",
    "alquiler", "expensa", "seguro", "casa", "hogar", "municipalidad",
    "impuesto", "tasa", "abono", "suscripcion",
  ],
  Compras: [
    "temu", "rappi", "mercado libre", "amazon", "shein",
    "escritorio", "cama", "almohada", "mueble", "silla", "mesa",
    "aspiradora", "electrodomestico", "heladera", "lavarropas",
    "ropa", "zapatilla", "remera", "pantalon", "vestido", "campera",
    "bisagra", "tornillo", "herramienta", "easy", "sodimac",
    "ventana", "estante", "cortina", "colchon", "sabana", "toalla",
    "jabon", "shampoo", "perfume", "cosmetica", "belleza",
    "televisor", "tv", "celular", "telefono", "tablet", "computadora",
    "notebook", "auricular", "parlante",
  ],
};

function categorize(description: string): string {
  const lower = description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      const kwNorm = kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (lower.includes(kwNorm)) return cat;
    }
  }
  return "Otros";
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

async function main() {
  const joel = await prisma.user.findUnique({ where: { email: JOEL_EMAIL } });
  const virginia = await prisma.user.findUnique({ where: { email: VIRGINIA_EMAIL } });

  if (!joel) throw new Error(`Usuario Joel no encontrado: ${JOEL_EMAIL}`);
  if (!virginia) throw new Error(`Usuario Virginia no encontrado: ${VIRGINIA_EMAIL}`);

  const categories = await prisma.category.findMany();
  const catMap = new Map(categories.map((c) => [c.name, c.id]));

  const getCatId = (name: string): string => {
    const id = catMap.get(name);
    if (!id) throw new Error(`Categoría no encontrada: ${name}`);
    return id;
  };

  const data = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "scripts/gastos-data.json"), "utf-8")
  );

  const now = new Date();
  let expenseCount = 0;
  let installmentCount = 0;

  for (const g of data.gastos) {
    const userId = g.owner === "virginia" ? virginia.id : joel.id;
    const catName = categorize(g.description);
    const categoryId = getCatId(catName);
    const startDate = new Date(g.startDate);

    const expense = await prisma.expense.create({
      data: {
        amount: g.totalAmount,
        description: g.description,
        date: startDate,
        userId,
        categoryId,
        totalInstallments: g.installments > 1 ? g.installments : null,
      },
    });

    if (g.installments > 1) {
      const installmentsData = [];
      for (let n = 1; n <= g.installments; n++) {
        const dueDate = addMonths(startDate, n - 1);
        installmentsData.push({
          expenseId: expense.id,
          installmentNumber: n,
          dueDate,
          amount: g.monthlyAmount,
          paid: dueDate <= now,
        });
      }
      await prisma.installment.createMany({ data: installmentsData });
      installmentCount += installmentsData.length;
    }

    expenseCount++;
  }

  let recurringCount = 0;
  for (const r of data.recurrentes) {
    const userId = r.owner === "virginia" ? virginia.id : joel.id;
    const catName = categorize(r.description);
    const categoryId = getCatId(catName);

    await prisma.recurringExpense.create({
      data: {
        userId,
        amount: r.amount,
        description: r.description,
        categoryId,
        frequency: "MONTHLY",
        nextDue: new Date(),
        active: true,
        isShared: false,
      },
    });
    recurringCount++;
  }

  console.log(`✓ Expenses creados: ${expenseCount}`);
  console.log(`✓ Installments creados: ${installmentCount}`);
  console.log(`✓ Recurring expenses creados: ${recurringCount}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
