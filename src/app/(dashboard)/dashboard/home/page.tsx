"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  color: string;
}

interface ShareDetail {
  id: string;
  userId: string;
  percentage: number;
  amount: number;
  user: { id: string; name: string };
}

interface CombinedEntry {
  id: string;
  type: "expense" | "recurring";
  role: "payer" | "debtor";
  date: string;
  description: string;
  totalAmount: number;
  myAmount: number;
  myPercentage: number | null;
  category: { id: string; name: string; color: string };
  payerName: string;
  payerId: string;
  shares: ShareDetail[];
  groupId: string | null;
  frequency?: string;
  nextDue?: string;
}

interface MonthlySummary {
  totalShared: number;
  myShare: number;
  othersShare: number;
}

interface PaginationMeta {
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

interface Group {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string };
  members: { userId: string; percentage: number; user: { id: string; name: string } }[];
}

interface MemberStat {
  userId: string;
  name: string;
  percentage: number;
  income: number | null;
  totalPaid: number;
  totalCharged: number;
  netBalance: number;
  idealPercentage: number;
  idealToPay: number;
  difference: number;
  remainingIncome: number | null;
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
}

interface BalanceEntry {
  debtorId: string;
  debtorName: string;
  creditorId: string;
  creditorName: string;
  amount: number;
}

type SortKey = "name" | "income" | "totalPaid" | "totalCharged" | "netBalance" | "idealToPay" | "difference" | "remainingIncome";
type ActiveTab = "resumen" | "movimientos";

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Diario", WEEKLY: "Semanal", MONTHLY: "Mensual", YEARLY: "Anual",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageNumbers(current: number, total: number): number[] {
  const range = 2;
  const start = Math.max(1, current - range);
  const end = Math.min(total, current + range);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const now = new Date();

  // Auth & grupos
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");

  // Navegación temporal
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Filtros (solo /api/shared)
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "recurring">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [dayFilter, setDayFilter] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);

  // Datos de /api/shared
  const [items, setItems] = useState<CombinedEntry[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sharedLoading, setSharedLoading] = useState(false);

  // Datos de /api/groups/[id]/summary
  const [memberStats, setMemberStats] = useState<MemberStat[]>([]);
  const [groupRecurring, setGroupRecurring] = useState<RecurringExpense[]>([]);
  const [totalGroupExpenses, setTotalGroupExpenses] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Datos de /api/groups/[id]/balance
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // UI
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [activeTab, setActiveTab] = useState<ActiveTab>("resumen");

  // AbortController refs
  const sharedAbortRef = useRef<AbortController | null>(null);
  const summaryAbortRef = useRef<AbortController | null>(null);

  // ─── Mount: auth + grupos + categorías ───────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/groups").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/categories").then((r) => (r.ok ? r.json() : [])),
    ]).then(([authData, groupsData, categoriesData]) => {
      if (authData?.user) setCurrentUserId(authData.user.id);
      setGroups(Array.isArray(groupsData) ? groupsData : []);
      setCategories(Array.isArray(categoriesData) ? categoriesData : []);
    });
  }, []);

  // ─── Auto-select single group ─────────────────────────────────────────────

  useEffect(() => {
    if (groups.length === 1) setSelectedGroupId(groups[0].id);
  }, [groups]);

  // ─── Reset página y expandido cuando cambia contexto ─────────────────────

  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [selectedGroupId, month, year, typeFilter, categoryFilter, dayFilter]);

  // ─── Balance (solo al cambiar grupo) ─────────────────────────────────────

  useEffect(() => {
    if (!selectedGroupId) { setBalance([]); return; }
    setBalanceLoading(true);
    fetch(`/api/groups/${selectedGroupId}/balance`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setBalance(Array.isArray(d) ? d : []))
      .finally(() => setBalanceLoading(false));
  }, [selectedGroupId]);

  // ─── Summary (grupo o mes/año) ────────────────────────────────────────────

  const loadSummary = useCallback(() => {
    if (!selectedGroupId) {
      setMemberStats([]);
      setGroupRecurring([]);
      setTotalGroupExpenses(0);
      return;
    }
    summaryAbortRef.current?.abort();
    summaryAbortRef.current = new AbortController();
    const { signal } = summaryAbortRef.current;

    setSummaryLoading(true);
    fetch(`/api/groups/${selectedGroupId}/summary?month=${month}&year=${year}`, { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setMemberStats(d.memberStats ?? []);
        setGroupRecurring(d.recurring ?? []);
        setTotalGroupExpenses(d.totalGroupExpenses ?? 0);
      })
      .catch((err) => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => setSummaryLoading(false));
  }, [selectedGroupId, month, year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  // ─── Shared (grupo, mes, filtros o página) ────────────────────────────────

  const loadShared = useCallback(() => {
    if (!selectedGroupId) {
      setItems([]);
      setSummary(null);
      setPagination(null);
      return;
    }
    sharedAbortRef.current?.abort();
    sharedAbortRef.current = new AbortController();
    const { signal } = sharedAbortRef.current;

    setSharedLoading(true);
    const params = new URLSearchParams({
      month: String(month),
      year: String(year),
      groupId: selectedGroupId,
      type: typeFilter,
      page: String(currentPage),
      limit: "15",
    });
    if (categoryFilter) params.set("categoryId", categoryFilter);
    if (dayFilter) params.set("day", dayFilter);

    fetch(`/api/shared?${params}`, { signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setItems(d.items ?? []);
        setSummary(d.summary ?? null);
        setPagination(d.pagination ?? null);
      })
      .catch((err) => { if (err.name !== "AbortError") console.error(err); })
      .finally(() => setSharedLoading(false));
  }, [selectedGroupId, month, year, typeFilter, categoryFilter, dayFilter, currentPage]);

  useEffect(() => { loadShared(); }, [loadShared]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  function clearFilters() {
    setTypeFilter("all");
    setCategoryFilter("");
    setDayFilter("");
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    if (tab === "resumen") clearFilters();
  }

  // ─── Derived state ────────────────────────────────────────────────────────

  const hasActiveFilters = typeFilter !== "all" || categoryFilter !== "" || dayFilter !== "";

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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compartidos</h1>
        <Link
          href="/dashboard/groups"
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium transition-colors"
        >
          Administrar grupos →
        </Link>
      </div>

      {/* ── Control bar ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4 space-y-3">

        {/* Fila 1: grupo + navegación de mes */}
        <div className="flex flex-wrap items-center justify-between gap-3">

          {/* Selector de grupo */}
          <div className="flex items-center gap-2 flex-wrap">
            {groups.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Sin grupos.{" "}
                <Link href="/dashboard/groups" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                  Creá uno
                </Link>
              </p>
            )}
            {groups.length === 1 && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Grupo: <span className="font-semibold text-gray-800 dark:text-gray-100">{groups[0].name}</span>
              </p>
            )}
            {groups.length > 1 && groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  selectedGroupId === g.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-500"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>

          {/* Navegador de mes — heading de capítulo */}
          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-300 transition-colors"
            >
              ←
            </button>
            <span className="text-lg font-bold px-6 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg min-w-[190px] text-center text-gray-800 dark:text-gray-100 select-none">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button
              onClick={nextMonth}
              className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-300 transition-colors"
            >
              →
            </button>
          </div>
        </div>

        {/* Fila 2: filtros — solo visible en tab Movimientos */}
        {activeTab === "movimientos" && (
          <div className="flex flex-wrap items-center gap-3 pt-1 border-t dark:border-gray-700">
            {/* Type chips */}
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden text-xs font-medium">
              {(["all", "expense", "recurring"] as const).map((t, i) => {
                const labels = { all: "Todos", expense: "Únicos", recurring: "Recurrentes" };
                return (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1.5 transition-colors ${
                      i > 0 ? "border-l border-gray-200 dark:border-gray-600" : ""
                    } ${
                      typeFilter === t
                        ? "bg-indigo-600 text-white"
                        : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                    }`}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100 text-gray-700"
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              max={31}
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              placeholder="Día"
              className="w-20 px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100 text-gray-700"
            />

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 transition-colors"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Tarjetas métricas ──────────────────────────────────────────────── */}
      {(sharedLoading && !summary) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : summary ? (
        (() => {
          const myStats = memberStats.find((m) => m.userId === currentUserId);
          const difference = myStats?.difference ?? 0;
          const isPositive = difference >= 0;
          return (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total compartido</p>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">${formatCurrency(totalGroupExpenses)}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{MONTH_NAMES[month - 1]} {year}</p>
              </div>
              <div className={`${isPositive ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800'} border rounded-xl p-4`}>
                <p className={`text-xs font-medium ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} uppercase tracking-wide`}>Diferencia del mes</p>
                <p className={`text-2xl font-bold ${isPositive ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'} mt-1`}>${formatCurrency(Math.abs(difference))}</p>
                <p className={`text-xs ${isPositive ? 'text-green-400 dark:text-green-500' : 'text-red-400 dark:text-red-500'} mt-0.5`}>{isPositive ? 'Pagaste de más' : 'Debés en neto'}</p>
              </div>
            </div>
          );
        })()
      ) : null}

      {/* ── Balance de deudas (acumulado histórico) ────────────────────────── */}
      {selectedGroupId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
          <div className="p-4 border-b dark:border-gray-700 flex items-baseline justify-between gap-2">
            <h2 className="font-semibold text-gray-800 dark:text-gray-100">Balance de deudas</h2>
            <span className="text-xs text-gray-400 dark:text-gray-500">Acumulado histórico</span>
          </div>
          <div className="p-4">
            {balanceLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-48" />
              </div>
            ) : balance.length === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Todos al día
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {balance.map((entry, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-700/50 border dark:border-gray-600 rounded-lg px-3 py-2"
                  >
                    <span className="font-semibold text-red-600 dark:text-red-400">{entry.debtorName}</span>
                    <span className="text-gray-400 dark:text-gray-500 text-xs">le debe a</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">{entry.creditorName}</span>
                    <span className="font-bold text-gray-800 dark:text-gray-200 ml-1">${formatCurrency(entry.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      {selectedGroupId && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">

          {/* Tab header */}
          <div className="flex border-b dark:border-gray-700">
            {(["resumen", "movimientos"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? "border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {tab === "resumen" ? "Resumen" : "Movimientos"}
              </button>
            ))}
          </div>

          {/* ── Tab: Resumen (tabla Ideal vs Real) ─────────────────────── */}
          {activeTab === "resumen" && (
            <div>
              <div className="p-4 border-b dark:border-gray-700">
                <h2 className="font-semibold text-gray-800 dark:text-gray-100">
                  Miembros — {MONTH_NAMES[month - 1]} {year}
                </h2>
              </div>
              {summaryLoading ? (
                <div className="p-6 space-y-3">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8" />)}
                </div>
              ) : memberStats.length === 0 ? (
                <p className="p-6 text-sm text-gray-400">Sin miembros en este grupo.</p>
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
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none hidden sm:table-cell"
                          onClick={() => handleSort("income")}
                          title="Ingreso mensual registrado"
                        >
                          Ingreso <SortIcon col="income" />
                        </th>
                        <th
                          className="px-4 py-3 text-right hidden sm:table-cell"
                          title="Porcentaje proporcional a los ingresos del grupo"
                        >
                          %
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none whitespace-nowrap hidden sm:table-cell"
                          onClick={() => handleSort("idealToPay")}
                          title="Cuánto debería pagar si los gastos se distribuyeran en proporción a su ingreso"
                        >
                          Cuota ideal <SortIcon col="idealToPay" />
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                          onClick={() => handleSort("totalPaid")}
                          title="Total que pagó de su bolsillo por gastos del grupo este mes"
                        >
                          Pagó <SortIcon col="totalPaid" />
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none"
                          onClick={() => handleSort("difference")}
                          title="Pagó − cuota ideal. Verde: pagó de más. Rojo: pagó de menos."
                        >
                          Diferencia <SortIcon col="difference" />
                        </th>
                        <th
                          className="px-4 py-3 text-right cursor-pointer hover:text-gray-800 dark:hover:text-gray-100 select-none whitespace-nowrap hidden sm:table-cell"
                          onClick={() => handleSort("remainingIncome")}
                          title="Ingreso mensual menos lo que pagó — cuánto del sueldo queda disponible"
                        >
                          Sobrante <SortIcon col="remainingIncome" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                      {sortedStats.map((stat) => (
                        <tr key={stat.userId} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{stat.name}</td>
                          <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                            {stat.income !== null ? `$${formatCurrency(stat.income)}` : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 hidden sm:table-cell">{stat.idealPercentage.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap hidden sm:table-cell">
                            ${formatCurrency(stat.idealToPay)}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap text-gray-800 dark:text-gray-200">${formatCurrency(stat.totalPaid)}</td>
                          <td className="px-4 py-3 text-right">
                            {Math.abs(stat.difference) < 0.01 ? (
                              <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                $0
                              </span>
                            ) : stat.difference > 0 ? (
                              <span className="inline-flex items-center gap-0.5 justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 whitespace-nowrap">
                                ▲ +${formatCurrency(stat.difference)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 whitespace-nowrap">
                                ▼ -${formatCurrency(Math.abs(stat.difference))}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap hidden sm:table-cell">
                            {stat.remainingIncome !== null ? `$${formatCurrency(stat.remainingIncome)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30">
                        <td className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200">
                          Total del mes
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                          {memberStats.some((s) => s.income !== null)
                            ? `$${formatCurrency(memberStats.reduce((s, m) => s + (m.income ?? 0), 0))}`
                            : "—"}
                        </td>
                        <td className="hidden sm:table-cell" />
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap hidden sm:table-cell">
                          ${formatCurrency(totalGroupExpenses)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap">
                          ${formatCurrency(memberStats.reduce((s, m) => s + m.totalPaid, 0))}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500" title="La diferencia total siempre suma $0">
                            $0 ✓
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                          {memberStats.some((s) => s.remainingIncome !== null)
                            ? `$${formatCurrency(memberStats.reduce((s, m) => s + (m.remainingIncome ?? 0), 0))}`
                            : "—"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Movimientos ────────────────────────────────────────── */}
          {activeTab === "movimientos" && (
            <div>

              {/* Lista de gastos */}
              <div>
                {sharedLoading && (
                  <div className="p-6 space-y-3">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
                  </div>
                )}

                {!sharedLoading && items.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-14 text-center px-6">
                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">Sin gastos compartidos</p>
                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">No hay registros para {MONTH_NAMES[month - 1]} {year}</p>
                  </div>
                )}

                {!sharedLoading && items.length > 0 && (
                  <div className="divide-y dark:divide-gray-700">
                    {items.map((entry) => {
                      const isExpanded = expandedId === entry.id;
                      const payerSharesTotal = entry.shares.reduce((s, sh) => s + sh.amount, 0);
                      const payerAmount = entry.totalAmount - payerSharesTotal;
                      const payerPct = 100 - entry.shares.reduce((s, sh) => s + sh.percentage, 0);

                      return (
                        <div key={entry.id}>
                          <div
                            className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                            onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className="w-2.5 h-2.5 rounded-full mt-2 shrink-0"
                                style={{ backgroundColor: entry.category.color }}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                                    {entry.description}
                                  </span>
                                  {entry.role === "payer" ? (
                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                      Vos pagaste
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" /></svg>
                                      Debés a {entry.payerName}
                                    </span>
                                  )}
                                  {entry.type === "recurring" && (
                                    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                                      ↻ {FREQ_LABELS[entry.frequency ?? ""] ?? entry.frequency}
                                    </span>
                                  )}
                                  <span
                                    className="text-xs px-1.5 py-0.5 rounded font-medium"
                                    style={{ backgroundColor: entry.category.color + "22", color: entry.category.color }}
                                  >
                                    {entry.category.name}
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-500 dark:text-gray-400">
                                  <span>
                                    {new Date(entry.date).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                                  </span>
                                  <span>
                                    Total: <span className="font-medium text-gray-700 dark:text-gray-300">${formatCurrency(entry.totalAmount)}</span>
                                  </span>
                                  {entry.role === "debtor" && (
                                    <span className="text-orange-600 dark:text-orange-400">
                                      Mi parte: <span className="font-semibold">${formatCurrency(entry.myAmount)}</span>
                                      {entry.myPercentage !== null && (
                                        <span className="text-gray-400 ml-1">({entry.myPercentage.toFixed(1)}%)</span>
                                      )}
                                    </span>
                                  )}
                                  {entry.role === "payer" && entry.myAmount > 0 && (
                                    <span className="text-green-600 dark:text-green-400">
                                      Otros deben: <span className="font-semibold">${formatCurrency(entry.myAmount)}</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                              <svg
                                className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-6 pb-4 pt-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 transition-all duration-200">
                              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                                Desglose de participantes
                              </p>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-left text-xs text-gray-400 dark:text-gray-500">
                                    <th className="pb-1.5 font-medium">Participante</th>
                                    <th className="pb-1.5 font-medium text-right w-16">%</th>
                                    <th className="pb-1.5 font-medium text-right w-24">Monto</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-600">
                                  <tr className="bg-green-50/50 dark:bg-green-900/10">
                                    <td className="py-1.5 text-gray-700 dark:text-gray-300">
                                      {entry.payerName}
                                      <span className="ml-1.5 text-xs text-green-600 dark:text-green-400">(pagó)</span>
                                    </td>
                                    <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{payerPct.toFixed(1)}%</td>
                                    <td className="py-1.5 text-right font-medium text-gray-800 dark:text-gray-200">${formatCurrency(payerAmount)}</td>
                                  </tr>
                                  {entry.shares.map((sh) => (
                                    <tr
                                      key={sh.id}
                                      className={sh.userId === currentUserId ? "bg-orange-50/50 dark:bg-orange-900/10" : ""}
                                    >
                                      <td className="py-1.5 text-gray-700 dark:text-gray-300">
                                        {sh.user.name}
                                        {sh.userId === currentUserId && (
                                          <span className="ml-1.5 text-xs text-orange-500 dark:text-orange-400">(vos)</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{sh.percentage.toFixed(1)}%</td>
                                      <td className="py-1.5 text-right font-medium text-gray-800 dark:text-gray-200">${formatCurrency(sh.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Paginación */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="flex items-center justify-between py-3 px-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {pagination.total} resultado{pagination.total !== 1 ? "s" : ""} · página {pagination.page} de {pagination.totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={pagination.page === 1}
                        className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        ←
                      </button>
                      {getPageNumbers(pagination.page, pagination.totalPages).map((n) => (
                        <button
                          key={n}
                          onClick={() => setCurrentPage(n)}
                          className={`px-2.5 py-1.5 text-sm rounded-lg border transition-colors ${
                            n === pagination.page
                              ? "bg-indigo-600 text-white border-indigo-600"
                              : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                        disabled={pagination.page === pagination.totalPages}
                        className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        →
                      </button>
                    </div>
                  </div>
                )}

                {pagination && pagination.totalPages === 1 && pagination.total > 0 && (
                  <div className="px-4 py-2.5 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {pagination.total} resultado{pagination.total !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Recurrentes del grupo */}
              <div className="border-t dark:border-gray-700">
                <div className="p-4 border-b dark:border-gray-700">
                  <h2 className="font-semibold text-gray-800 dark:text-gray-100">Recurrentes del grupo</h2>
                </div>
                {summaryLoading ? (
                  <div className="p-6 space-y-3">
                    {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12" />)}
                  </div>
                ) : groupRecurring.length === 0 ? (
                  <p className="p-6 text-sm text-gray-400">Sin gastos recurrentes asociados al grupo.</p>
                ) : (
                  <div className="divide-y dark:divide-gray-700">
                    {groupRecurring.map((rec) => {
                      const payerName = rec.payer?.name ?? rec.user.name;
                      return (
                        <div key={rec.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: rec.category.color }} />
                            <div>
                              <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{rec.description}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {rec.category.name} · {FREQ_LABELS[rec.frequency] ?? rec.frequency} · Paga: {payerName}
                              </p>
                            </div>
                          </div>
                          <span className="font-semibold text-gray-800 dark:text-gray-100">${formatCurrency(rec.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

      {/* ── Sin grupo seleccionado (múltiples grupos) ──────────────────────── */}
      {!selectedGroupId && groups.length > 1 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">Seleccioná un grupo para ver el resumen.</p>
        </div>
      )}

    </div>
  );
}
