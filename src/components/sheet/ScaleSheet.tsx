// src/components/sheet/ScaleSheet.tsx
"use client";

import Link from "next/link";

export default function ScaleSheet({ scaleId }: { scaleId: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Planilha da escala</div>
          <div className="text-xs text-muted-foreground">scaleId: {scaleId}</div>
        </div>

        <div className="flex gap-2">
          <Link className="rounded-md border px-3 py-2 text-sm" href={`/scales/${scaleId}/settings`}>
            Configurar
          </Link>
          <Link className="rounded-md border px-3 py-2 text-sm" href="/scales">
            Todas escalas
          </Link>
        </div>
      </div>

      <div className="rounded-lg border p-4 text-sm">
        Placeholder da planilha (próximo passo: grid calendário, folgas, serviço BAIXO/CIMA e troca).
      </div>
    </div>
  );
}
