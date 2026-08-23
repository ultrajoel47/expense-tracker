"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { FRECUENCIAS_MATERIALIZABLES } from "@/lib/recurring-materialize";

/**
 * `FRECUENCIAS_MATERIALIZABLES` son las unicas frecuencias que
 * `materializeRecurringForMonth` convierte en gastos, y por lo tanto en plata
 * contada en algun total. El formulario ofrece SOLO estas: una plantilla
 * semanal o anual se guardaba, se listaba, aparecia en "proximos vencimientos"
 * y no entraba en ningun total, nunca — el mismo sub-conteo silencioso que
 * esta rebanada vino a cerrar.
 *
 * Las plantillas existentes con otra frecuencia (hoy no hay ninguna: las 10
 * reales son MONTHLY) se siguen mostrando en la lista, marcadas como que no
 * suman. Si algun dia el materializador aprende semanal o anual, agregar la
 * frecuencia aca alcanza para que vuelva al formulario.
 */

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

interface RecurringExpense {
  id: string;
  amount: number;
  description: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  dayOfMonth: number | null;
  nextDue: string;
  active: boolean;
  scope: "casa" | "personal";
  category: Category;
  creditCard: CreditCard | null;
}

const FREQ_LABELS: Record<string, string> = {
  DAILY: "Diario",
  WEEKLY: "Semanal",
  MONTHLY: "Mensual",
  YEARLY: "Anual",
};

const emptyForm = {
  amount: "",
  description: "",
  categoryId: "",
  creditCardId: "",
  frequency: "MONTHLY",
  dayOfMonth: "",
  nextDue: "",
};

const inputCls =
  "w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 transition";

const labelCls = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

export default function RecurringPage() {
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [creditCards, setCreditCards] = useState<CreditCard[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<"casa" | "personal">("casa");

  useEffect(() => {
    fetch("/api/categories").then((r) => r.json()).then(setCategories);
    fetch("/api/credit-cards").then((r) => r.json()).then(setCreditCards);
    loadRecurring();
  }, []);

  function loadRecurring() {
    fetch("/api/recurring-expenses")
      .then((r) => r.json())
      .then((res) => setRecurring(Array.isArray(res) ? res : []));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        amount: Number(form.amount),
        creditCardId: form.creditCardId || null,
        dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : null,
        nextDue: form.nextDue ? new Date(form.nextDue).toISOString() : null,
        scope,
      };

      if (editId !== null) {
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
      setScope("casa");
      loadRecurring();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este gasto recurrente?")) return;
    await fetch(`/api/recurring-expenses/${id}`, { method: "DELETE" });
    loadRecurring();
  }

  function handleEdit(rec: RecurringExpense) {
    setEditId(rec.id);
    setForm({
      amount: String(rec.amount),
      description: rec.description,
      categoryId: rec.category.id,
      creditCardId: rec.creditCard?.id ?? "",
      frequency: rec.frequency,
      dayOfMonth: rec.dayOfMonth !== null ? String(rec.dayOfMonth) : "",
      nextDue: rec.nextDue.split("T")[0],
    });
    setScope(rec.scope);
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Recurrentes</h1>

      {/* ── Form ── */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {editId !== null ? "Editar Recurrente" : "Nuevo Recurrente"}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {/* Row 1: Amount, Description, Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
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
                placeholder="Descripción"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputCls}
                required
              />
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

          {/* Row 2: Credit card, Frequency, Day of month */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
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
              <label className={labelCls}>Frecuencia</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
                className={inputCls}
                required
              >
                {FRECUENCIAS_MATERIALIZABLES.map((value) => (
                  <option key={value} value={value}>{FREQ_LABELS[value]}</option>
                ))}
                {/* Editar una plantilla vieja con otra frecuencia no se la
                    cambia en silencio: se ofrece su valor actual tambien. */}
                {!FRECUENCIAS_MATERIALIZABLES.includes(form.frequency as "MONTHLY") && (
                  <option value={form.frequency}>
                    {FREQ_LABELS[form.frequency] ?? form.frequency} (no suma a los totales)
                  </option>
                )}
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Por ahora solo las mensuales se suman a los totales.
              </p>
            </div>

            <div>
              <label className={labelCls}>Día del mes</label>
              <input
                type="number"
                min="1"
                max="31"
                placeholder="Opcional"
                value={form.dayOfMonth}
                onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          {/* Row 3: Next due */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
            <div>
              <label className={labelCls}>Próximo vencimiento</label>
              <input
                type="date"
                value={form.nextDue}
                onChange={(e) => setForm({ ...form, nextDue: e.target.value })}
                className={inputCls}
                required
              />
            </div>
          </div>

          {/* Submit row */}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={scope === "personal"}
                onChange={(e) => setScope(e.target.checked ? "personal" : "casa")}
              />
              Recurrente personal (no lo ve la otra persona)
            </label>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {loading ? "Guardando..." : editId !== null ? "Actualizar" : "Agregar recurrente"}
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

      {/* ── Recurring list ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Plantillas recurrentes</h2>
          {recurring.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {recurring.length} {recurring.length === 1 ? "plantilla" : "plantillas"}
            </span>
          )}
        </div>

        {recurring.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No hay gastos recurrentes cargados
          </p>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {recurring.map((rec) => (
              <div
                key={rec.id}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition"
              >
                {/* Category dot */}
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: rec.category.color }}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {rec.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{rec.category.name}</span>
                    {rec.creditCard && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">· {rec.creditCard.name}</span>
                    )}
                    {FRECUENCIAS_MATERIALIZABLES.includes(rec.frequency as "MONTHLY") ? (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium">
                        {FREQ_LABELS[rec.frequency] ?? rec.frequency}
                      </span>
                    ) : (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium"
                        title="Esta frecuencia todavia no se convierte en gastos: no se suma a ningun total"
                      >
                        {FREQ_LABELS[rec.frequency] ?? rec.frequency} · no suma a los totales
                      </span>
                    )}
                    {rec.dayOfMonth !== null && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">· día {rec.dayOfMonth}</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      · Próximo: {new Date(rec.nextDue).toLocaleDateString("es")}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {rec.scope === "casa" ? "Casa" : "Personal"}
                    </span>
                    {!rec.active && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-medium">
                        Inactivo
                      </span>
                    )}
                  </div>
                </div>

                {/* Amount + actions */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                    ${formatCurrency(rec.amount)}
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <button
                      onClick={() => handleEdit(rec)}
                      className="text-xs px-2 py-1 rounded-md font-medium border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 transition"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      className="text-xs px-2 py-1 rounded-md font-medium border border-red-100 dark:border-red-900 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
