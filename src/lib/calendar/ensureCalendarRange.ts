// src/lib/calendar/ensureCalendarRange.ts
import { prisma } from "@/lib/prisma";
import type { DayType } from "@prisma/client";

function normalizeDate(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return normalizeDate(x);
}

function isWeekend(d: Date) {
  const wd = d.getDay(); // 0=Dom 6=Sáb
  return wd === 0 || wd === 6;
}

export async function ensureCalendarRange(from: Date, to: Date) {
  const start = normalizeDate(from);
  const end = normalizeDate(to);

  const existing = await prisma.calendarDay.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true },
  });

  const existingSet = new Set(existing.map((d) => d.date.toISOString().slice(0, 10)));

  const toCreate: Array<{ date: Date; dayType: DayType }> = [];
  for (let cur = new Date(start); cur <= end; cur = addDays(cur, 1)) {
    const key = cur.toISOString().slice(0, 10);
    if (existingSet.has(key)) continue;
    toCreate.push({ date: normalizeDate(cur), dayType: isWeekend(cur) ? "VERMELHA" : "PRETA" });
  }

  if (toCreate.length) {
    await prisma.calendarDay.createMany({ data: toCreate, skipDuplicates: true });
  }

  return { created: toCreate.length };
}
