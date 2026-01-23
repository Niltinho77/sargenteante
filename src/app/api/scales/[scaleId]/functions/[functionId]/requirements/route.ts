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

  // ✅ novo: aplica o mesmo qty para [date .. date+applyDays-1]
  applyDays?: number | string;
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

function parseNonNegInt(v: any, fallback: number) {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const startDay = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(startDay.getTime())) return json(400, { error: "Invalid date" });

  const qty = parseNonNegInt(body.qty, NaN as any);
  if (!Number.isFinite(qty) || qty < 0) return json(400, { error: "qty must be a number >= 0" });

  const applyDaysRaw = parseNonNegInt(body.applyDays, 1);
  const applyDays = Math.min(Math.max(applyDaysRaw, 1), 365); // limite seguro

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true, nome: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  const saved = await prisma.$transaction(async (tx) => {
    const days: string[] = [];
    let lastUpsert: any = null;

    for (let i = 0; i < applyDays; i++) {
      const day = addDaysLocal(startDay, i);

      // se qty=0, nós DELETAMOS o requirement daquele dia (limpa)
      if (qty === 0) {
        await tx.scaleFunctionRequirement.deleteMany({
          where: { scaleFunctionId: functionId, date: day },
        });
        days.push(isoDay(day));
        continue;
      }

      lastUpsert = await tx.scaleFunctionRequirement.upsert({
        where: { scaleFunctionId_date: { scaleFunctionId: functionId, date: day } },
        update: { qty, createdById: body.createdById ?? null },
        create: {
          scaleFunctionId: functionId,
          date: day,
          qty,
          createdById: body.createdById ?? null,
        },
      });

      days.push(isoDay(day));
    }

    await tx.auditLog.create({
      data: {
        action: "SCALE_FUNCTION_REQUIREMENT_UPSERT_RANGE",
        entity: "ScaleFunctionRequirement",
        entityId: lastUpsert?.id ?? null,
        userId: body.createdById ?? null,
        metaJson: JSON.stringify({
          scaleId,
          scaleFunctionId: functionId,
          functionNome: fn.nome,
          from: isoDay(startDay),
          applyDays,
          qty,
        }),
      },
    });

    return { ok: true, functionId, from: isoDay(startDay), applyDays, qty, days };
  });

  return noStoreJson(saved);
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
    select: { id: true, nome: true },
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
          functionNome: fn.nome,
          date: isoDay(day),
        }),
      },
    });

    return { deleted: true };
  });

  return noStoreJson({ ok: true, ...result });
}