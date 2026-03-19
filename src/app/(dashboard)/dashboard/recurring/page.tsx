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
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface ShareEntry {
  id: string;
  userId: string;
  percentage: number;
  amount: number;
  settled: boolean;
  user: { id: string; name: string };
}

interface RecurringExpense {
  id: string;
  amount: number;
  description: string;
  frequency: string;
  dayOfMonth: number | null;
  nextDue: string;
  active: boolean;
  isShared: boolean;
  splitMode: string;
  payerId: string | null;
  payer: { id: string; name: string } | null;
  category: Category;
  creditCard: CreditCard | null;
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

const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const FREQ_LABELS: Record<string, string> = { DAILY: "Diario", WEEKLY: "Semanal", MONTHLY: "Mensual", YEARLY: "Anual" };

const emptyForm = {
  amount: "",
  description: "",
  categoryId: "",
  creditCardId: "",
  frequency: "MONTHLY",
  dayOfMonth: "",
  nextDue: "",
  isShared: false,
  splitMode: "auto" as "auto" | "manual",
  sharedUserIds: [] as string[],
  manualShares: [] as ManualShare[],
  groupId: "",
  payerId: "",
};

export default function RecurringPage() {
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/credit-cards").then((r) => r.json()).then(setCreditCards);
    fetch("/api/auth/users").then((r) => r.ok ? r.json() : []).then((d) => setUsers(Array.isArray(d) ? d : []));
    fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).then((d) => d?.user && setCurrentUser(d.user));
    fetch("/api/groups").then((r) => r.ok ? r.json() : []).then((d) => setGroups(Array.isArray(d) ? d : []));
  }, []);

  useEffect(() => {
    loadAll();
  }, [filterCat, filterActive]);

  function loadAll() {
    const params = new URLSearchParams();
    if (filterCat) params.set("categoryId", filterCat);
    if (filterActive === "active") params.set("active", "true");
    if (filterActive === "inactive") params.set("active", "false");
    fetch(`/api/recurring-expenses?${params}`).then((r) => r.json()).then((d) => setRecurring(Array.isArray(d) ? d : []));
  }

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

  const manualTotal = form.manualShares.reduce((s, u) => s + (Number(u.percentage) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        amount: Number(form.amount),
        creditCardId: form.creditCardId || null,
        dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : null,
        groupId: form.groupId || null,
        payerId: form.isShared ? (form.payerId || null) : null,
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

      if (editId) {
        await fetch(`/api/recurring-expenses/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setEditId(null);
      } else {
        await fetch("/api/recurring-expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setForm(emptyForm);
      loadAll();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este gasto recurrente?")) return;
    await fetch(`/api/recurring-expenses/${id}`, { method: "DELETE" });
    loadAll();
  }

  async function toggleActive(rec: RecurringExpense) {
    await fetch(`/api/recurring-expenses/${rec.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !rec.active }),
    });
    loadAll();
  }

  function handleEdit(rec: RecurringExpense) {
    let manualShares: ManualShare[] = [];
    if (rec.splitMode === "manual") {
      const nonPayerShares = rec.shares
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

    setEditId(rec.id);
    setForm({
      amount: String(rec.amount),
      description: rec.description,
      categoryId: rec.category.id,
      creditCardId: rec.creditCard?.id ?? "",
      frequency: rec.frequency,
      dayOfMonth: rec.dayOfMonth !== null ? String(rec.dayOfMonth) : "",
      nextDue: rec.nextDue.split("T")[0],
      isShared: rec.isShared,
      splitMode: (rec.splitMode as "auto" | "manual") ?? "auto",
      sharedUserIds: rec.splitMode !== "manual"
        ? rec.shares.filter((s) => s.userId !== currentUser?.id).map((s) => s.userId)
        : [],
      manualShares,
      groupId: "",
      payerId: rec.payerId ?? "",
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Gastos Recurrentes</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border dark:border-gray-700 space-y-4">
        <h2 className="font-semibold">{editId ? "Editar Recurrente" : "Nuevo Recurrente"}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <input
            type="number"
            step="0.01"
            placeholder="Monto"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
          <input
            type="text"
            placeholder="Descripcion (ej: Alquiler)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          >
            <option value="">Categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={form.creditCardId}
            onChange={(e) => setForm({ ...form, creditCardId: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
          >
            <option value="">Sin tarjeta</option>
            {creditCards.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{FREQ_LABELS[f]}</option>
            ))}
          </select>
          <input
            type="date"
            placeholder="Proximo vencimiento"
            value={form.nextDue}
            onChange={(e) => setForm({ ...form, nextDue: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
        </div>

        <label className="flex items-center gap-3 px-4 py-2 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 w-fit">
          <input
            type="checkbox"
            checked={form.isShared}
            onChange={(e) => setForm({ ...form, isShared: e.target.checked })}
            className="w-4 h-4 accent-indigo-600"
          />
          <span className="text-sm">Gasto compartido</span>
        </label>

        {form.isShared && (
          <div className="space-y-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
            {/* Group selector */}
            {groups.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Grupo:</span>
                <select
                  value={form.groupId}
                  onChange={(e) => handleGroupSelect(e.target.value)}
                  className="px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">Sin grupo</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Payer selector */}
            {users.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">¿Quién adelanta el pago?</span>
                <select
                  value={form.payerId}
                  onChange={(e) => setForm({ ...form, payerId: e.target.value })}
                  className="px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">Yo (por defecto)</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">Modo:</span>
              <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => switchSplitMode("auto")}
                  className={`px-3 py-1.5 ${form.splitMode === "auto" ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"}`}
                >
                  Auto (ingresos)
                </button>
                <button
                  type="button"
                  onClick={() => switchSplitMode("manual")}
                  className={`px-3 py-1.5 ${form.splitMode === "manual" ? "bg-indigo-600 text-white" : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"}`}
                >
                  Manual (%)
                </button>
              </div>
            </div>

            {form.splitMode === "auto" && users.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-gray-600 dark:text-gray-400">Participantes (ademas de vos):</p>
                <div className="flex flex-wrap gap-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-white dark:hover:bg-gray-700 text-sm bg-white/60 dark:bg-gray-800/60">
                      <input
                        type="checkbox"
                        checked={form.sharedUserIds.includes(u.id)}
                        onChange={(e) => toggleParticipant(u, e.target.checked)}
                        className="w-4 h-4 accent-indigo-600"
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {form.splitMode === "manual" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Participantes y porcentajes:</p>
                  <span className={`text-sm font-medium ${Math.abs(manualTotal - 100) > 1 ? "text-red-500" : "text-green-600 dark:text-green-400"}`}>
                    Total: {manualTotal.toFixed(1)}%
                  </span>
                </div>
                {users.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {users.map((u) => {
                      const inShares = form.manualShares.some((s) => s.userId === u.id);
                      return (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-1.5 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-white dark:hover:bg-gray-700 text-sm bg-white/60 dark:bg-gray-800/60">
                          <input
                            type="checkbox"
                            checked={inShares}
                            onChange={(e) => toggleParticipant(u, e.target.checked)}
                            className="w-4 h-4 accent-indigo-600"
                          />
                          {u.name}
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="space-y-2">
                  {form.manualShares.map((s) => (
                    <div key={s.userId} className="flex items-center gap-2 min-w-0">
                      <span className="text-sm flex-1 min-w-0 truncate text-gray-700 dark:text-gray-300">
                        {s.name}
                        {s.userId === currentUser?.id && (
                          <span className="ml-1 text-xs text-indigo-500">(vos)</span>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={s.percentage}
                          onChange={(e) => updateManualPct(s.userId, Number(e.target.value))}
                          className="w-16 sm:w-20 px-2.5 py-1.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100 text-right"
                        />
                        <span className="text-sm text-gray-500">%</span>
                      </div>
                      {form.amount && (
                        <span className="text-sm text-gray-400 shrink-0 hidden sm:inline">
                          = ${formatCurrency((Number(form.amount) * Number(s.percentage)) / 100)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50">
            {editId ? "Actualizar" : "Agregar"}
          </button>
          {editId && (
            <button type="button" onClick={() => { setEditId(null); setForm(emptyForm); }} className="px-6 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg font-medium">
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Recurrentes Registrados</h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Category filter */}
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
              className="px-3 py-1.5 text-sm border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="">Todas las categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {/* Active/inactive segmented toggle */}
            <div className="flex rounded-lg border dark:border-gray-600 overflow-hidden text-sm">
              {(["all", "active", "inactive"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setFilterActive(opt)}
                  className={`px-3 py-1.5 transition-colors ${
                    filterActive === opt
                      ? "bg-indigo-600 text-white"
                      : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                  }`}
                >
                  {opt === "all" ? "Todos" : opt === "active" ? "Activos" : "Pausados"}
                </button>
              ))}
            </div>
          </div>
        </div>
        {recurring.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No hay gastos recurrentes con los filtros aplicados.</p>
        ) : (
          <div>
            {(["MONTHLY", "YEARLY", "WEEKLY", "DAILY"] as const)
              .filter((freq) => recurring.some((r) => r.frequency === freq))
              .map((freq) => {
                const items = recurring.filter((r) => r.frequency === freq);
                return (
                  <div key={freq}>
                    <div className="px-4 pt-4 pb-1">
                      <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                        {FREQ_LABELS[freq]}
                      </span>
                    </div>
                    <div className="divide-y dark:divide-gray-700">
                      {items.map((rec) => (
                        <div key={rec.id} className={`p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 ${!rec.active ? "opacity-50" : ""}`}>
                          <div className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: rec.category.color }} />
                            <div>
                              <p className="font-medium">{rec.description}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                {rec.category.name}
                                {rec.creditCard && <> · {rec.creditCard.name}</>}
                                {" · "}Prox: {new Date(rec.nextDue).toLocaleDateString("es")}
                                {rec.isShared && (
                                  <>
                                    {" · "}Compartido con {rec.shares.filter((s) => s.userId !== currentUser?.id).map((s) => s.user.name).join(", ") || "nadie"}
                                    {rec.payerId && rec.payerId !== currentUser?.id && rec.payer && (
                                      <> · Paga: {rec.payer.name}</>
                                    )}
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-semibold">${formatCurrency(rec.amount)}</span>
                            <button
                              onClick={() => toggleActive(rec)}
                              className={`text-sm hover:underline ${rec.active ? "text-amber-500 dark:text-amber-400" : "text-green-500 dark:text-green-400"}`}
                            >
                              {rec.active ? "Pausar" : "Activar"}
                            </button>
                            <button onClick={() => handleEdit(rec)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Editar</button>
                            <button onClick={() => handleDelete(rec.id)} className="text-sm text-red-500 dark:text-red-400 hover:underline">Eliminar</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
