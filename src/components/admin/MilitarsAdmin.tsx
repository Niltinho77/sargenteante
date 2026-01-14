// src/components/admin/MilitarsAdmin.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Militar = {
  id: string;
  nome: string;
  postoGrad: string | null;
  antiguidade: number;
  ativo: boolean;

  // ✅ saldos iniciais
  folgaInicialPreta: number;
  folgaInicialVermelha: number;
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

const POSTOS_GRADUACOES = [
  "Cel",
  "TC",
  "Maj",
  "Cap",
  "1º Ten",
  "2º Ten",
  "Asp",
  "ST",
  "1º Sgt",
  "2º Sgt",
  "3º Sgt",
  "Cb",
  "Sd EP",
  "Sd EV",
  "Aluno",
] as const;

type TabKey = "TODOS" | "OFICIAIS" | "ST_SGT" | "CB_SD" | "ALUNOS" | "INATIVOS";

function categoryOf(postoGrad: string | null): Exclude<TabKey, "TODOS" | "INATIVOS"> | null {
  const v = (postoGrad ?? "").trim();

  if (v === "Cel" || v === "TC" || v === "Maj" || v === "Cap" || v === "1º Ten" || v === "2º Ten" || v === "Asp")
    return "OFICIAIS";

  if (v === "ST" || v.includes("Sgt")) return "ST_SGT";
  if (v === "Cb" || v.startsWith("Sd")) return "CB_SD";
  if (v === "Aluno") return "ALUNOS";

  return null;
}

function asNonNegInt(v: string) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export default function MilitarsAdmin() {
  const [items, setItems] = useState<Militar[]>([]);
  const [loading, setLoading] = useState(false);

  // create form
  const [nome, setNome] = useState("");
  const [postoGrad, setPostoGrad] = useState<string>("");
  const [antiguidade, setAntiguidade] = useState<string>("");

  // saldos iniciais no create
  const [folgaPreta, setFolgaPreta] = useState<string>("0");
  const [folgaVermelha, setFolgaVermelha] = useState<string>("0");

  // UI
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("TODOS");

  // edit modal
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<Militar | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editPostoGrad, setEditPostoGrad] = useState<string>("");
  const [editAntiguidade, setEditAntiguidade] = useState<string>("");

  // editar folgas iniciais
  const [editFolgaPreta, setEditFolgaPreta] = useState<string>("0");
  const [editFolgaVermelha, setEditFolgaVermelha] = useState<string>("0");

  const canCreate = useMemo(() => {
    const a = asNonNegInt(antiguidade);
    const fp = asNonNegInt(folgaPreta);
    const fv = asNonNegInt(folgaVermelha);
    return nome.trim().length >= 3 && a !== null && fp !== null && fv !== null;
  }, [nome, antiguidade, folgaPreta, folgaVermelha]);

  const canSaveEdit = useMemo(() => {
    if (!editItem) return false;
    const a = asNonNegInt(editAntiguidade);
    const fp = asNonNegInt(editFolgaPreta);
    const fv = asNonNegInt(editFolgaVermelha);
    return editNome.trim().length >= 3 && a !== null && fp !== null && fv !== null;
  }, [editItem, editNome, editAntiguidade, editFolgaPreta, editFolgaVermelha]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await json<Militar[]>("/api/militars?all=1");
      const normalized = (data ?? []).map((m: any) => ({
        ...m,
        folgaInicialPreta: Number.isInteger(m.folgaInicialPreta) ? m.folgaInicialPreta : 0,
        folgaInicialVermelha: Number.isInteger(m.folgaInicialVermelha) ? m.folgaInicialVermelha : 0,
      })) as Militar[];
      setItems(normalized);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar militares.");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!canCreate) return;
    setLoading(true);
    setErr(null);

    const a = asNonNegInt(antiguidade)!;
    const fp = asNonNegInt(folgaPreta)!;
    const fv = asNonNegInt(folgaVermelha)!;

    try {
      await json<Militar>("/api/militars", {
        method: "POST",
        body: JSON.stringify({
          nome: nome.trim(),
          postoGrad: postoGrad.trim() || null,
          antiguidade: a,
          folgaInicialPreta: fp,
          folgaInicialVermelha: fv,
        }),
      });

      setNome("");
      setPostoGrad("");
      setAntiguidade("");
      setFolgaPreta("0");
      setFolgaVermelha("0");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar militar.");
    } finally {
      setLoading(false);
    }
  }

  function openEdit(m: Militar) {
    setEditItem(m);
    setEditNome(m.nome);
    setEditPostoGrad(m.postoGrad ?? "");
    setEditAntiguidade(String(m.antiguidade));
    setEditFolgaPreta(String(m.folgaInicialPreta ?? 0));
    setEditFolgaVermelha(String(m.folgaInicialVermelha ?? 0));
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editItem || !canSaveEdit) return;
    setLoading(true);
    setErr(null);

    const a = asNonNegInt(editAntiguidade)!;
    const fp = asNonNegInt(editFolgaPreta)!;
    const fv = asNonNegInt(editFolgaVermelha)!;

    try {
      await json<Militar>(`/api/militars/${editItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          nome: editNome.trim(),
          postoGrad: editPostoGrad.trim() || null,
          antiguidade: a,
          folgaInicialPreta: fp,
          folgaInicialVermelha: fv,
        }),
      });

      setEditOpen(false);
      setEditItem(null);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao editar militar.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAtivo(id: string, ativo: boolean) {
    setLoading(true);
    setErr(null);
    try {
      await json<Militar>(`/api/militars/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ ativo: !ativo }),
      });
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao atualizar militar.");
    } finally {
      setLoading(false);
    }
  }

  async function removeMilitar(m: Militar) {
    const ok = window.confirm(`Excluir "${m.nome}"?\n\nIsso remove o militar do cadastro.`);
    if (!ok) return;

    setLoading(true);
    setErr(null);

    try {
      await json<{ ok: true }>(`/api/militars/${m.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      const msg = e?.message ?? "Erro ao excluir militar.";

      if (String(msg).includes("vínculos")) {
        const forceOk = window.confirm(
          `Não foi possível excluir porque ele possui vínculos.\n\n` +
            `Deseja EXCLUIR PERMANENTEMENTE apagando histórico de serviços, vínculos e restrições?\n\n` +
            `⚠️ Isso é irreversível.`
        );

        if (!forceOk) {
          setErr(msg);
          return;
        }

        try {
          await json<{ ok: true }>(`/api/militars/${m.id}?force=1`, { method: "DELETE" });
          await load();
        } catch (e2: any) {
          setErr(e2?.message ?? "Erro ao excluir permanentemente.");
        }

        return;
      }

      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tabs = useMemo(
    () =>
      [
        { key: "TODOS", label: "Todos" },
        { key: "OFICIAIS", label: "Oficiais" },
        { key: "ST_SGT", label: "ST/Sgt" },
        { key: "CB_SD", label: "Cb/Sd" },
        { key: "ALUNOS", label: "Alunos" },
        { key: "INATIVOS", label: "Inativos" },
      ] as { key: TabKey; label: string }[],
    []
  );

  const filtered = useMemo(() => {
    let list = [...items];
    list.sort((a, b) => b.antiguidade - a.antiguidade || a.nome.localeCompare(b.nome));

    if (tab === "TODOS") return list;
    if (tab === "INATIVOS") return list.filter((x) => !x.ativo);
    return list.filter((x) => x.ativo && categoryOf(x.postoGrad) === tab);
  }, [items, tab]);

  const totalLabel = useMemo(() => {
    const total = filtered.length;
    const all = items.length;
    if (tab === "TODOS") return `${total} / ${all}`;
    return `${total}`;
  }, [filtered.length, items.length, tab]);

  return (
    <div className="space-y-4">
      {/* Header */}
      

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                active ? "bg-muted text-foreground border-border" : "bg-card text-muted border-border hover:bg-muted"
              }`}
              disabled={loading}
            >
              {t.label}
            </button>
          );
        })}

        <div className="ml-auto text-xs text-muted">
          Exibindo: <span className="font-semibold text-foreground">{totalLabel}</span>
        </div>
      </div>

      {/* Add card */}
      <div className="rounded-xl border border-border bg-card p-4">
  <div className="mb-4">
    <div className="text-sm font-semibold text-foreground">Adicionar militar</div>
  </div>

  <div className="grid gap-4 md:grid-cols-6">
    {/* Nome */}
    <div className="md:col-span-2">
      <input
        className="input text-sm"
        placeholder="Nome"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        disabled={loading}
      />
    </div>

    {/* Posto / Graduação */}
    <div className="md:col-span-2">
      <select
        className="input text-sm"
        value={postoGrad}
        onChange={(e) => setPostoGrad(e.target.value)}
        disabled={loading}
      >
        <option value="">(sem posto/grad)</option>
        {POSTOS_GRADUACOES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>

    {/* Antiguidade */}
    <div className="md:col-span-2">
      <input
        className="input text-sm"
        placeholder="Antiguidade"
        type="number"
        min={0}
        value={antiguidade}
        onChange={(e) => setAntiguidade(e.target.value)}
        disabled={loading}
      />
    </div>

    {/* Folga Preta */}
    <div className="md:col-span-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        Folga Preta
      </div>
      <input
        className="input text-sm"
        type="number"
        min={0}
        value={folgaPreta}
        onChange={(e) => setFolgaPreta(e.target.value)}
        disabled={loading}
      />
    </div>

    {/* Folga Vermelha */}
    <div className="md:col-span-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
        Folga Vermelha
      </div>
      <input
        className="input text-sm"
        type="number"
        min={0}
        value={folgaVermelha}
        onChange={(e) => setFolgaVermelha(e.target.value)}
        disabled={loading}
      />
    </div>

    {/* Botão */}
    <div className="md:col-span-2 flex items-end">
      <button
        className="btn btn-primary w-full text-sm font-medium disabled:opacity-50"
        onClick={create}
        disabled={loading || !canCreate}
      >
        Adicionar
      </button>
    </div>
  </div>

  {err && (
    <div className="mt-4 rounded-lg border border-border bg-muted p-3">
      <div className="text-xs font-semibold text-foreground">
        Não foi possível concluir
      </div>
      <div className="mt-1 text-xs text-muted">{err}</div>
    </div>
  )}
</div>



      {/* Table card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Lista de militares</div>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted">
                <th>Nome</th>
                <th>Posto/Grad</th>
                <th>Antiguidade</th>
                <th>Folga inicial</th>
                <th className="w-[280px]">Ações</th>
              </tr>
            </thead>

            <tbody className="[&>tr]:border-t [&>tr]:border-border">
              {filtered.map((m, idx) => {
                const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";
                return (
                  <tr key={m.id} className={`${zebra} hover:bg-muted/60 transition`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground">{m.nome}</div>
                        <span
                          className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] ${
                            m.ativo ? "bg-card text-foreground" : "bg-muted text-muted"
                          }`}
                        >
                          {m.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-foreground">{m.postoGrad ?? "-"}</td>

                    <td className="px-4 py-3 text-foreground">{m.antiguidade}</td>

                    <td className="px-4 py-3">
                      <div className="text-xs text-foreground">
                        <span className="font-semibold">Preta:</span> {m.folgaInicialPreta ?? 0}{" "}
                        <span className="mx-2 text-muted">•</span>
                        <span className="font-semibold">Vermelha:</span> {m.folgaInicialVermelha ?? 0}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button className="btn text-xs" onClick={() => openEdit(m)} disabled={loading}>
                          Editar
                        </button>

                        <button className="btn text-xs" onClick={() => toggleAtivo(m.id, m.ativo)} disabled={loading}>
                          {m.ativo ? "Desativar" : "Ativar"}
                        </button>

                        <button className="btn text-xs" onClick={() => removeMilitar(m)} disabled={loading}>
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td className="px-4 py-10 text-center text-sm text-muted" colSpan={5}>
                    {loading ? "Carregando..." : "Nenhum militar neste filtro."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal editar */}
      {editOpen && editItem && (
        <div className="fixed inset-0 z-50 modal-overlay p-4">
          <div className="mx-auto w-full max-w-xl rounded-xl bg-card p-4 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-foreground">Editar militar</div>
  
              </div>

              <button onClick={() => setEditOpen(false)} className="btn text-sm" disabled={loading}>
                Fechar
              </button>
            </div>

            <div className="mt-4 grid gap-2">
              <input
                className="input text-sm"
                placeholder="Nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                disabled={loading}
              />

              <select
                className="input text-sm"
                value={editPostoGrad}
                onChange={(e) => setEditPostoGrad(e.target.value)}
                disabled={loading}
              >
                <option value="">(sem posto/grad)</option>
                {POSTOS_GRADUACOES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>

              <div className="grid gap-2 md:grid-cols-3">
                <input
                  className="input text-sm"
                  placeholder="Antiguidade"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  value={editAntiguidade}
                  onChange={(e) => setEditAntiguidade(e.target.value)}
                  disabled={loading}
                />

                <input
                  className="input text-sm"
                  placeholder="Folga Inicial Preta"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  value={editFolgaPreta}
                  onChange={(e) => setEditFolgaPreta(e.target.value)}
                  disabled={loading}
                />

                <input
                  className="input text-sm"
                  placeholder="Folga Inicial Vermelha"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={0}
                  value={editFolgaVermelha}
                  onChange={(e) => setEditFolgaVermelha(e.target.value)}
                  disabled={loading}
                />
              </div>

              {err ? (
                <div className="mt-1 rounded-lg border border-border bg-muted p-3">
                  <div className="text-xs font-semibold text-foreground">Erro</div>
                  <div className="mt-1 text-xs text-muted">{err}</div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditOpen(false)} className="btn text-sm" disabled={loading}>
                Cancelar
              </button>

              <button
                onClick={saveEdit}
                className="btn btn-primary text-sm font-medium disabled:opacity-50"
                disabled={loading || !canSaveEdit}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
