"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  name: string;
  email: string;
}

interface GroupMember {
  id: string;
  userId: string;
  percentage: number;
  user: { id: string; name: string };
}

interface Group {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string };
  members: GroupMember[];
}

type FormMember = { userId: string; name: string; percentage: number };

const emptyForm = {
  name: "",
  members: [] as FormMember[],
};

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) {
          setCurrentUserId(d.user.id);
          setCurrentUserName(d.user.name);
        }
      });
    fetch("/api/auth/users")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setUsers(Array.isArray(d) ? d : []));
    loadGroups();
  }, []);

  function loadGroups() {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((d) => setGroups(Array.isArray(d) ? d : []));
  }

  const memberTotal = form.members.reduce((s, m) => s + (Number(m.percentage) || 0), 0);
  const memberTotalValid = Math.abs(memberTotal - 100) <= 1;

  function addMember(user: User) {
    if (form.members.some((m) => m.userId === user.id)) return;
    setForm({ ...form, members: [...form.members, { userId: user.id, name: user.name, percentage: 0 }] });
  }

  function removeMember(userId: string) {
    setForm({ ...form, members: form.members.filter((m) => m.userId !== userId) });
  }

  function updateMemberPct(userId: string, pct: number) {
    setForm({
      ...form,
      members: form.members.map((m) => (m.userId === userId ? { ...m, percentage: pct } : m)),
    });
  }

  function ensureOwnerInMembers() {
    if (!currentUserId || form.members.some((m) => m.userId === currentUserId)) return;
    setForm({
      ...form,
      members: [{ userId: currentUserId, name: currentUserName, percentage: 0 }, ...form.members],
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!memberTotalValid) return;

    setLoading(true);
    try {
      const payload = {
        name: form.name,
        members: form.members.map(({ userId, percentage }) => ({ userId, percentage: Number(percentage) })),
      };

      if (editId) {
        // Update name only
        await fetch(`/api/groups/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: form.name }),
        });
        // Update members
        await fetch(`/api/groups/${editId}/members`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ members: payload.members }),
        });
        setEditId(null);
      } else {
        await fetch("/api/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setForm(emptyForm);
      loadGroups();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eliminar este grupo? Los gastos asociados se desvincularan.")) return;
    await fetch(`/api/groups/${id}`, { method: "DELETE" });
    loadGroups();
  }

  function handleEdit(group: Group) {
    setEditId(group.id);
    setForm({
      name: group.name,
      members: group.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        percentage: m.percentage,
      })),
    });
  }

  const usersNotInForm = users.filter((u) => !form.members.some((m) => m.userId === u.id));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Grupos</h1>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border dark:border-gray-700 space-y-4"
      >
        <h2 className="font-semibold">{editId ? "Editar Grupo" : "Nuevo Grupo"}</h2>

        <input
          type="text"
          placeholder="Nombre del grupo (ej: Hogar)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
          required
        />

        {/* Member selector */}
        <div className="space-y-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Miembros</p>
            <span
              className={`text-sm font-medium ${memberTotalValid ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
            >
              Total: {memberTotal.toFixed(1)}%
            </span>
          </div>

          {/* Add members */}
          {usersNotInForm.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {usersNotInForm.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => addMember(u)}
                  className="px-3 py-1.5 text-sm border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 text-gray-700 dark:text-gray-300"
                >
                  + {u.name}
                </button>
              ))}
            </div>
          )}

          {!form.members.some((m) => m.userId === currentUserId) && currentUserId && (
            <button
              type="button"
              onClick={ensureOwnerInMembers}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              + Agregarme a mi
            </button>
          )}

          {/* Percentage inputs */}
          {form.members.length > 0 && (
            <div className="space-y-2 mt-2">
              {form.members.map((m) => (
                <div key={m.userId} className="flex items-center gap-3">
                  <span className="text-sm w-32 truncate text-gray-700 dark:text-gray-300">
                    {m.name}
                    {m.userId === currentUserId && (
                      <span className="ml-1 text-xs text-indigo-500">(vos)</span>
                    )}
                  </span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={m.percentage}
                    onChange={(e) => updateMemberPct(m.userId, Number(e.target.value))}
                    className="w-24 px-3 py-1.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                  />
                  <span className="text-sm text-gray-500">%</span>
                  <button
                    type="button"
                    onClick={() => removeMember(m.userId)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}

          {form.members.length === 0 && (
            <p className="text-sm text-gray-400">Agrega miembros al grupo usando los botones de arriba.</p>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !memberTotalValid || form.members.length === 0}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {editId ? "Actualizar" : "Crear Grupo"}
          </button>
          {editId && (
            <button
              type="button"
              onClick={() => { setEditId(null); setForm(emptyForm); }}
              className="px-6 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      {/* Groups list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700">
        <div className="p-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Mis Grupos</h2>
        </div>
        {groups.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No hay grupos creados.</p>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{group.name}</p>
                        {group.ownerId === currentUserId && (
                          <span className="text-xs px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded-full">
                            propietario
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {group.members.map((m) => (
                          <span
                            key={m.id}
                            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300"
                          >
                            {m.user.name}: {m.percentage.toFixed(1)}%
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => router.push(`/dashboard/groups/${group.id}`)}
                        className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Detalle
                      </button>
                      {group.ownerId === currentUserId && (
                        <>
                          <button
                            onClick={() => handleEdit(group)}
                            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(group.id)}
                            className="text-sm text-red-500 dark:text-red-400 hover:underline"
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
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
