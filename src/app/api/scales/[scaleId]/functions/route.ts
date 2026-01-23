// src/app/api/scales/[scaleId]/functions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeLocal } from "@/lib/date"; // ✅ add

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function normalizeName(s: unknown) {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
}

function addDaysLocal(d: Date, n: number) {
  const x = normalizeLocal(d);
  x.setDate(x.getDate() + n);
  return normalizeLocal(x);
}

export async function GET(_req: Request, { params }: { params: Promise<{ scaleId: string }> }) {
  const { scaleId } = await params;

  const items = await prisma.scaleFunction.findMany({
    where: { scaleId },
    select: {
      id: true,
      scaleId: true,
      nome: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ isActive: "desc" }, { nome: "asc" }],
  });

  return NextResponse.json(items);
}

export async function POST(req: Request, { params }: { params: Promise<{ scaleId: string }> }) {
  const { scaleId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    isActive?: boolean;
    createdById?: string | null;

    // ✅ opcional: qty padrão inicial
    qtyDefault?: number;

    // ✅ opcional: quantos dias semear (override)
    seedDays?: number;
  };

  const nome = normalizeName(body.nome);
  if (nome.length < 2) return json(400, { error: "nome is required (min 2 chars)" });

  const scale = await prisma.scale.findUnique({
    where: { id: scaleId },
    select: { id: true, nome: true },
  });
  if (!scale) return json(404, { error: "Scale not found" });

  const qtyDefault =
    typeof body.qtyDefault === "number" && Number.isFinite(body.qtyDefault) && body.qtyDefault >= 0
      ? Math.floor(body.qtyDefault)
      : 1;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) cria função
      const created = await tx.scaleFunction.create({
        data: {
          scaleId,
          nome,
          isActive: typeof body.isActive === "boolean" ? body.isActive : true,
        },
        select: {
          id: true,
          scaleId: true,
          nome: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // 2) descobre horizonte
      const cfg = await tx.engineConfig.findFirst();
      const horizon = Math.max(
        1,
        Math.floor(
          typeof body.seedDays === "number" && Number.isFinite(body.seedDays)
            ? body.seedDays
            : (cfg?.recalcHorizonDays ?? 120)
        )
      );

      // 3) semeia requirements para [hoje..hoje+horizon-1]
      const today = normalizeLocal(new Date());

      const rows = Array.from({ length: horizon }, (_, i) => ({
        scaleFunctionId: created.id,
        date: addDaysLocal(today, i),
        qty: qtyDefault,
        createdById: body.createdById ?? null,
      }));

      // createMany + skipDuplicates funciona se existir unique(scaleFunctionId, date)
      await tx.scaleFunctionRequirement.createMany({
        data: rows,
        skipDuplicates: true,
      });

      // audit
      await tx.auditLog.create({
        data: {
          action: "SCALE_FUNCTION_CREATE",
          entity: "ScaleFunction",
          entityId: created.id,
          metaJson: JSON.stringify({
            scaleId,
            scaleNome: scale.nome,
            nome: created.nome,
            isActive: created.isActive,
            createdById: body.createdById ?? null,
            seeded: { horizonDays: horizon, qtyDefault },
          }),
          userId: body.createdById ?? null,
        },
      });

      return created;
    });

    return NextResponse.json(result);
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return json(409, { error: "Já existe uma função com esse nome nesta escala." });
    }
    return json(500, { error: "Erro ao criar função." });
  }
}