// src/app/api/scales/[scaleId]/functions/[functionId]/requirements/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = {
  date?: string; // YYYY-MM-DD
  qty?: number | string; // >= 0
  createdById?: string | null;

  // ✅ NOVO
  applyDays?: number;
  to?: string; // YYYY-MM-DD
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

function addDaysLocal(d: Date, n: number) {
  const x = normalizeLocal(d);
  x.setDate(x.getDate() + n);
  return normalizeLocal(x);
}

function parseDayStr(s: unknown) {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = normalizeLocal(parseISODateLocal(s.trim()));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseQty(raw: unknown) {
  const qtyNum =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : NaN;

  const qty = Number.isFinite(qtyNum) ? Math.floor(qtyNum) : NaN;
  return qty;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = parseDayStr(body.date);
  if (!day) return json(400, { error: "Invalid date" });

  const qty = parseQty((body as any).qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return json(400, { error: "qty must be an integer >= 0" });
  }

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true, nome: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  // ✅ range inclusivo
  let toDay = day;

  const toParsed = parseDayStr(body.to);
  if (toParsed) {
    toDay = toParsed;
  } else if (typeof body.applyDays === "number" && Number.isFinite(body.applyDays)) {
    const n = Math.max(1, Math.floor(body.applyDays));
    toDay = addDaysLocal(day, n - 1);
  }

  if (toDay < day) toDay = day;

  const days: Date[] = [];
  for (let d = day; d <= toDay; d = addDaysLocal(d, 1)) days.push(d);

  const savedRows = await prisma.$transaction(async (tx) => {
    const rows = await Promise.all(
      days.map((dt) =>
        tx.scaleFunctionRequirement.upsert({
          where: { scaleFunctionId_date: { scaleFunctionId: functionId, date: dt } },
          update: { qty, createdById: body.createdById ?? null },
          create: {
            scaleFunctionId: functionId,
            date: dt,
            qty,
            createdById: body.createdById ?? null,
          },
          select: {
            id: true,
            scaleFunctionId: true,
            date: true,
            qty: true,
            createdById: true,
            createdAt: true,
            updatedAt: true,
          },
        })
      )
    );

    await tx.auditLog.create({
      data: {
        action:
          rows.length > 1
            ? "SCALE_FUNCTION_REQUIREMENT_UPSERT_RANGE"
            : "SCALE_FUNCTION_REQUIREMENT_UPSERT",
        entity: "ScaleFunctionRequirement",
        entityId: rows[0]?.id ?? null,
        userId: body.createdById ?? null,
        metaJson: JSON.stringify({
          scaleId,
          scaleFunctionId: functionId,
          functionNome: fn.nome,
          from: isoDay(day),
          to: isoDay(toDay),
          qty,
          count: rows.length,
        }),
      },
    });

    return rows;
  });

  return noStoreJson({
    ok: true,
    requirement: {
      id: savedRows[0].id,
      scaleFunctionId: savedRows[0].scaleFunctionId,
      date: isoDay(savedRows[0].date),
      qty: savedRows[0].qty,
      createdById: savedRows[0].createdById,
      createdAt: savedRows[0].createdAt,
      updatedAt: savedRows[0].updatedAt,
    },
    range: {
      from: isoDay(day),
      to: isoDay(toDay),
      updatedDays: savedRows.length,
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

  const day = parseDayStr(dateStr);
  if (!day) return json(400, { error: "Invalid date" });

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