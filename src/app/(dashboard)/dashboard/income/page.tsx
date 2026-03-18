"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";

interface MonthlyIncome {
  id: string;
  amount: number;
  month: number;
  year: number;
}

const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function IncomePage() {
  const now = new Date();
  const [incomes, setIncomes] = useState<MonthlyIncome[]>([]);
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadIncomes();
  }, []);

  function loadIncomes() {
    fetch("/api/income").then((r) => r.json()).then(setIncomes);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/income", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), month, year }),
      });
      setAmount("");
      loadIncomes();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Ingresos Mensuales</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border dark:border-gray-700 space-y-4">
        <h2 className="font-semibold">Registrar Ingreso</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="number"
            step="0.01"
            placeholder="Ingreso del mes"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
          >
            {monthNames.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
        </div>
        <button type="submit" disabled={loading} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
          Guardar
        </button>
      </form>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Historial de Ingresos</h2>
        </div>
        {incomes.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No hay ingresos registrados.</p>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {incomes.map((inc) => (
              <div key={inc.id} className="p-4 flex items-center justify-between">
                <p className="font-medium">{monthNames[inc.month - 1]} {inc.year}</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">${formatCurrency(inc.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
