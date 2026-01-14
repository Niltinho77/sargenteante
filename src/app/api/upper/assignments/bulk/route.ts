// src/app/api/upper/assignments/bulk/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, isoDay } from "@/lib/date";
import { materializeUpperBlocksForDay } from "@/lib/upper/materializeUpperBlocks";


type AssignmentRow = {
  upperFunctionId: string;
  militarId: string | null;
};

type Body = {
  date?: string; // YYYY-MM-DD
  assignments?: AssignmentRow[];
  createdById?: string;
  recalc?: boolean;
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    if (!body.date) return badRequest("date is required (YYYY-MM-DD)");

    let day: Date;
    try {
      day = parseISODateLocal(body.date);
      if (Number.isNaN(day.getTime())) return badRequest("Invalid date");
    } catch {
      return badRequest("Invalid date");
    }

    const rows = Array.isArray(body.assignments) ? body.assignments : [];
    if (!rows.length) return NextResponse.json({ ok: true, date: isoDay(day), changed: 0 });

    const validRows = rows.filter(
      (r): r is AssignmentRow => !!r?.upperFunctionId && typeof r.upperFunctionId === "string"
    );

    // Optional: ensure upper functions exist (avoid FK spam)
    const upperIds = Array.from(new Set(validRows.map((r) => r.upperFunctionId)));
    const existingUpper = await prisma.upperFunction.findMany({
      where: { id: { in: upperIds } },
      select: { id: true },
    });
    const upperSet = new Set(existingUpper.map((x) => x.id));
    const filtered = validRows.filter((r) => upperSet.has(r.upperFunctionId));

    if (!filtered.length) return NextResponse.json({ ok: true, date: isoDay(day), changed: 0 });

      const changed = await prisma.$transaction(async (tx) => {
    let count = 0;

    for (const a of filtered) {
      if (!a.militarId) {
        const del = await tx.upperAssignment.deleteMany({
          where: { date: day, upperFunctionId: a.upperFunctionId },
        });
        count += del.count;
        continue;
      }

      await tx.upperAssignment.upsert({
        where: { date_upperFunctionId: { date: day, upperFunctionId: a.upperFunctionId } },
        update: { militarId: a.militarId, createdById: body.createdById ?? null },
        create: { date: day, upperFunctionId: a.upperFunctionId, militarId: a.militarId, createdById: body.createdById ?? null },
      });

      count += 1;
    }

    return count;
  });

  await materializeUpperBlocksForDay(day);

  return NextResponse.json({ ok: true, date: isoDay(day), changed });

  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : "Unexpected error";
    return serverError(msg);
  }
}
