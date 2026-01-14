// src/components/admin/parts/RestrictionsPanel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type MilitarLite = { id: string; nome: string; postoGrad: string | null };

type RestrictionRow = {
  id: string;
  scaleId: string | null;
  militarId: string;
  startDate: string | null;
  endDate: string | null;
  indefinite: boolean;
  reason: string | null;
  militar: MilitarLite;
  type: "AFASTAMENTO" | "FERIAS_PREJ";
  appliesTo: "AMBAS" | "PRETA" | "VERMELHA";
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

const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10);

function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "info" | "warn" | "danger";
  title?: string;
}) {
  const cls =
    tone === "info"
      ? "bg-muted text-foreground"
      : tone === "warn"
      ? "bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100"
      : tone === "danger"
      ? "bg-red-50 text-red-900 dark:bg-red-900/20 dark:text-red-100"
      : "bg-card text-foreground";

  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] ${cls}`}
    >
      {children}
    </span>
  );
}

function fmtRange(r: RestrictionRow) {
  if (r.indefinite) return "Indefinido";
  const a = r.startDate ?? "?";
  const b = r.endDate ?? "...";
  return `${a} → ${b}`;
}

function fmtApplies(r: RestrictionRow) {
  if (r.type === "FERIAS_PREJ") return "Preta + Vermelha";
  if (r.appliesTo === "PRETA") return "Somente Preta";
  if (r.appliesTo === "VERMELHA") return "Somente Vermelha";
  return "Preta + Vermelha";
}

function fmtType(t: RestrictionRow["type"]) {
  return t === "FERIAS_PREJ" ? "Férias/Dispensa" : "Afastamento";
}

export default function RestrictionsPanel({
  scaleId,
  militars,
  onChanged,
}: {
  scaleId: string;
  militars: MilitarLite[];
  onChanged: () => void;
}) {
  const [items, setItems] = useState<RestrictionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [militarId, setMilitarId] = useState<string>("");
  const [scope, setScope] = useState<"GLOBAL" | "SCALE">("SCALE");
  const [mode, setMode] = useState<"PERIODO" | "INDEFINIDO">("PERIODO");
  const [startDate, setStartDate] = useState<string>(() => yyyyMmDd(new Date()));
  const [endDate, setEndDate] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [appliesTo, setAppliesTo] = useState<"AMBAS" | "PRETA" | "VERMELHA">("AMBAS");
  const [type, setType] = useState<"AFASTAMENTO" | "FERIAS_PREJ">("AFASTAMENTO");

  const canCreate = useMemo(() => {
    if (!militarId) return false;
    if (mode === "INDEFINIDO") return true;
    if (!startDate) return false;
    return true; // endDate opcional
  }, [militarId, mode, startDate]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await json<RestrictionRow[]>(`/api/scales/${scaleId}/restrictions`);
      setItems(data);
      if (!militarId && militars.length) setMilitarId(militars[0].id);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar restrições.");
    } finally {
      setLoading(false);
    }
  }

  async function create() {
    if (!canCreate) return;
    setLoading(true);
    setErr(null);
    try {
      await json("/api/restrictions", {
        method: "POST",
        body: JSON.stringify({
          militarId,
          scaleId: scope === "GLOBAL" ? null : scaleId,
          startDate: mode === "PERIODO" ? startDate : null,
          endDate: mode === "PERIODO" ? (endDate.trim() || null) : null,
          indefinite: mode === "INDEFINIDO",
          reason: reason.trim() || null,
          type,
          appliesTo: type === "FERIAS_PREJ" ? "AMBAS" : appliesTo,
        }),
      });
      setReason("");
      setEndDate("");
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao criar restrição.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/restrictions/${id}`, { method: "DELETE" });
      await load();
      onChanged();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao remover restrição.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId]);

  const rows = useMemo(() => {
    const global = items.filter((i) => i.scaleId === null);
    const scoped = items.filter((i) => i.scaleId === scaleId);
    return { global, scoped };
  }, [items, scaleId]);

  const totals = useMemo(() => {
    const g = rows.global.length;
    const s = rows.scoped.length;
    return { g, s, all: g + s };
  }, [rows]);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Restrições (afastamentos)</div>
          
        </div>

        
      </div>

      {/* Error */}
      {err ? (
        <div className="mb-3 rounded-lg border border-border bg-muted p-3">
          <div className="text-xs font-semibold text-foreground">Atenção</div>
          <div className="mt-1 text-xs text-muted">{err}</div>
        </div>
      ) : null}

      {/* Create form */}
      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-foreground">Criar restrição</div>
            
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={scope === "GLOBAL" ? "warn" : "info"} title="Escopo">
              {scope === "GLOBAL" ? "Global" : "Desta escala"}
            </Badge>
            <Badge title="Modo">{mode === "INDEFINIDO" ? "Indefinido" : "Por período"}</Badge>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-12">
          <div className="md:col-span-4">
            <select
              className="input text-sm"
              value={militarId}
              onChange={(e) => setMilitarId(e.target.value)}
              disabled={loading}
            >
              <option value="">Militar…</option>
              {militars.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome} {m.postoGrad ? `— ${m.postoGrad}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              className="input text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              disabled={loading}
              title="Escopo"
            >
              <option value="SCALE">Só esta escala</option>
              <option value="GLOBAL">Global</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              className="input text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value as any)}
              disabled={loading}
              title="Modo"
            >
              <option value="PERIODO">Por período</option>
              <option value="INDEFINIDO">Indefinido</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              className="input text-sm"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value as any)}
              disabled={loading}
              title="Aplica em"
            >
              <option value="AMBAS">Preta + Vermelha</option>
              <option value="PRETA">Somente Preta</option>
              <option value="VERMELHA">Somente Vermelha</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              className="input text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              disabled={loading}
              title="Tipo"
            >
              <option value="AFASTAMENTO">Afastamento normal</option>
              <option value="FERIAS_PREJ">Férias/Dispensa (prejuízo)</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <input
              className="input text-sm"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={loading || mode !== "PERIODO"}
              title="Início"
            />
          </div>

          <div className="md:col-span-2">
            <input
              className="input text-sm"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={loading || mode !== "PERIODO"}
              title="Fim (opcional)"
            />
          </div>

          <div className="md:col-span-6">
            <input
              className="input text-sm"
              placeholder="Justificativa (opcional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="md:col-span-2">
            <button
              className="btn btn-primary w-full text-sm font-medium disabled:opacity-50"
              onClick={create}
              disabled={loading || !canCreate}
              title={!canCreate ? "Selecione um militar" : "Criar restrição"}
            >
              Criar
            </button>
          </div>
        </div>
      </div>

      {/* Lists */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {/* Global */}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
            <div className="text-xs font-semibold text-muted">Globais</div>
            <Badge tone="warn">{rows.global.length}</Badge>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <tbody className="[&>tr]:border-t [&>tr]:border-border">
                {rows.global.map((r, idx) => {
                  const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";
                  return (
                    <tr key={r.id} className={`${zebra} hover:bg-muted/60 transition`}>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{r.militar.nome}</div>
                          <Badge tone="warn" title="Escopo">
                            Global
                          </Badge>
                          <Badge title="Tipo">{fmtType(r.type)}</Badge>
                          <Badge title="Aplica em">{fmtApplies(r)}</Badge>
                        </div>

                        <div className="mt-1 text-[11px] text-muted">
                          {fmtRange(r)}
                          {r.reason ? ` • ${r.reason}` : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right align-top">
                        <button className="btn text-xs" onClick={() => remove(r.id)} disabled={loading}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!rows.global.length ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-muted" colSpan={2}>
                      Nenhuma restrição global.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* Scoped */}
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
            <div className="text-xs font-semibold text-muted">Desta escala</div>
            <Badge tone="info">{rows.scoped.length}</Badge>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <tbody className="[&>tr]:border-t [&>tr]:border-border">
                {rows.scoped.map((r, idx) => {
                  const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";
                  return (
                    <tr key={r.id} className={`${zebra} hover:bg-muted/60 transition`}>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{r.militar.nome}</div>
                          <Badge tone="info" title="Escopo">
                            Desta escala
                          </Badge>
                          <Badge title="Tipo">{fmtType(r.type)}</Badge>
                          <Badge title="Aplica em">{fmtApplies(r)}</Badge>
                        </div>

                        <div className="mt-1 text-[11px] text-muted">
                          {fmtRange(r)}
                          {r.reason ? ` • ${r.reason}` : ""}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-right align-top">
                        <button className="btn text-xs" onClick={() => remove(r.id)} disabled={loading}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {!rows.scoped.length ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-sm text-muted" colSpan={2}>
                      Nenhuma restrição nesta escala.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
