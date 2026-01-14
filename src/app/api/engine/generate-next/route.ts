// src/app/api/engine/generate-next/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateForDay } from "@/lib/engine/generate";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return normalizeDate(x);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { scaleId, date, allowOneDayRestOverride } = body as {
    scaleId?: string;
    date?: string; // YYYY-MM-DD
    allowOneDayRestOverride?: boolean;
  };

  const base = date ? new Date(date) : new Date();
  const day = addDays(normalizeDate(base), 1); // "próximo dia"

  // se scaleId vier, gera só nela. senão, gera em todas ativas.
  const scaleIds =
    scaleId
      ? [scaleId]
      : (await prisma.scale.findMany({ where: { isActive: true }, select: { id: true } })).map((s) => s.id);

  const results = [];
  for (const id of scaleIds) {
    const ev = await generateForDay(id, day, { allowOneDayRestOverride });
    results.push(ev);
  }

  return NextResponse.json({ day: day.toISOString().slice(0, 10), results });
}
