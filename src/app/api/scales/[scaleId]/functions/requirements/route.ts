// src/app/api/scales/[scaleId]/functions/requirements/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

// intervalo inclusivo robusto: [from, to] => gte from, lt (to + 1)
function buildRange(fromStr?: string | null, toStr?: string | null) {
  const from = fromStr ? normalizeLocal(parseISODateLocal(fromStr)) : null;
  const to = toStr ? normalizeLocal(parseISODateLocal(toStr)) : null;

  if (from && Number.isNaN(from.getTime())) throw new Error("Invalid from");
  if (to && Number.isNaN(to.getTime())) throw new Error("Invalid to");

  if (from && to) {
    const toPlus1 = addDaysLocal(to, 1);
    return { gte: from, lt: toPlus1 };
  }
  if (from && !to) {
    return { gte: from, lt: addDaysLocal(from, 1) };
  }
  if (!from && to) {
    return { gte: to, lt: addDaysLocal(to, 1) };
  }
  return null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from"); // YYYY-MM-DD
  const toStr = url.searchParams.get("to"); // YYYY-MM-DD
  const functionId = url.searchParams.get("functionId");

  const where: any = { scaleFunction: { scaleId } };
  if (functionId) where.scaleFunctionId = functionId;

  const range = buildRange(fromStr, toStr);
  if (range) where.date = range;

  const rows = await prisma.scaleFunctionRequirement.findMany({
    where,
    select: {
      id: true,
      scaleFunctionId: true,
      date: true,
      qty: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      scaleFunction: { select: { nome: true } },
    },
    orderBy: [{ date: "asc" }, { scaleFunction: { nome: "asc" } }],
  });

  return noStoreJson(
    rows.map((r) => ({
      id: r.id,
      scaleFunctionId: r.scaleFunctionId,
      functionNome: r.scaleFunction.nome,
      date: isoDay(r.date),
      qty: r.qty,
      createdById: r.createdById,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    scaleFunctionId?: string;
    date?: string; // YYYY-MM-DD
    qty?: number;
    createdById?: string | null;
  };

  if (!body.scaleFunctionId) return json(400, { error: "scaleFunctionId is required" });
  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  const qty = typeof body.qty === "number" ? Math.floor(body.qty) : NaN;
  if (!Number.isFinite(qty) || qty < 0) return json(400, { error: "qty must be a number >= 0" });

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: body.scaleFunctionId, scaleId },
    select: { id: true, nome: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  const created = await prisma.scaleFunctionRequirement.upsert({
    where: { scaleFunctionId_date: { scaleFunctionId: fn.id, date: day } },
    update: { qty, createdById: body.createdById ?? null },
    create: { scaleFunctionId: fn.id, date: day, qty, createdById: body.createdById ?? null },
    select: {
      id: true,
      scaleFunctionId: true,
      date: true,
      qty: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // audit (pequeno -> sem risco de metaJson gigante)
  await prisma.auditLog.create({
    data: {
      action: "SCALE_FUNCTION_REQUIREMENT_UPSERT",
      entity: "ScaleFunctionRequirement",
      entityId: created.id,
      userId: body.createdById ?? null,
      metaJson: JSON.stringify({
        scaleId,
        scaleFunctionId: fn.id,
        functionNome: fn.nome,
        date: isoDay(created.date),
        qty: created.qty,
      }),
    },
  });

  return noStoreJson({
    id: created.id,
    scaleFunctionId: created.scaleFunctionId,
    date: isoDay(created.date),
    qty: created.qty,
    createdById: created.createdById,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  });
}
