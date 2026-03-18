"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";

interface CreditCard {
  id: string;
  name: string;
  lastFour: string | null;
  color: string;
}

interface PendingInstallment {
  installmentNumber: number;
  dueDate: string;
  amount: number;
  expense: { description: string; date: string };
}

const emptyForm = { name: "", lastFour: "", color: "#6366f1" };

export default function CreditCardsPage() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<{ totalPending: number; pending: PendingInstallment[] } | null>(null);

  useEffect(() => {
    loadCards();
  }, []);

  function loadCards() {
    fetch("/api/credit-cards").then((r) => r.json()).then(setCards);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (editId) {
        await fetch(`/api/credit-cards/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        setEditId(null);
      } else {
        await fetch("/api/credit-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
      }
      setForm(emptyForm);
      loadCards();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar esta tarjeta?")) return;
    await fetch(`/api/credit-cards/${id}`, { method: "DELETE" });
    loadCards();
    if (expanded === id) setExpanded(null);
  }

  async function toggleExpand(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setPending(null);
      return;
    }
    setExpanded(id);
    const res = await fetch(`/api/credit-cards/${id}/pending`);
    setPending(await res.json());
  }

  function handleEdit(card: CreditCard) {
    setEditId(card.id);
    setForm({ name: card.name, lastFour: card.lastFour ?? "", color: card.color });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Tarjetas de Credito</h1>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border dark:border-gray-700 space-y-4">
        <h2 className="font-semibold">{editId ? "Editar Tarjeta" : "Nueva Tarjeta"}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Nombre (ej: Visa Santander)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
            required
          />
          <input
            type="text"
            maxLength={4}
            placeholder="Ultimos 4 digitos (opcional)"
            value={form.lastFour}
            onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
            className="px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
          />
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-400">Color:</label>
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="w-10 h-10 rounded cursor-pointer border dark:border-gray-600"
            />
          </div>
        </div>
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

      <div className="space-y-3">
        {cards.length === 0 ? (
          <p className="text-gray-400 text-sm">No hay tarjetas registradas.</p>
        ) : (
          cards.map((card) => (
            <div key={card.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: card.color }} />
                  <div>
                    <p className="font-medium">{card.name}</p>
                    {card.lastFour && <p className="text-xs text-gray-400">**** {card.lastFour}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleExpand(card.id)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                    {expanded === card.id ? "Cerrar" : "Ver pendiente"}
                  </button>
                  <button onClick={() => handleEdit(card)} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Editar</button>
                  <button onClick={() => handleDelete(card.id)} className="text-sm text-red-500 dark:text-red-400 hover:underline">Eliminar</button>
                </div>
              </div>
              {expanded === card.id && pending && (
                <div className="border-t dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-700/30">
                  <p className="font-semibold text-lg mb-3">
                    Total pendiente: <span className="text-orange-500 dark:text-orange-400">${formatCurrency(pending.totalPending)}</span>
                  </p>
                  {pending.pending.length === 0 ? (
                    <p className="text-gray-400 text-sm">Sin cuotas pendientes.</p>
                  ) : (
                    <div className="space-y-2">
                      {pending.pending.map((inst, i) => (
                        <div key={i} className="flex items-center justify-between text-sm border dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700">
                          <div>
                            <p className="font-medium">{inst.expense.description}</p>
                            <p className="text-xs text-gray-400">Cuota {inst.installmentNumber} · Vence {new Date(inst.dueDate).toLocaleDateString("es")}</p>
                          </div>
                          <span className="font-semibold">${formatCurrency(inst.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
