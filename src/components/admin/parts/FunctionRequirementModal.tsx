// src/components/admin/parts/FunctionRequirementModal.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Fn = { id: string; nome: string; isActive: boolean };

type ReqRow = {
  id: string;
  scaleFunctionId: string;
  functionNome?: string;
  date: string; // YYYY-MM-DD
  qty: number;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `HTTP ${r.status}`);
  return j as T;
}

// soma 1 dia sem “bug de fuso” (usa T00:00:00 local)
function addOneDayISO(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function normalizeQty(raw: string) {
  const v = (raw ?? "").trim();
  const n = Math.floor(Number(v === "" ? "0" : v));
  if (!Number.isFinite(n) || n < 0) throw new Error("qty inválido (use número >= 0)");
  return n;
}

function looksLikeUniqueConflict(e: any) {
  const msg = String(e?.message || "");
  const code = String(e?.code || "");
  const status = Number(e?.status || 0);
  return (
    status === 409 ||
    code.includes("P2002") ||
    msg.includes("P2002") ||
    msg.toLowerCase().includes("unique") ||
    msg.toLowerCase().includes("constraint")
  );
}

function weekdayPtShort(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

export default function FunctionRequirementModal(props: {
  open: boolean;
  onClose: () => void;
  scaleId: string;
  functions: Fn[];
  date: string; // YYYY-MM-DD
  createdById?: string;
  onChanged?: () => void;
}) {
  const { open, onClose, scaleId, functions, date, createdById, onChanged } = props;

  const activeFns = useMemo(() => functions.filter((f) => f.isActive), [functions]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ scaleFunctionId: string; qty: string }>>([]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const bust = Date.now();

      // ✅ teu backend já trata [from,to] inclusivo, então to=date
      const data = await json<ReqRow[]>(
        `/api/scales/${scaleId}/functions/requirements?from=${date}&to=${date}&_=${bust}`
      );

      const byFn = new Map<string, number>();
      for (const r of data) {
        // ✅ garantia extra: só considera o DIA do modal
        if (r.date === date) byFn.set(r.scaleFunctionId, r.qty);
      }

      setRows(
        activeFns.map((f) => ({
          scaleFunctionId: f.id,
          qty: String(byFn.get(f.id) ?? 0),
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar requisitos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, date, scaleId, activeFns.length]);

  async function deleteRequirement(fnId: string) {
    const qs = new URLSearchParams();
    qs.set("date", date);
    if (createdById) qs.set("createdById", createdById);

    const r = await fetch(`/api/scales/${scaleId}/functions/${fnId}/requirements?${qs.toString()}`, {
      method: "DELETE",
    });

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error((j as any)?.error || `HTTP ${r.status}`);
    }
  }

  async function upsertRequirementViaPost(fnId: string, qty: number) {
    return json(`/api/scales/${scaleId}/functions/${fnId}/requirements`, {
      method: "POST",
      body: JSON.stringify({ date, qty, createdById: createdById ?? null }),
    });
  }

  async function save() {
    setLoading(true);
    setErr(null);

    try {
      for (const r of rows) {
        const fnId = r.scaleFunctionId;
        const q = normalizeQty(r.qty);

        if (q === 0) {
          await deleteRequirement(fnId);
          continue;
        }

        try {
          await upsertRequirementViaPost(fnId, q);
        } catch (e: any) {
          if (looksLikeUniqueConflict(e)) {
            await deleteRequirement(fnId);
            await upsertRequirementViaPost(fnId, q);
          } else {
            throw e;
          }
        }
      }

      await load();
      onChanged?.();
      onClose();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar requisitos.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const dayHint = `${weekdayPtShort(date)} • ${date}`;

  return (
    <div className="fixed inset-0 z-50 modal-overlay p-4">
      <div className="mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <div className="text-base font-semibold text-foreground">Vagas por função</div>
            <div className="mt-0.5 text-xs text-muted">
              {dayHint} <span className="opacity-60">•</span> Use <b>0</b> para remover a vaga do dia
            </div>
          </div>

          <button className="btn text-xs" onClick={onClose} disabled={loading}>
            Fechar
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          {err ? (
            <div className="mb-3 rounded-lg border border-border bg-muted p-3">
              <div className="text-xs font-semibold text-foreground">Atenção</div>
              <div className="mt-1 text-xs text-muted">{err}</div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border">
            {/* list header */}
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2">
              <div className="text-xs font-semibold text-muted">Funções ativas</div>
              <div className="text-[11px] text-muted">{activeFns.length} itens</div>
            </div>

            <div className="max-h-[56vh] overflow-auto">
              {activeFns.length ? (
                <div className="divide-y divide-border">
                  {activeFns.map((f, idx) => {
                    const row = rows.find((r) => r.scaleFunctionId === f.id);
                    const zebra = idx % 2 === 0 ? "bg-card" : "bg-muted/30";

                    return (
                      <div key={f.id} className={`flex items-center justify-between gap-3 px-4 py-3 ${zebra}`}>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{f.nome}</div>
                          <div className="mt-0.5 text-[11px] text-muted">
                            Quantidade de vagas para este dia
                          </div>
                        </div>

                        <input
                          className="input w-[110px] text-right text-sm tabular-nums"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={row?.qty ?? "0"}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^\d]/g, "");
                            setRows((prev) =>
                              prev.map((x) => (x.scaleFunctionId === f.id ? { ...x, qty: v } : x))
                            );
                          }}
                          disabled={loading}
                          aria-label={`Quantidade de vagas: ${f.nome}`}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted">
                  Nenhuma função ativa nesta escala.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
          <div className="text-[11px] text-muted">
            Dica: se estiver dando conflito 409, este modal já tenta corrigir automaticamente.
          </div>

          <div className="flex items-center gap-2">
            <button className="btn" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button className="btn btn-primary font-medium disabled:opacity-50" onClick={save} disabled={loading}>
              {loading ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
