"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { formatCurrency } from "@/lib/format";

interface MemberStat {
  userId: string;
  name: string;
  percentage: number;
  income: number | null;
  totalPaid: number;
  totalCharged: number;
  netBalance: number;
}

interface ShareEntry {
  id: string;
  userId: string;
  percentage: number;
  amount: number;
  user: { id: string; name: string };
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;
  user: { id: string; name: string };
  category: { id: string; name: string; color: string };
  shares: ShareEntry[];
}

interface RecurringExpense {
  id: string;
  amount: number;
  description: string;
  frequency: string;
  payerId: string | null;
  payer: { id: string; name: string } | null;
  user: { id: string; name: string };
  category: { id: string; name: string; color: string };
  shares: ShareEntry[];
}

interface Group {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string };
  members: { userId: string; percentage: number; user: { id: string; name: string } }[];
}

interface BalanceEntry {
  debtorId: string;
  debtorName: string;
  creditorId: string;
  creditorName: string;
  amount: number;
}

type SortKey = "name" | "income" | "totalPaid" | "totalCharged" | "netBalance";

const FREQ_LABELS: Record<string, string> = { DAILY: "Diario", WEEKLY: "Semanal", MONTHLY: "Mensual", YEARLY: "Anual" };

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export default function GroupDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [group, setGroup] = useState<Group | null>(null);
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [expandedExpense, setExpandedExpense] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("netBalance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setSummaryLoading(true);
    fetch(`/api/groups/${id}/summary?month=${month}&year=${year}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setGroup(d.group);
          setMemberStats(d.memberStats ?? []);
          setExpenses(d.expenses ?? []);
          setRecurring(d.recurring ?? []);
        }
      })
      .finally(() => setSummaryLoading(false));
  }, [id, month, year]);

  useEffect(() => {
    setBalanceLoading(true);
    fetch(`/api/groups/${id}/balance`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setBalance(Array.isArray(d) ? d : []))
      .finally(() => setBalanceLoading(false));
  }, [id]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sortedStats = [...memberStats].sort((a, b) => {
    if (sortKey === "name") {
      const cmp = a.name.localeCompare(b.name);
      return sortDir === "desc" ? -cmp : cmp;
    }
    const val = (x: MemberStat): number => {
      const v = x[sortKey];
      return v === null ? -Infinity : v;
    };
    return sortDir === "desc" ? val(b) - val(a) : val(a) - val(b);
  });

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-gray-300 ml-1">↕</span>;
    return <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>;
  };

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  if (!group && !summaryLoading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Grupo no encontrado.</p>
        <button onClick={() => router.push("/dashboard/groups")} className="mt-2 text-indigo-600 hover:underline text-sm">
          ← Volver a Grupos
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard/groups")}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          ← Grupos
        </button>
        <h1 className="text-2xl font-bold">{group?.name ?? "Cargando..."}</h1>
      </div>

      {/* Month/Year filter */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-600 dark:text-gray-400">Período:</span>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {MONTHS.map((m, i) => (
            <option key={i + 1} value={i + 1}>{m}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Member stats table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Miembros — {MONTHS[month - 1]} {year}</h2>
        </div>
        {summaryLoading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : memberStats.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Sin miembros.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400">
                <tr>
                  <th
                    className="px-4 py-3 text-left cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort("name")}
                  >
                    Nombre <SortIcon col="name" />
                  </th>
                  <th className="px-4 py-3 text-right">%</th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort("income")}
                  >
                    Sueldo <SortIcon col="income" />
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort("totalPaid")}
                  >
                    Adelantó <SortIcon col="totalPaid" />
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort("totalCharged")}
                  >
                    Le toca <SortIcon col="totalCharged" />
                  </th>
                  <th
                    className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort("netBalance")}
                  >
                    Balance neto <SortIcon col="netBalance" />
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {sortedStats.map((stat) => (
                  <tr key={stat.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 font-medium">{stat.name}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{stat.percentage.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">
                      {stat.income !== null ? `$${formatCurrency(stat.income)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">${formatCurrency(stat.totalPaid)}</td>
                    <td className="px-4 py-3 text-right">${formatCurrency(stat.totalCharged)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${stat.netBalance > 0.01 ? "text-green-600 dark:text-green-400" : stat.netBalance < -0.01 ? "text-red-500 dark:text-red-400" : "text-gray-500"}`}>
                      {stat.netBalance > 0.01 ? "+" : ""}
                      ${formatCurrency(stat.netBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Balance de deudas */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Balance del grupo (deudas acumuladas)</h2>
        </div>
        <div className="p-4">
          {balanceLoading ? (
            <p className="text-sm text-gray-400">Calculando...</p>
          ) : balance.length === 0 ? (
            <p className="text-sm text-gray-400">Sin diferencias de balance en este grupo.</p>
          ) : (
            <div className="space-y-2">
              {balance.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-red-600 dark:text-red-400">{entry.debtorName}</span>
                  <span className="text-gray-500">le debe a</span>
                  <span className="font-medium text-green-600 dark:text-green-400">{entry.creditorName}</span>
                  <span className="font-bold text-gray-800 dark:text-gray-200">
                    ${formatCurrency(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Gastos del mes */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Gastos compartidos — {MONTHS[month - 1]} {year}</h2>
        </div>
        {summaryLoading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : expenses.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Sin gastos en este período.</p>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {expenses.map((exp) => (
              <div key={exp.id}>
                <div
                  className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => setExpandedExpense(expandedExpense === exp.id ? null : exp.id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: exp.category.color }} />
                    <div>
                      <p className="font-medium">{exp.description}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {exp.category.name} · {new Date(exp.date).toLocaleDateString("es")} · Paga: {exp.user.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">${formatCurrency(exp.amount)}</span>
                    <span className="text-xs text-gray-400">{expandedExpense === exp.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandedExpense === exp.id && exp.shares.length > 0 && (
                  <div className="px-6 pb-4 bg-gray-50 dark:bg-gray-700/20 space-y-1">
                    {exp.shares.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
                        <span>{s.user.name}</span>
                        <span>${formatCurrency(s.amount)} ({s.percentage.toFixed(1)}%)</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gastos recurrentes */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Gastos recurrentes del grupo</h2>
        </div>
        {summaryLoading ? (
          <p className="p-6 text-sm text-gray-400">Cargando...</p>
        ) : recurring.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Sin gastos recurrentes asociados.</p>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {recurring.map((rec) => {
              const payerName = rec.payer?.name ?? rec.user.name;
              return (
                <div key={rec.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: rec.category.color }} />
                    <div>
                      <p className="font-medium">{rec.description}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {rec.category.name} · {FREQ_LABELS[rec.frequency] ?? rec.frequency} · Paga: {payerName}
                      </p>
                    </div>
                  </div>
                  <span className="font-semibold">${formatCurrency(rec.amount)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
