// src/app/api/scales/[scaleId]/clear-day/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

type Body = {
  date?: string;               // YYYY-MM-DD
  clearUpper?: boolean;        // default false
  createdById?: string | null; // opcional p/ auditoria
};

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  const clearUpper = Boolean(body.clearUpper);

  const result = await prisma.$transaction(async (tx) => {
    // ✅ apaga SOMENTE BAIXO desta escala neste dia (inclui AUTO/MANUAL/SWAP)
    const deletedBaixo = await tx.dutyEvent.deleteMany({
      where: {
        scaleId,
        kind: "BAIXO",
        date: day,
      },
    });

    let deletedUpper = 0;

    if (clearUpper) {
      // por segurança: só apaga upper de militares que pertencem à escala
      const members = await tx.scaleMember.findMany({
        where: { scaleId, isActive: true },
        select: { militarId: true },
      });
      const ids = members.map((m) => m.militarId);

      const del = await tx.upperAssignment.deleteMany({
        where: {
          date: day,
          militarId: { in: ids },
        },
      });
      deletedUpper = del.count;
    }

    await tx.auditLog.create({
      data: {
        action: "SCALE_CLEAR_DAY",
        entity: "Scale",
        entityId: scaleId,
        userId: body.createdById ?? null,
        metaJson: JSON.stringify({
          scaleId,
          date: isoDay(day),
          deletedBaixo: deletedBaixo.count,
          clearUpper,
          deletedUpper,
        }),
      },
    });

    return { deletedBaixo: deletedBaixo.count, deletedUpper };
  });

  return json(200, { ok: true, date: isoDay(day), ...result });
}
