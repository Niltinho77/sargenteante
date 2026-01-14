// src/app/api/calendar/[date]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;

  const day = normalizeDate(new Date(date));
  if (Number.isNaN(day.getTime())) {
    return NextResponse.json({ error: "Invalid date param" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({} as any));
  const { dayType, label } = body as {
    dayType?: "PRETA" | "VERMELHA";
    label?: string | null;
  };

  if (!dayType) {
    return NextResponse.json({ error: "dayType is required" }, { status: 400 });
  }

  const updated = await prisma.calendarDay.upsert({
    where: { date: day },
    update: { dayType, label: label ?? null },
    create: { date: day, dayType, label: label ?? null },
  });

  await prisma.auditLog.create({
    data: {
      action: "CALENDAR_UPDATE",
      entity: "CalendarDay",
      entityId: updated.date.toISOString().slice(0, 10),
      metaJson: JSON.stringify({
        date: updated.date.toISOString().slice(0, 10),
        dayType,
        label: label ?? null,
      }),
    },
  });

  return NextResponse.json({
    date: updated.date.toISOString().slice(0, 10),
    dayType: updated.dayType,
    label: updated.label,
  });
}
