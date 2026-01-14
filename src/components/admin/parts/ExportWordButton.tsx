"use client";

import { useMemo, useState } from "react";

type Scale = { id: string; nome: string };

export default function ExportWordButton(props: {
  dateISO: string; // YYYY-MM-DD
  scales: Scale[]; // lista de escalas disponíveis no grid
}) {
  const { dateISO, scales } = props;

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const allSelected = useMemo(
    () => selected.length === scales.length && scales.length > 0,
    [selected, scales.length]
  );

  function toggleAll() {
    if (allSelected) setSelected([]);
    else setSelected(scales.map((s) => s.id));
  }

  function toggleOne(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function download() {
    if (!selected.length) {
      setErr("Selecione pelo menos 1 escala.");
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const r = await fetch("/api/scales/export/word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: dateISO, scaleIds: selected }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }

      const blob = await r.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `escala_${dateISO}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao exportar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setOpen(true)}>
        Exportar (Word)
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border bg-background shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div>
                <div className="text-sm font-semibold">Exportar escala do dia</div>
                <div className="text-xs text-muted-foreground">{dateISO}</div>
              </div>

              <button
                className="rounded-md border px-3 py-1.5 text-xs"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Fechar
              </button>
            </div>

            <div className="space-y-3 p-4">
              {err ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {err}
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Quais escalas exportar?</div>
                <button className="rounded-md border px-3 py-1.5 text-xs" onClick={toggleAll} disabled={loading}>
                  {allSelected ? "Desmarcar todas" : "Marcar todas"}
                </button>
              </div>

              <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
                {scales.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(s.id)}
                      onChange={() => toggleOne(s.id)}
                      disabled={loading}
                    />
                    <span>{s.nome}</span>
                  </label>
                ))}
                {!scales.length ? (
                  <div className="text-xs text-muted-foreground">Nenhuma escala disponível.</div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t p-4">
              <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setOpen(false)} disabled={loading}>
                Cancelar
              </button>
              <button
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
                onClick={download}
                disabled={loading}
              >
                {loading ? "Gerando..." : "Baixar .docx"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
