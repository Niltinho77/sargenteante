// src/app/api/scales/[scaleId]/functions/[functionId]/requirements/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  date?: string; // YYYY-MM-DD
  qty?: number;  // >= 0
  createdById?: string | null;
};

function noStoreJson(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function json(status: number, payload: any) {
  return noStoreJson(payload, status);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  if (typeof body.qty !== "number" || !Number.isFinite(body.qty)) {
    return json(400, { error: "qty is required (number)" });
  }
  const qty = Math.max(0, Math.floor(body.qty));

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true, nome: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  const saved = await prisma.$transaction(async (tx) => {
    const upserted = await tx.scaleFunctionRequirement.upsert({
      where: { scaleFunctionId_date: { scaleFunctionId: functionId, date: day } },
      update: { qty, createdById: body.createdById ?? null },
      create: {
        scaleFunctionId: functionId,
        date: day,
        qty,
        createdById: body.createdById ?? null,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "SCALE_FUNCTION_REQUIREMENT_UPSERT",
        entity: "ScaleFunctionRequirement",
        entityId: upserted.id,
        userId: body.createdById ?? null,
        metaJson: JSON.stringify({
          scaleId,
          scaleFunctionId: functionId,
          functionNome: fn.nome,
          date: isoDay(day),
          qty,
        }),
      },
    });

    return upserted;
  });

  return noStoreJson({
    ok: true,
    requirement: {
      id: saved.id,
      scaleFunctionId: saved.scaleFunctionId,
      date: isoDay(saved.date),
      qty: saved.qty,
      createdById: saved.createdById,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const url = new URL(req.url);
  const dateStr = url.searchParams.get("date");
  const createdById = url.searchParams.get("createdById") || null;

  if (!dateStr) return json(400, { error: "date query param is required (YYYY-MM-DD)" });

  const day = normalizeLocal(parseISODateLocal(dateStr));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.scaleFunctionRequirement.findUnique({
      where: { scaleFunctionId_date: { scaleFunctionId: functionId, date: day } },
      select: { id: true },
    });

    if (!existing) return { deleted: false };

    await tx.scaleFunctionRequirement.delete({ where: { id: existing.id } });

    await tx.auditLog.create({
      data: {
        action: "SCALE_FUNCTION_REQUIREMENT_DELETE",
        entity: "ScaleFunctionRequirement",
        entityId: existing.id,
        userId: createdById,
        metaJson: JSON.stringify({
          scaleId,
          scaleFunctionId: functionId,
          date: isoDay(day),
        }),
      },
    });

    return { deleted: true };
  });

  return noStoreJson({ ok: true, ...result });
}
