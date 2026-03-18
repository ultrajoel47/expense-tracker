import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const month = Number(url.searchParams.get("month") || new Date().getMonth() + 1);
  const year = Number(url.searchParams.get("year") || new Date().getFullYear());

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));

  const expenses = await prisma.expense.findMany({
    where: { userId: session.id, date: { gte: startDate, lt: endDate } },
    include: { category: true },
    orderBy: { date: "asc" },
  });

  const header = "Fecha,Descripcion,Categoria,Monto\n";
  const rows = expenses
    .map((e) => {
      const date = e.date.toISOString().split("T")[0];
      const desc = e.description.replace(/,/g, ";");
      return `${date},${desc},${e.category.name},${e.amount.toFixed(2)}`;
    })
    .join("\n");

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const footer = `\n\nTotal,,,${ total.toFixed(2)}`;

  const csv = header + rows + footer;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="gastos-${year}-${String(month).padStart(2, "0")}.csv"`,
    },
  });
}
