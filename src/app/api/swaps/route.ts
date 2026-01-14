// src/app/api/swaps/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { date, scaleId, titularId, executorId, note } = body as {
    date?: string;
    scaleId?: string;
    titularId?: string;
    executorId?: string;
    note?: string;
  };

  if (!date || !scaleId || !titularId || !executorId) {
    return NextResponse.json({ error: "date, scaleId, titularId, executorId are required" }, { status: 400 });
  }

  const day = normalizeDate(new Date(date));
  if (Number.isNaN(day.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const cal = await prisma.calendarDay.findUnique({ where: { date: day } });
  if (!cal) return NextResponse.json({ error: `CalendarDay not found for ${date}` }, { status: 400 });

  // valida: existe serviço BAIXO do dia? se existir, vamos substituir por swap (delete + create)
  const existing = await prisma.dutyEvent.findFirst({
    where: { date: day, scaleId, kind: "BAIXO" },
  });

  if (existing) {
    await prisma.dutyEvent.delete({ where: { id: existing.id } });
  }

  const created = await prisma.dutyEvent.create({
    data: {
      date: day,
      scaleId,
      kind: "BAIXO",
      origin: "SWAP",
      dayType: cal.dayType,
      titularId,
      executorId,
      note: note?.trim() ? note.trim() : "Troca registrada",
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "SWAP_CREATE",
      entity: "DutyEvent",
      entityId: created.id,
      metaJson: JSON.stringify({ date: day.toISOString().slice(0, 10), scaleId, titularId, executorId, note: created.note }),
    },
  });

  return NextResponse.json({ ok: true, id: created.id });
}
