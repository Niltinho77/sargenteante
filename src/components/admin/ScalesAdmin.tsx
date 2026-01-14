// src/components/admin/ScalesAdmin.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Scale = {
  id: string;
  nome: string;
  descricao: string | null;
  isActive: boolean;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `HTTP ${r.status}`);
  return j as T;
}

export default function ScalesAdmin() {
  const [items, setItems] = useState<Scale[]>([]);
  const [loading, setLoading] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canCreate = useMemo(() => nome.trim().length >= 3, [nome]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await json<Scale[]>("/api/scales");
      setItems(data);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar escalas.");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!canCreate) return;
    setLoading(true);
    setErr(null);
    try {
      await json<Scale>("/api/scales", {
        method: "POST",
        body: JSON.stringify({ nome: nome.trim(), descricao: descricao.trim() || null }),
      });
      setNome("");
      setDescricao("");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar escala.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    setLoading(true);
    setErr(null);
    try {
      await json<Scale>(`/api/scales/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive }),
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao atualizar escala.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const total = items.length;
  const activeCount = useMemo(() => items.filter((x) => x.isActive).length, [items]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <div className="text-lg font-semibold text-foreground">Escalas</div>
          <div className="mt-0.5 text-xs text-muted">
            Criar e gerenciar escalas de baixo.{" "}
            <span className="font-semibold text-foreground">{activeCount}</span>
            <span className="text-muted"> / {total}</span> ativas.
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className="btn text-sm" href="/militars">
            Militares
          </Link>
          <button className="btn text-sm" onClick={load} disabled={loading}>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {/* Create */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">Criar escala</div>
          
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <input
            className="input text-sm"
            placeholder="Nome (ex: Mot Dia)"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            disabled={loading}
          />
          <input
            className="input text-sm"
            placeholder="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            disabled={loading}
          />
          <button
            className="btn btn-primary text-sm font-medium disabled:opacity-50"
            onClick={create}
            disabled={loading || !canCreate}
          >
            Criar
          </button>
        </div>

        {err ? (
          <div className="mt-3 rounded-lg border border-border bg-muted p-3">
            <div className="text-xs font-semibold text-foreground">Não foi possível concluir</div>
            <div className="mt-1 text-xs text-muted">{err}</div>
          </div>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Lista de escalas</div>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted">
                <th>Nome</th>
                <th>Descrição</th>
                <th className="w-[340px]">Ações</th>
              </tr>
            </thead>

            <tbody className="[&>tr]:border-t [&>tr]:border-border">
              {items.map((s, idx) => {
                const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";
                return (
                  <tr key={s.id} className={`${zebra} hover:bg-muted/60 transition`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground">{s.nome}</div>
                        <span
                          className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] ${
                            s.isActive ? "bg-card text-foreground" : "bg-muted text-muted"
                          }`}
                          title={s.isActive ? "Escala ativa" : "Escala inativa"}
                        >
                          {s.isActive ? "Ativa" : "Inativa"}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="text-sm text-foreground">{s.descricao ?? "-"}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <Link className="btn text-xs" href={`/scales/${s.id}`}>
                          Ver planilha
                        </Link>

                        <Link className="btn text-xs" href={`/scales/${s.id}/settings`}>
                          Configurar
                        </Link>

                        <button
                          className="btn text-xs"
                          onClick={() => toggleActive(s.id, s.isActive)}
                          disabled={loading}
                        >
                          {s.isActive ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!items.length ? (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-muted" colSpan={3}>
                    {loading ? "Carregando..." : "Nenhuma escala cadastrada."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
