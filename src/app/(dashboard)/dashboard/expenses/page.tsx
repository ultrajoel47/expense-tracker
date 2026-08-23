"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";

interface Category {
  id: string;
  name: string;
  color: string;
}

interface CreditCard {
  id: string;
  name: string;
  color: string;
}

interface Installment {
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paid: boolean;
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;
  category: Category;
  creditCard: CreditCard | null;
  totalInstallments: number | null;
  installments: Installment[];
  scope: "casa" | "personal";
  payer: { id: string; name: string };
}

type ScopeFilter = "todos" | "casa" | "personal";

const emptyForm = {
  amount: "",
  description: "",
  date: "",
  categoryId: "",
  creditCardId: "",
  totalInstallments: "1",
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition";

const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [filterMonth, setFilterMonth] = useState(() => new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(() => new Date().getFullYear());
  const [rawDesc, setRawDesc] = useState("");
  const [filterDesc, setFilterDesc] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("todos");
  const [scope, setScope] = useState<"casa" | "personal">("casa");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const LIMIT = 25;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/credit-cards").then((r) => r.json()).then(setCreditCards);
  }, []);

  // Debounce description input
  useEffect(() => {
    const t = setTimeout(() => setFilterDesc(rawDesc), 400);
    return () => clearTimeout(t);
  }, [rawDesc]);

  // Reset to page 1 when any filter changes
  useEffect(() => {
    setPage(1);
  }, [filterMonth, filterYear, filterCat, filterDesc, scopeFilter]);

  // Load expenses when page or filters change
  useEffect(() => {
    loadExpenses();
  }, [filterMonth, filterYear, filterCat, filterDesc, scopeFilter, page]);

  function loadExpenses() {
    const params = new URLSearchParams();
    params.set("month", String(filterMonth));
    params.set("year", String(filterYear));
    if (filterCat) params.set("categoryId", filterCat);
    if (filterDesc.trim()) params.set("description", filterDesc.trim());
    if (scopeFilter !== "todos") params.set("scope", scopeFilter);
    params.set("page", String(page));
    params.set("limit", String(LIMIT));
    fetch(`/api/expenses?${params}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.data && res.meta) {
          setExpenses(res.data);
          setTotalPages(res.meta.totalPages);
          setTotalCount(res.meta.total);
        } else {
          // fallback for unexpected shape
          setExpenses(Array.isArray(res) ? res : []);
        }
      });
  }

  function prevMonth() {
    if (filterMonth === 1) { setFilterMonth(12); setFilterYear((y) => y - 1); }
    else setFilterMonth((m) => m - 1);
  }

  function nextMonth() {
    if (filterMonth === 12) { setFilterMonth(1); setFilterYear((y) => y + 1); }
    else setFilterMonth((m) => m + 1);
  }

  const monthLabel = new Date(filterYear, filterMonth - 1).toLocaleDateString("es", { month: "long", year: "numeric" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        amount: Number(form.amount),
        totalInstallments: Number(form.totalInstallments) > 1 ? Number(form.totalInstallments) : null,
        creditCardId: form.creditCardId || null,
        scope,
      };

      if (editId !== null) {
        await fetch(`/api/expenses/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setEditId(null);
      } else {
        await fetch("/api/expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setForm(emptyForm);
      setScope("casa");
      loadExpenses();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este gasto?")) return;
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    loadExpenses();
  }

  async function toggleInstallment(expenseId: string, num: number) {
    await fetch(`/api/expenses/${expenseId}/installments/${num}`, { method: "PUT" });
    loadExpenses();
  }

  function handleEdit(exp: Expense) {
    setEditId(exp.id);
    setForm({
      amount: String(exp.amount),
      description: exp.description,
      date: exp.date.split("T")[0],
      categoryId: exp.category.id,
      creditCardId: exp.creditCard?.id ?? "",
      totalInstallments: String(exp.totalInstallments ?? 1),
    });
    setScope(exp.scope);
  }

  const installmentPreview = (() => {
    const n = Number(form.totalInstallments);
    const amt = Number(form.amount);
    if (n > 1 && amt > 0 && form.date) {
      return Array.from({ length: n }, (_, i) => {
        const d = new Date(form.date);
        d.setMonth(d.getMonth() + i);
        return { num: i + 1, date: d.toLocaleDateString("es"), amount: formatCurrency(amt / n) };
      });
    }
    return [];
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gastos</h1>

      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {editId !== null ? "Editar Gasto" : "Nuevo Gasto"}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Row 1: Amount, Description, Date, Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label className={labelCls}>Monto</label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className={inputCls}
                required
              />
            </div>

            <div>
              <label className={labelCls}>Descripción</label>
              <input
                type="text"
                placeholder="Descripción del gasto"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                required
              />
            </div>

            <div>
              <label className={labelCls}>Fecha</label>
              {/* Date input with inline Hoy/Ayer chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className={`${inputCls} flex-1 min-w-0`}
                />
                <button
                  type="button"
                  onClick={() => setForm({ ...form, date: new Date().toISOString().split("T")[0] })}
                  className="shrink-0 px-2 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    setForm({ ...form, date: d.toISOString().split("T")[0] });
                  }}
                  className="shrink-0 px-2 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300 transition"
                >
                  Ayer
                </button>
              </div>
            </div>

            <div>
              <label className={labelCls}>Categoría</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className={inputCls}
                required
              >
                <option value="">Seleccionar...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Credit card, Installments */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <div>
              <label className={labelCls}>Tarjeta</label>
              <select
                value={form.creditCardId}
                onChange={(e) => setForm({ ...form, creditCardId: e.target.value })}
                className={inputCls}
              >
                <option value="">Sin tarjeta</option>
                {creditCards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Cuotas</label>
              <input
                type="number"
                min="1"
                max="60"
                value={form.totalInstallments}
                onChange={(e) => setForm({ ...form, totalInstallments: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Installment preview */}
          {installmentPreview.length > 0 && (
            <div className="rounded-lg border border-indigo-100 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/20 p-4">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide mb-3">
                Vista previa de cuotas
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {installmentPreview.map((p) => (
                  <div key={p.num} className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700/50 rounded-md px-2.5 py-1.5">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{p.num}.</span>{" "}
                    {p.date} — <span className="font-medium">${p.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Submit row */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={scope === "personal"}
                onChange={(e) => setScope(e.target.checked ? "personal" : "casa")}
              />
              Gasto personal (no lo ve la otra persona)
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {loading ? "Guardando..." : editId !== null ? "Actualizar" : "Agregar gasto"}
            </button>
            {editId !== null && (
              <button
                type="button"
                onClick={() => { setEditId(null); setForm(emptyForm); setScope("casa"); }}
                className="px-5 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </form>

      {/* ── Expense list ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Lista de Gastos</h2>
            {totalCount > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {totalCount} {totalCount === 1 ? "gasto" : "gastos"}
              </span>
            )}
          </div>
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Month picker */}
            <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-700">
              <button
                type="button"
                onClick={prevMonth}
                className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 transition min-w-[36px]"
                aria-label="Mes anterior"
              >
                ‹
              </button>
              <span className="px-1 text-xs font-medium text-gray-700 dark:text-gray-200 capitalize whitespace-nowrap">
                {monthLabel}
              </span>
              <button
                type="button"
                onClick={nextMonth}
                className="px-2.5 py-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600 transition min-w-[36px]"
                aria-label="Mes siguiente"
              >
                ›
              </button>
            </div>
            {/* Category filter */}
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {/* Description search */}
            <input
              type="search"
              placeholder="Buscar descripción..."
              value={rawDesc}
              onChange={(e) => setRawDesc(e.target.value)}
              className="text-xs px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 min-w-[160px]"
            />
            {/* Scope filter */}
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              {(["todos", "casa", "personal"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScopeFilter(value)}
                  className={`rounded-md px-3 py-1.5 text-sm capitalize transition ${
                    scopeFilter === value
                      ? "bg-white text-indigo-600 shadow-sm dark:bg-gray-700 dark:text-indigo-400"
                      : "text-gray-600 dark:text-gray-400"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {expenses.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No hay gastos para los filtros seleccionados
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {expenses.map((exp) => (
              <div key={exp.id}>
                {/* Main row */}
                <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition">
                  {/* Category dot */}
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: exp.category.color }}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {exp.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="text-xs text-gray-500 dark:text-gray-400">{exp.category.name}</span>
                      {exp.creditCard && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">· {exp.creditCard.name}</span>
                      )}
                      {exp.totalInstallments && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                          {exp.totalInstallments}c
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        · {new Date(exp.date).toLocaleDateString("es")}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {exp.scope === "casa" ? "Casa" : "Personal"} · {exp.payer.name}
                      </span>
                    </div>
                  </div>

                  {/* Amount + actions */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                      ${formatCurrency(exp.amount)}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {/* Expand buttons */}
                      {exp.totalInstallments && (
                        <button
                          onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
                          className={`text-xs px-2 py-1 rounded-md font-medium transition border ${
                            expandedId === exp.id
                              ? "bg-blue-600 text-white border-blue-600"
                              : "border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                          }`}
                        >
                          Cuotas
                        </button>
                      )}
                      <button
                        onClick={() => handleEdit(exp)}
                        className="text-xs px-2 py-1 rounded-md font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(exp.id)}
                        className="text-xs px-2 py-1 rounded-md font-medium border border-red-100 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Installments expand */}
                {expandedId === exp.id && exp.installments.length > 0 && (
                  <div className="px-5 pb-4 pt-3 bg-blue-50/60 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900">
                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-2">
                      Cuotas
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {exp.installments.map((inst) => (
                        <button
                          key={inst.installmentNumber}
                          onClick={() => toggleInstallment(exp.id, inst.installmentNumber)}
                          className={`text-xs px-3 py-2 rounded-lg border text-left transition ${
                            inst.paid
                              ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700 text-green-700 dark:text-green-400"
                              : "bg-white dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300"
                          }`}
                        >
                          <span className="font-semibold block">#{inst.installmentNumber}</span>
                          <span className="font-medium">${formatCurrency(inst.amount)}</span>
                          <span className="text-gray-400 dark:text-gray-500 block">{new Date(inst.dueDate).toLocaleDateString("es")}</span>
                          <span className={`mt-1 block font-medium ${inst.paid ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}>
                            {inst.paid ? "Pagada" : "Pendiente"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-3.5 border-t border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              Mostrando {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, totalCount)} de {totalCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, idx) =>
                  item === "..." ? (
                    <span key={`ellipsis-${idx}`} className="px-1 text-xs text-gray-400">…</span>
                  ) : (
                    <button
                      key={item}
                      onClick={() => setPage(item as number)}
                      className={`px-2.5 py-1.5 text-xs rounded-md border transition ${
                        page === item
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2.5 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-40 transition"
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
