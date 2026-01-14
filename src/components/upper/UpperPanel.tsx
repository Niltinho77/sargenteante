// src/components/upper/UpperPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type UpperFunction = { id: string; nome: string; isActive: boolean };
type MilitarLite = { id: string; nome: string; postoGrad: string | null };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `HTTP ${r.status}`);
  return j as T;
}

function weekdayPtShort(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

export default function UpperPanel({
  date,
  militars,
  onChanged,
}: {
  date: string; // YYYY-MM-DD
  militars: MilitarLite[];
  onChanged: () => void;
}) {
  const [funcs, setFuncs] = useState<UpperFunction[]>([]);
  const [assigns, setAssigns] = useState<
    Array<{
      id: string;
      upperFunctionId: string;
      militarId: string;
      upperFunction: { id: string; nome: string };
      militar: { id: string; nome: string; postoGrad: string | null };
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [newFuncName, setNewFuncName] = useState("");
  const [selectedFuncId, setSelectedFuncId] = useState<string>("");
  const [selectedMilitarId, setSelectedMilitarId] = useState<string>("");

  const militarMap = useMemo(() => new Map(militars.map((m) => [m.id, m])), [militars]);
  const funcMap = useMemo(() => new Map(funcs.map((f) => [f.id, f])), [funcs]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const [f, a] = await Promise.all([
        json<UpperFunction[]>("/api/upper/functions"),
        json<{ date: string; assignments: any[] }>(`/api/upper/assignments?date=${encodeURIComponent(date)}`),
      ]);
      setFuncs(f);
      setAssigns(a.assignments);
      if (!selectedFuncId && f.length) setSelectedFuncId(f[0].id);
      if (!selectedMilitarId && militars.length) setSelectedMilitarId(militars[0].id);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar escala de cima.");
    } finally {
      setLoading(false);
    }
  }

  async function createFunc() {
    const nome = newFuncName.trim();
    if (!nome) return;
    setLoading(true);
    setErr(null);
    try {
      await json("/api/upper/functions", { method: "POST", body: JSON.stringify({ nome }) });
      setNewFuncName("");
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar função.");
    } finally {
      setLoading(false);
    }
  }

  async function disableFunc(id: string) {
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/upper/functions/${id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao desativar função.");
    } finally {
      setLoading(false);
    }
  }

  async function setAssignment() {
    if (!selectedFuncId || !selectedMilitarId) return;
    setLoading(true);
    setErr(null);
    try {
      await json("/api/upper/assignments", {
        method: "POST",
        body: JSON.stringify({ date, upperFunctionId: selectedFuncId, militarId: selectedMilitarId, recalc: true }),
      });
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao atribuir militar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const dayLabel = `${weekdayPtShort(date)} • ${date}`;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-foreground">Escala de cima</div>
         
          
        </div>

        <button
          className="rounded-md border border-border px-3 py-2 text-sm bg-card hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50"
          onClick={load}
          disabled={loading}
          title="Recarregar funções e atribuições do dia"
        >
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {/* Form */}
      <div className="rounded-xl border border-border p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Atribuir militar</div>

        <div className="grid gap-2 md:grid-cols-6">
          <div className="md:col-span-2">
            <div className="mb-1 text-[11px] text-muted">Função</div>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              value={selectedFuncId}
              onChange={(e) => setSelectedFuncId(e.target.value)}
              disabled={loading}
            >
              <option value="">Selecione…</option>
              {funcs.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <div className="mb-1 text-[11px] text-muted">Militar</div>
            <select
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              value={selectedMilitarId}
              onChange={(e) => setSelectedMilitarId(e.target.value)}
              disabled={loading}
            >
              <option value="">Selecione…</option>
              {militars.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} {m.postoGrad ? `— ${m.postoGrad}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1 flex items-end">
            <button
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium bg-zinc-950 text-foreground hover:bg-zinc-800 disabled:opacity-50 dark:bg-card dark:text-foreground dark:hover:bg-zinc-200"
              onClick={setAssignment}
              disabled={loading || !selectedFuncId || !selectedMilitarId}
              title="Salva a atribuição e recalcula bloqueios"
            >
              Atribuir
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-6">
          <div className="md:col-span-5">
            <div className="mb-1 text-[11px] text-muted">Criar nova função</div>
            <input
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
              placeholder="Ex: Oficial de Dia, Motorista Externo, Escala Superior..."
              value={newFuncName}
              onChange={(e) => setNewFuncName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-1 flex items-end">
            <button
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-50"
              onClick={createFunc}
              disabled={loading || !newFuncName.trim()}
              title="Cria a função externa (fica disponível para todos os dias)"
            >
              Criar
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-xl border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2">
          <div className="text-xs font-semibold text-muted">Atribuições do dia</div>
          <div className="text-[11px] text-muted">{assigns.length} registros</div>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {assigns.map((a, idx) => {
              const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";
              return (
                <tr key={a.id} className={`border-t border-border ${zebra}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.upperFunction.nome}</div>
                    <div className="text-[11px] text-muted">Função</div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{a.militar.nome}</div>
                    <div className="text-[11px] text-muted">{a.militar.postoGrad ?? "-"}</div>
                  </td>

                  <td className="px-4 py-3 text-right">
                    {/* ⚠️ mesma lógica: chama disableFunc(a.upperFunctionId) */}
                    <button
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      onClick={() => disableFunc(a.upperFunctionId)}
                      disabled={loading}
                      title="Desativa esta FUNÇÃO (para todos os dias). Mantive a mesma lógica do seu código."
                    >
                      Desativar função
                    </button>
                  </td>
                </tr>
              );
            })}

            {!assigns.length ? (
              <tr>
                <td className="px-4 py-8 text-center text-sm text-muted" colSpan={3}>
                  Nenhuma atribuição registrada para este dia.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      
    </div>
  );
}
