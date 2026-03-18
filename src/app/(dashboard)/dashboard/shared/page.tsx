"use client";

import { useEffect, useState, useCallback } from "react";
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
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Diario",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  YEARLY: "Anual",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPageNumbers(current: number, total: number): number[] {
  const range = 2;
  const start = Math.max(1, current - range);
  const end = Math.min(total, current + range);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SharedPage() {
  const now = new Date();

  // Auth
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Groups
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");

  // Month navigation
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Filters
  const [typeFilter, setTypeFilter] = useState<"all" | "expense" | "recurring">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [dayFilter, setDayFilter] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);

  // Data
  const [items, setItems] = useState<CombinedEntry[]>([]);
  const [summary, setSummary] = useState<MonthlySummary | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  // UI
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ─── Mount: load auth + groups + categories ──────────────────────────────

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setCurrentUserId(d.user.id));

    fetch("/api/groups")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list: Group[] = Array.isArray(d) ? d.map((g: { id: string; name: string }) => ({ id: g.id, name: g.name })) : [];
        setGroups(list);
      });

    fetch("/api/categories")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCategories(Array.isArray(d) ? d : []));
  }, []);

  // Auto-select single group
  useEffect(() => {
    if (groups.length === 1) setSelectedGroupId(groups[0].id);
  }, [groups]);

  // ─── Reset page when filters change ──────────────────────────────────────

  useEffect(() => {
    setCurrentPage(1);
    setExpandedId(null);
  }, [selectedGroupId, month, year, typeFilter, categoryFilter, dayFilter]);

  // ─── Fetch data ───────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        month: String(month),
        year: String(year),
        type: typeFilter,
        page: String(currentPage),
        limit: "15",
      });
      if (selectedGroupId) params.set("groupId", selectedGroupId);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (dayFilter) params.set("day", dayFilter);

      const res = await fetch(`/api/shared?${params}`);
      const data = await res.json();
      setItems(data.items ?? []);
      setSummary(data.summary ?? null);
      setPagination(data.pagination ?? null);
    } finally {
      setLoading(false);
    }
  }, [selectedGroupId, month, year, typeFilter, categoryFilter, dayFilter, currentPage]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const hasActiveFilters = typeFilter !== "all" || categoryFilter !== "" || dayFilter !== "";

  function clearFilters() {
    setTypeFilter("all");
    setCategoryFilter("");
    setDayFilter("");
  }

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(year - 1); }
    else setMonth(month - 1);
  }

  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(year + 1); }
    else setMonth(month + 1);
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compartidos</h1>

        {/* Group selector */}
        {groups.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  selectedGroupId === g.id
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-500"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        )}

        {groups.length === 1 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Grupo: <span className="font-medium text-gray-800 dark:text-gray-200">{groups[0].name}</span>
          </p>
        )}
      </div>

      {/* ── Month nav + Filters ─────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4 space-y-3">

        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-300 transition-colors"
          >
            &larr;
          </button>
          <span className="text-sm font-semibold px-4 py-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg min-w-[160px] text-center text-gray-800 dark:text-gray-200">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm text-gray-700 dark:text-gray-300 transition-colors"
          >
            &rarr;
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-3">

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

          {/* Category */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-gray-100 text-gray-700"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          {/* Day */}
          <input
            type="number"
            min={1}
            max={31}
            value={dayFilter}
            onChange={(e) => setDayFilter(e.target.value)}
            placeholder="Día"
            className="w-20 px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-gray-100 text-gray-700"
          />

          {/* Clear */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 underline underline-offset-2 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Total compartido</p>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mt-1">${formatCurrency(summary.totalShared)}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{MONTH_NAMES[month - 1]} {year}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-xl p-4">
            <p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide">Mi parte a pagar</p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">${formatCurrency(summary.myShare)}</p>
            <p className="text-xs text-red-400 dark:text-red-500 mt-0.5">Lo que debo a otros</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800 rounded-xl p-4">
            <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide">Lo que otros deben</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300 mt-1">${formatCurrency(summary.othersShare)}</p>
            <p className="text-xs text-green-400 dark:text-green-500 mt-0.5">Parte de gastos que pagué</p>
          </div>
        </div>
      )}

      {/* ── Expense list ────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Empty */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium text-sm">Sin gastos compartidos</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">No hay registros para {MONTH_NAMES[month - 1]} {year}</p>
          </div>
        )}

        {/* Items */}
        {!loading && items.length > 0 && (
          <div className="divide-y dark:divide-gray-700">
            {items.map((entry) => {
              const isExpanded = expandedId === entry.id;
              const payerSharesTotal = entry.shares.reduce((s, sh) => s + sh.amount, 0);
              const payerAmount = entry.totalAmount - payerSharesTotal;
              const payerPct = 100 - entry.shares.reduce((s, sh) => s + sh.percentage, 0);

              return (
                <div key={entry.id}>
                  {/* Main row */}
                  <div
                    className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  >
                    <div className="flex items-start gap-3">

                      {/* Category dot */}
                      <div
                        className="w-2.5 h-2.5 rounded-full mt-2 shrink-0"
                        style={{ backgroundColor: entry.category.color }}
                      />

                      {/* Content */}
                      <div className="flex-1 min-w-0">

                        {/* Title + badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
                            {entry.description}
                          </span>

                          {/* Role badge */}
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

                          {/* Recurring badge */}
                          {entry.type === "recurring" && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
                              ↻ {FREQ_LABELS[entry.frequency ?? ""] ?? entry.frequency}
                            </span>
                          )}

                          {/* Category badge */}
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: entry.category.color + "22",
                              color: entry.category.color,
                            }}
                          >
                            {entry.category.name}
                          </span>
                        </div>

                        {/* Meta row */}
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

                      {/* Chevron */}
                      <svg
                        className={`w-4 h-4 text-gray-400 shrink-0 mt-1 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded share detail */}
                  {isExpanded && (
                    <div className="px-6 pb-4 pt-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700">
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
                          {/* Synthetic payer row */}
                          <tr className="bg-green-50/50 dark:bg-green-900/10">
                            <td className="py-1.5 text-gray-700 dark:text-gray-300">
                              {entry.payerName}
                              <span className="ml-1.5 text-xs text-green-600 dark:text-green-400">(pagó)</span>
                            </td>
                            <td className="py-1.5 text-right text-gray-500 dark:text-gray-400">{payerPct.toFixed(1)}%</td>
                            <td className="py-1.5 text-right font-medium text-gray-800 dark:text-gray-200">${formatCurrency(payerAmount)}</td>
                          </tr>
                          {/* Debtor rows */}
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

        {/* ── Pagination ─────────────────────────────────────────────────── */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between py-3 px-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {pagination.total} resultado{pagination.total !== 1 ? "s" : ""} &middot; página {pagination.page} de {pagination.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page === 1}
                className="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                &larr;
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
                &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Pagination hint when single page */}
        {pagination && pagination.totalPages === 1 && pagination.total > 0 && (
          <div className="px-4 py-2.5 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {pagination.total} resultado{pagination.total !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
