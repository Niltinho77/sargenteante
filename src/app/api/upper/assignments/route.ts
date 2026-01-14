// src/app/api/upper/assignments/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { materializeUpperBlocksForDay } from "@/lib/upper/materializeUpperBlocks";
import { recalcAndGenerate } from "@/lib/engine/recalc";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });

  const day = normalizeDate(new Date(date));
  if (Number.isNaN(day.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  const items = await prisma.upperAssignment.findMany({
    where: { date: day },
    select: {
      id: true,
      upperFunctionId: true,
      militarId: true,
      upperFunction: { select: { id: true, nome: true } },
      militar: { select: { id: true, nome: true, postoGrad: true } },
    },
    orderBy: [{ upperFunction: { nome: "asc" } }],
  });

  return NextResponse.json({
    date: day.toISOString().slice(0, 10),
    assignments: items,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { date, upperFunctionId, militarId, recalc } = body as {
    date?: string;
    upperFunctionId?: string;
    militarId?: string;
    recalc?: boolean;
  };

  if (!date || !upperFunctionId || !militarId) {
    return NextResponse.json({ error: "date, upperFunctionId, militarId are required" }, { status: 400 });
  }

  const day = normalizeDate(new Date(date));
  if (Number.isNaN(day.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });

  // upsert assignment (1 militar por função por dia)
  const created = await prisma.upperAssignment.upsert({
    where: { date_upperFunctionId: { date: day, upperFunctionId } },
    update: { militarId },
    create: { date: day, upperFunctionId, militarId },
  });

  await prisma.auditLog.create({
    data: {
      action: "UPPER_ASSIGNMENT_UPSERT",
      entity: "UpperAssignment",
      entityId: created.id,
      metaJson: JSON.stringify({ date: day.toISOString().slice(0, 10), upperFunctionId, militarId }),
    },
  });

  // materializa bloqueios visuais (CIMA)
  await materializeUpperBlocksForDay(day);

  // recalcular (default true)
  if (recalc !== false) {
    await recalcAndGenerate(day, { keepManual: true, keepSwaps: true });
  }

  return NextResponse.json({ ok: true, assignmentId: created.id });
}
