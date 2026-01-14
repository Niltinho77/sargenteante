// src/app/api/calendar/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureCalendarRange } from "@/lib/calendar/ensureCalendarRange";

function parseDateParam(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = parseDateParam(searchParams.get("from"));
  const to = parseDateParam(searchParams.get("to"));

  if (!from || !to) return NextResponse.json({ error: "from/to are required (YYYY-MM-DD)" }, { status: 400 });

  await ensureCalendarRange(from, to);

  const days = await prisma.calendarDay.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true, dayType: true, label: true },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: days.map((d) => ({ date: d.date.toISOString().slice(0, 10), dayType: d.dayType, label: d.label })),
  });
}
