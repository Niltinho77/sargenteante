// src/app/api/scales/[scaleId]/swap/undo/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Body = { dutyId?: string };

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ scaleId: string }> }) {
  const { scaleId } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.dutyId) return json(400, { error: "dutyId is required" });

  const duty = await prisma.dutyEvent.findFirst({
    where: { id: body.dutyId, scaleId, kind: "BAIXO" },
  });
  if (!duty) return json(404, { error: "DutyEvent not found" });
  if (duty.origin !== "SWAP" || !duty.titularId) return json(409, { error: "Este serviço não é uma troca." });

  const updated = await prisma.dutyEvent.update({
    where: { id: duty.id },
    data: {
      origin: "AUTO", // simples e direto (se tu quiser preservar o original, dá pra guardar em meta)
      executorId: duty.titularId,
      titularId: null,
      note: "Troca desfeita",
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "DUTY_SWAP_UNDO",
      entity: "DutyEvent",
      entityId: updated.id,
      metaJson: JSON.stringify({ from: duty.executorId, backTo: duty.titularId }),
    },
  });

  return json(200, { ok: true });
}
