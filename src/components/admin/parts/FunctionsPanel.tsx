// src/components/admin/parts/FunctionsPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import FunctionRequirementModal from "@/components/admin/parts/FunctionRequirementModal";

type Fn = { id: string; nome: string; isActive: boolean };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  const j = await r.json().catch(() => ({} as any));

  if (!r.ok) {
    const msg =
      (j && typeof j.error === "string" && j.error) ||
      (j && typeof j.message === "string" && j.message) ||
      `HTTP ${r.status}`;
    throw new Error(msg);
  }

  return j as T;
}

function normalizeName(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

export default function FunctionsPanel(props: { scaleId: string; createdById?: string }) {
  const { scaleId, createdById } = props;

  const [items, setItems] = useState<Fn[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // create
  const [nome, setNome] = useState("");

  // modal requirements
  const [modalOpen, setModalOpen] = useState(false);
  function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const [modalDate, setModalDate] = useState<string>(() => todayLocalISO());

  // edit inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState<string>("");

  const canCreate = useMemo(() => normalizeName(nome).length >= 2, [nome]);
  const canSaveEdit = useMemo(() => normalizeName(editNome).length >= 2, [editNome]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await json<Fn[]>(`/api/scales/${scaleId}/functions`);
      setItems(data);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar funções.");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!canCreate) return;
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/scales/${scaleId}/functions`, {
        method: "POST",
        body: JSON.stringify({ nome: normalizeName(nome), createdById: createdById ?? null }),
      });
      setNome("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar função.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(fn: Fn) {
    setEditingId(fn.id);
    setEditNome(fn.nome);
    setErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditNome("");
  }

  async function saveEdit(fn: Fn) {
    if (!canSaveEdit) return;
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/scales/${scaleId}/functions/${fn.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nome: normalizeName(editNome),
          createdById: createdById ?? null,
        }),
      });
      cancelEdit();
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao editar função.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(fn: Fn) {
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/scales/${scaleId}/functions/${fn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !fn.isActive, createdById: createdById ?? null }),
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao atualizar função.");
    } finally {
      setLoading(false);
    }
  }

  async function softDelete(fn: Fn) {
    const ok = window.confirm(
      `Desativar "${fn.nome}"?\n\nIsso só marca a função como inativa (não apaga histórico).`
    );
    if (!ok) return;

    setLoading(true);
    setErr(null);
    try {
      await json(
        `/api/scales/${scaleId}/functions/${fn.id}?createdById=${encodeURIComponent(createdById ?? "")}`,
        { method: "DELETE" }
      );
      if (editingId === fn.id) cancelEdit();
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao desativar função.");
    } finally {
      setLoading(false);
    }
  }

  async function hardDeletePurge(fn: Fn) {
    const ok = window.confirm(
      `APAGAR DEFINITIVAMENTE "${fn.nome}"?\n\n` +
        `Isso vai remover a função e apagar:\n` +
        `• escalas (DutyEvent) ligadas a ela\n` +
        `• requisitos (vagas por dia)\n` +
        `• opt-outs\n\n` +
        `Essa ação NÃO pode ser desfeita.`
    );
    if (!ok) return;

    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      qs.set("hardDelete", "1");
      if (createdById) qs.set("createdById", createdById);

      await json(`/api/scales/${scaleId}/functions/${fn.id}?${qs.toString()}`, {
        method: "DELETE",
      });

      if (editingId === fn.id) cancelEdit();
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao apagar função.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId]);

  const total = items.length;
  const activeCount = useMemo(() => items.filter((x) => x.isActive).length, [items]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Funções da escala</div>
          
        </div>

        <div className="flex flex-wrap items-center gap-2">
        
          <button className="btn text-sm" onClick={() => setModalOpen(true)} disabled={loading}>
            Qtd Função
          </button>
        </div>
      </div>

      {/* Error */}
      {err ? (
        <div className="mb-3 rounded-lg border border-border bg-muted p-3">
          <div className="text-xs font-semibold text-foreground">Atenção</div>
          <div className="mt-1 text-xs text-muted">{err}</div>
        </div>
      ) : null}

      {/* Create */}
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          className="input text-sm"
          placeholder="Nome da função (ex: Guarda Quartel)"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          disabled={loading}
        />
        <button
          className="btn btn-primary text-sm font-medium disabled:opacity-50"
          onClick={create}
          disabled={loading || !canCreate}
          title={!canCreate ? "Nome mínimo: 2 caracteres" : "Criar função"}
        >
          Adicionar função
        </button>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-muted px-4 py-3">
          <div className="text-xs font-semibold text-muted">Lista</div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted">
                <th>Função</th>
                <th>Status</th>
                <th className="w-[420px]">Ações</th>
              </tr>
            </thead>

            <tbody className="[&>tr]:border-t [&>tr]:border-border">
              {items.map((f, idx) => {
                const isEditing = editingId === f.id;
                const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";

                return (
                  <tr key={f.id} className={`${zebra} hover:bg-muted/60 transition`}>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <>
                          <input
                            className="input text-sm"
                            value={editNome}
                            onChange={(e) => setEditNome(e.target.value)}
                            disabled={loading}
                            autoFocus
                          />
                          <div className="mt-1 text-[11px] text-muted">
                            Nome mínimo: 2 caracteres • Não pode duplicar na mesma escala.
                          </div>
                        </>
                      ) : (
                        <div className="font-medium text-foreground">{f.nome}</div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] ${
                          f.isActive ? "bg-card text-foreground" : "bg-muted text-muted"
                        }`}
                      >
                        {f.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                          <>
                            <button
                              className="btn btn-primary text-xs font-medium disabled:opacity-50"
                              onClick={() => saveEdit(f)}
                              disabled={loading || !canSaveEdit}
                            >
                              Salvar
                            </button>
                            <button className="btn text-xs" onClick={cancelEdit} disabled={loading}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn text-xs" onClick={() => startEdit(f)} disabled={loading}>
                              Editar
                            </button>

                            <button className="btn text-xs" onClick={() => toggleActive(f)} disabled={loading}>
                              {f.isActive ? "Desativar" : "Ativar"}
                            </button>

                            <button
                              className="btn text-xs"
                              onClick={() => softDelete(f)}
                              disabled={loading}
                              title="Soft delete (marca inativa)"
                            >
                              Remover (inativar)
                            </button>

                            <button
                              className="btn text-xs"
                              onClick={() => hardDeletePurge(f)}
                              disabled={loading}
                              title="Apaga de vez (purge)"
                            >
                              <span className="text-red-600">Apagar definitivo</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!items.length ? (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-muted" colSpan={3}>
                    {loading ? "Carregando..." : "Nenhuma função cadastrada."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <FunctionRequirementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        scaleId={scaleId}
        functions={items}
        date={modalDate}
        createdById={createdById}
        onChanged={load}
      />
    </div>
  );
}
