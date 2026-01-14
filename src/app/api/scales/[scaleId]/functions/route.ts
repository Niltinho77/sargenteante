// src/app/api/scales/[scaleId]/functions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function normalizeName(s: unknown) {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
}

export async function GET(_req: Request, { params }: { params: Promise<{ scaleId: string }> }) {
  const { scaleId } = await params;

  // retorna todas as funções da escala (ativas e inativas)
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
    createdById?: string; // opcional (se tu já tiver userId no client)
  };

  const nome = normalizeName(body.nome);
  if (nome.length < 2) return json(400, { error: "nome is required (min 2 chars)" });

  // valida se a escala existe
  const scale = await prisma.scale.findUnique({ where: { id: scaleId }, select: { id: true, nome: true } });
  if (!scale) return json(404, { error: "Scale not found" });

  try {
    const created = await prisma.scaleFunction.create({
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

    await prisma.auditLog.create({
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
        }),
        userId: body.createdById ?? null,
      },
    });

    return NextResponse.json(created);
  } catch (e: any) {
    // Prisma unique violation
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return json(409, { error: "Já existe uma função com esse nome nesta escala." });
    }
    return json(500, { error: "Erro ao criar função." });
  }
}
