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

interface User {
  id: string;
  name: string;
  email: string;
}

interface Installment {
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paid: boolean;
}

interface ShareEntry {
  id: string;
  userId: string;
  percentage: number;
  amount: number;
  settled: boolean;
  user: { id: string; name: string };
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;
  category: Category;
  creditCard: CreditCard | null;
  totalInstallments: number | null;
  isShared: boolean;
  splitMode: string;
  installments: Installment[];
  shares: ShareEntry[];
}

interface GroupMember {
  userId: string;
  percentage: number;
  user: { id: string; name: string };
}

interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

type ManualShare = { userId: string; name: string; percentage: number };

const emptyForm = {
  amount: "",
  description: "",
  date: "",
  categoryId: "",
  creditCardId: "",
  totalInstallments: "1",
  isShared: false,
  splitMode: "auto" as "auto" | "manual",
  sharedUserIds: [] as string[],
  manualShares: [] as ManualShare[],
  groupId: "",
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition";

const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [filterMonth, setFilterMonth] = useState(() => new Date().getMonth() + 1);
  const [filterYear, setFilterYear] = useState(() => new Date().getFullYear());
  const [rawDesc, setRawDesc] = useState("");
  const [filterDesc, setFilterDesc] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const LIMIT = 25;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/credit-cards").then((r) => r.json()).then(setCreditCards);
    fetch("/api/auth/users").then((r) => r.ok ? r.json() : []).then((d) => setUsers(Array.isArray(d) ? d : []));
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then((d) => d?.user && setCurrentUser(d.user));
    fetch("/api/groups").then((r) => r.ok ? r.json() : []).then((d) => setGroups(Array.isArray(d) ? d : []));
  }, []);

  // Debounce description input
  useEffect(() => {
    const t = setTimeout(() => setFilterDesc(rawDesc), 400);
    return () => clearTimeout(t);
  }, [rawDesc]);

  // Reset to page 1 when any filter changes
  useEffect(() => {
    setPage(1);
  }, [filterMonth, filterYear, filterCat, filterDesc]);

  // Load expenses when page or filters change
  useEffect(() => {
    loadExpenses();
  }, [filterMonth, filterYear, filterCat, filterDesc, page]);

  function loadExpenses() {
    const params = new URLSearchParams();
    params.set("month", String(filterMonth));
    params.set("year", String(filterYear));
    if (filterCat) params.set("categoryId", filterCat);
    if (filterDesc.trim()) params.set("description", filterDesc.trim());
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

  function toggleParticipant(user: User, checked: boolean) {
    if (form.splitMode === "auto") {
      const ids = checked
        ? [...form.sharedUserIds, user.id]
        : form.sharedUserIds.filter((id) => id !== user.id);
      setForm({ ...form, sharedUserIds: ids });
    } else {
      const shares = checked
        ? [...form.manualShares, { userId: user.id, name: user.name, percentage: 0 }]
        : form.manualShares.filter((s) => s.userId !== user.id);
      setForm({ ...form, manualShares: shares });
    }
  }

  function updateManualPct(userId: string, pct: number) {
    setForm({
      ...form,
      manualShares: form.manualShares.map((s) => s.userId === userId ? { ...s, percentage: pct } : s),
    });
  }

  function switchSplitMode(mode: "auto" | "manual") {
    if (mode === "manual" && currentUser) {
      const participants = [
        { userId: currentUser.id, name: currentUser.name, percentage: 0 },
        ...form.sharedUserIds.map((uid) => {
          const u = users.find((x) => x.id === uid);
          return { userId: uid, name: u?.name ?? uid, percentage: 0 };
        }),
      ];
      setForm({ ...form, splitMode: "manual", manualShares: participants, sharedUserIds: [] });
    } else {
      setForm({ ...form, splitMode: "auto", manualShares: [], sharedUserIds: [] });
    }
  }

  function handleGroupSelect(gId: string) {
    if (!gId) {
      setForm((prev) => ({ ...prev, groupId: "" }));
      return;
    }
    const group = groups.find((g) => g.id === gId);
    if (!group) return;

    if (form.splitMode === "auto") {
      const memberIds = group.members
        .map((m) => m.userId)
        .filter((id) => id !== currentUser?.id);
      setForm((prev) => ({
        ...prev,
        groupId: gId,
        isShared: true,
        splitMode: "auto",
        sharedUserIds: memberIds,
        manualShares: [],
      }));
    } else {
      const manualShares = group.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        percentage: m.percentage,
      }));
      setForm((prev) => ({
        ...prev,
        groupId: gId,
        isShared: true,
        splitMode: "manual",
        manualShares,
        sharedUserIds: [],
      }));
    }
  }

  const manualTotal = form.manualShares.reduce((s, u) => s + (Number(u.percentage) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        amount: Number(form.amount),
        totalInstallments: Number(form.totalInstallments) > 1 ? Number(form.totalInstallments) : null,
        creditCardId: form.creditCardId || null,
        groupId: form.groupId || null,
      };

      if (form.isShared) {
        if (form.splitMode === "manual") {
          payload.sharedUsers = form.manualShares.map(({ userId, percentage }) => ({ userId, percentage: Number(percentage) }));
          payload.sharedUserIds = undefined;
        } else {
          payload.sharedUserIds = form.sharedUserIds;
          payload.sharedUsers = undefined;
        }
      } else {
        payload.sharedUserIds = [];
        payload.sharedUsers = undefined;
      }

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
    let manualShares: ManualShare[] = [];
    if (exp.splitMode === "manual") {
      const nonPayerShares = exp.shares
        .filter((s) => s.userId !== currentUser?.id)
        .map((s) => ({ userId: s.userId, name: s.user.name, percentage: s.percentage }));
      const nonPayerTotal = nonPayerShares.reduce((sum, s) => sum + s.percentage, 0);
      const payerPct = Math.max(0, 100 - nonPayerTotal);
      if (currentUser) {
        manualShares = [
          { userId: currentUser.id, name: currentUser.name, percentage: payerPct },
          ...nonPayerShares,
        ];
      } else {
        manualShares = nonPayerShares;
      }
    }

    setEditId(exp.id);
    setForm({
      amount: String(exp.amount),
      description: exp.description,
      date: exp.date.split("T")[0],
      categoryId: exp.category.id,
      creditCardId: exp.creditCard?.id ?? "",
      totalInstallments: String(exp.totalInstallments ?? 1),
      isShared: exp.isShared,
      splitMode: (exp.splitMode as "auto" | "manual") ?? "auto",
      sharedUserIds: exp.splitMode !== "manual"
        ? exp.shares.filter((s) => s.userId !== currentUser?.id).map((s) => s.userId)
        : [],
      manualShares,
      groupId: "",
    });
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

          {/* Row 2: Credit card, Installments, Shared toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
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

            <div>
              <label className={labelCls}>&nbsp;</label>
              <label className="flex items-center gap-3 w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                <input
                  type="checkbox"
                  checked={form.isShared}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked && groups.length > 0) {
                      const firstGroup = groups[0];
                      const memberIds = firstGroup.members
                        .map((m) => m.userId)
                        .filter((id) => id !== currentUser?.id);
                      setForm({
                        ...form,
                        isShared: true,
                        groupId: firstGroup.id,
                        splitMode: "auto",
                        sharedUserIds: memberIds,
                        manualShares: [],
                      });
                    } else {
                      setForm({ ...form, isShared: checked, groupId: "", splitMode: "auto", sharedUserIds: [], manualShares: [] });
                    }
                  }}
                  className="w-4 h-4 accent-indigo-600 shrink-0"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">Gasto compartido</span>
              </label>
            </div>
          </div>

          {/* Shared section */}
          {form.isShared && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-800/60 overflow-hidden shadow-sm">
              {/* Panel header */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-100 dark:border-indigo-800/50 bg-indigo-50 dark:bg-indigo-950/40">
                <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wide">Reparto</span>
              </div>

              <div className="p-4 space-y-4 bg-indigo-50/40 dark:bg-indigo-900/10">
                {/* Controls row: Group + Mode */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Group selector */}
                  {groups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Grupo:</span>
                      <select
                        value={form.groupId}
                        onChange={(e) => handleGroupSelect(e.target.value)}
                        className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                      >
                        <option value="">Sin grupo</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      {form.groupId && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                          <svg className="w-3 h-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          {groups.find((g) => g.id === form.groupId)?.name}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Split mode toggle — pill style */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Modo:</span>
                    <div className="flex p-0.5 rounded-lg bg-gray-100 dark:bg-gray-700/60 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => switchSplitMode("auto")}
                        className={`px-3 py-1.5 rounded-md transition-all duration-150 ${
                          form.splitMode === "auto"
                            ? "bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm font-semibold"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={() => switchSplitMode("manual")}
                        className={`px-3 py-1.5 rounded-md transition-all duration-150 ${
                          form.splitMode === "manual"
                            ? "bg-white dark:bg-gray-700 text-indigo-700 dark:text-indigo-300 shadow-sm font-semibold"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                      >
                        Manual (%)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Auto mode: participant chips */}
                {form.splitMode === "auto" && users.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                      Participantes (además de vos):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {users.map((u) => {
                        const isSelected = form.sharedUserIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-all duration-150 select-none ${
                              isSelected
                                ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
                                : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-700 dark:hover:text-indigo-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => toggleParticipant(u, e.target.checked)}
                              className="sr-only"
                            />
                            {isSelected && (
                              <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            )}
                            <span className="font-medium">{u.name}</span>
                          </label>
                        );
                      })}
                    </div>
                    {form.sharedUserIds.length > 0 && (
                      <p className="mt-2 text-xs text-indigo-600 dark:text-indigo-400">
                        {form.sharedUserIds.length + 1} participantes · split por ingresos
                      </p>
                    )}
                  </div>
                )}

                {/* Manual mode: percentage inputs */}
                {form.splitMode === "manual" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Participantes y porcentajes:
                      </p>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          Math.abs(manualTotal - 100) > 1
                            ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                            : "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                        }`}
                      >
                        Total: {manualTotal.toFixed(1)}%
                      </span>
                    </div>

                    {/* Add participants — chip style */}
                    {users.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {users.map((u) => {
                          const inShares = form.manualShares.some((s) => s.userId === u.id);
                          return (
                            <label
                              key={u.id}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-all duration-150 select-none ${
                                inShares
                                  ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
                                  : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-700 dark:hover:text-indigo-300"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={inShares}
                                onChange={(e) => toggleParticipant(u, e.target.checked)}
                                className="sr-only"
                              />
                              {inShares && (
                                <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                              <span className="font-medium">{u.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                  {/* Percentage rows */}
                  <div className="space-y-2">
                    {form.manualShares.map((s) => (
                      <div key={s.userId} className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                              {s.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm truncate text-gray-700 dark:text-gray-300 min-w-0">
                            {s.name}
                            {s.userId === currentUser?.id && (
                              <span className="ml-1 text-xs text-indigo-500 dark:text-indigo-400">(vos)</span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={s.percentage}
                            onChange={(e) => updateManualPct(s.userId, Number(e.target.value))}
                            className="w-16 sm:w-20 px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100 text-right"
                          />
                          <span className="text-sm text-gray-400">%</span>
                        </div>
                        {form.amount && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 hidden sm:inline">
                            = ${formatCurrency((Number(form.amount) * Number(s.percentage)) / 100)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  </div>
                )}
              </div>
            </div>
          )}

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
                onClick={() => { setEditId(null); setForm(emptyForm); }}
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
                      {exp.isShared && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium">
                          compartido
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        · {new Date(exp.date).toLocaleDateString("es")}
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
                      {exp.isShared && exp.shares.length > 0 && (
                        <button
                          onClick={() => setExpandedShareId(expandedShareId === exp.id ? null : exp.id)}
                          className={`text-xs px-2 py-1 rounded-md font-medium transition border ${
                            expandedShareId === exp.id
                              ? "bg-purple-600 text-white border-purple-600"
                              : "border-purple-200 dark:border-purple-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30"
                          }`}
                        >
                          Reparto
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

                {/* Shares expand */}
                {expandedShareId === exp.id && exp.shares.length > 0 && (
                  <div className="px-5 pb-4 pt-3 bg-purple-50/60 dark:bg-purple-900/10 border-t border-purple-100 dark:border-purple-900">
                    <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide mb-2">
                      Reparto
                    </p>
                    <div className="rounded-lg border border-purple-100 dark:border-purple-800 overflow-hidden overflow-x-auto">
                      <table className="w-full text-sm min-w-[320px]">
                        <thead className="bg-purple-50 dark:bg-purple-900/30">
                          <tr className="text-left">
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Participante</th>
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">%</th>
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Monto</th>
                            <th className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Estado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-purple-50 dark:divide-purple-900/30">
                          {exp.shares.map((s) => (
                            <tr key={s.id} className="bg-white dark:bg-gray-800">
                              <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{s.user.name}</td>
                              <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{s.percentage.toFixed(1)}%</td>
                              <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-200">${formatCurrency(s.amount)}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                    s.settled
                                      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                      : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                                  }`}
                                >
                                  {s.settled ? "Liquidado" : "Pendiente"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
