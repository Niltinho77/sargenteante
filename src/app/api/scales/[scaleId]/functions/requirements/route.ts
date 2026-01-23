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

function parseDayStr(s: unknown) {
  if (typeof s !== "string" || !s.trim()) return null;
  const d = normalizeLocal(parseISODateLocal(s.trim()));
  if (Number.isNaN(d.getTime())) return null;
  return d;
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
    qty?: number | string;
    createdById?: string | null;

    // ✅ NOVO (propagar)
    applyDays?: number; // ex: 120
    to?: string; // YYYY-MM-DD
  };

  if (!body.scaleFunctionId) return json(400, { error: "scaleFunctionId is required" });
  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = parseDayStr(body.date);
  if (!day) return json(400, { error: "Invalid date" });

  const qty = parseQty((body as any).qty);
  if (!Number.isFinite(qty) || qty < 0) {
    return json(400, { error: "qty must be an integer >= 0" });
  }

  const fn = await prisma.scaleFunction.findFirst({
    where: { id: body.scaleFunctionId, scaleId },
    select: { id: true, nome: true },
  });
  if (!fn) return json(404, { error: "ScaleFunction not found for this scale" });

  // ✅ calcula range inclusivo
  let toDay = day;

  const toParsed = parseDayStr(body.to);
  if (toParsed) {
    toDay = toParsed;
  } else if (typeof body.applyDays === "number" && Number.isFinite(body.applyDays)) {
    const n = Math.max(1, Math.floor(body.applyDays));
    toDay = addDaysLocal(day, n - 1);
  }

  // se toDay for menor que day, normaliza pra day
  if (toDay < day) toDay = day;

  // monta lista [day..toDay] inclusivo
  const days: Date[] = [];
  for (let d = day; d <= toDay; d = addDaysLocal(d, 1)) days.push(d);

  const saved = await prisma.$transaction(async (tx) => {
    const rows = await Promise.all(
      days.map((dt) =>
        tx.scaleFunctionRequirement.upsert({
          where: { scaleFunctionId_date: { scaleFunctionId: fn.id, date: dt } },
          update: { qty, createdById: body.createdById ?? null },
          create: { scaleFunctionId: fn.id, date: dt, qty, createdById: body.createdById ?? null },
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
          scaleFunctionId: fn.id,
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

  // ✅ compatível com teu front: devolve o registro do dia (primeiro),
  // e também info do range (pra você usar depois se quiser)
  const first = saved[0];

  return noStoreJson({
    id: first.id,
    scaleFunctionId: first.scaleFunctionId,
    date: isoDay(first.date),
    qty: first.qty,
    createdById: first.createdById,
    createdAt: first.createdAt,
    updatedAt: first.updatedAt,

    // extra (não quebra)
    range: {
      from: isoDay(day),
      to: isoDay(toDay),
      updatedDays: saved.length,
    },
  });
}