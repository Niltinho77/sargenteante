// src/app/api/scales/[scaleId]/functions/[functionId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function normalizeName(s: unknown) {
  return typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
}

/**
 * IMPORTANT:
 * - AuditLog.metaJson provavelmente é VARCHAR(191) => estoura fácil.
 * - Mantemos metaJson compacto e com truncate de segurança.
 */
function safeMetaJson(payload: any, maxLen = 180) {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= maxLen) return s;

    const head = s.slice(0, Math.floor(maxLen * 0.7));
    const tail = s.slice(-Math.floor(maxLen * 0.2));

    // mantém um JSON curtinho e seguro
    const compact = JSON.stringify({
      _truncated: true,
      _len: s.length,
      head,
      tail,
    });

    return compact.length <= maxLen ? compact : compact.slice(0, maxLen);
  } catch {
    return JSON.stringify({ _meta: "unstringifiable" }).slice(0, maxLen);
  }
}

type AuditClient = Prisma.TransactionClient | typeof prisma;

async function audit(
  client: AuditClient,
  args: {
    action: string;
    entity: string;
    entityId?: string | null;
    userId?: string | null;
    meta?: any;
  }
) {
  await client.auditLog.create({
    data: {
      action: args.action,
      entity: args.entity,
      entityId: args.entityId ?? null,
      userId: args.userId ?? null,
      metaJson: args.meta ? safeMetaJson(args.meta) : null,
    },
  });
}

/**
 * PATCH: editar nome e/ou ativar/desativar
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    isActive?: boolean;
    createdById?: string | null;
  };

  const patch: Record<string, any> = {};

  if (typeof body.nome !== "undefined") {
    const nome = normalizeName(body.nome);
    if (nome.length < 2) return json(400, { error: "nome must have at least 2 chars" });
    patch.nome = nome;
  }

  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;

  if (!Object.keys(patch).length) return json(400, { error: "No patch fields provided" });

  const current = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true, scaleId: true, nome: true, isActive: true },
  });
  if (!current) return json(404, { error: "ScaleFunction not found for this scale" });

  try {
    const updated = await prisma.scaleFunction.update({
      where: { id: functionId },
      data: patch,
      select: {
        id: true,
        scaleId: true,
        nome: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await audit(prisma, {
      action: "SCALE_FUNCTION_UPDATE",
      entity: "ScaleFunction",
      entityId: updated.id,
      userId: body.createdById ?? null,
      meta: {
        scaleId,
        functionId,
        from: { nome: current.nome, isActive: current.isActive },
        to: { nome: updated.nome, isActive: updated.isActive },
        changed: Object.keys(patch),
      },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("Unique constraint") || msg.includes("P2002")) {
      return json(409, { error: "Já existe uma função com esse nome nesta escala." });
    }
    return json(500, { error: "Erro ao atualizar função." });
  }
}

/**
 * DELETE padrão: soft delete => isActive = false
 *
 * Para apagar de verdade (PURGE):
 *   DELETE /api/scales/[scaleId]/functions/[functionId]?hardDelete=1
 *
 * hardDelete=1 faz:
 * - deleteMany DutyEvent dessa função
 * - deleteMany Requirement dessa função
 * - deleteMany OptOut dessa função
 * - delete da ScaleFunction
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ scaleId: string; functionId: string }> }
) {
  const { scaleId, functionId } = await params;

  const url = new URL(req.url);
  const hardDelete = url.searchParams.get("hardDelete") === "1";
  const createdById = url.searchParams.get("createdById") || null;

  const current = await prisma.scaleFunction.findFirst({
    where: { id: functionId, scaleId },
    select: { id: true, scaleId: true, nome: true, isActive: true },
  });
  if (!current) return json(404, { error: "ScaleFunction not found for this scale" });

  // ✅ soft delete (default)
  if (!hardDelete) {
    try {
      const updated = await prisma.scaleFunction.update({
        where: { id: functionId },
        data: { isActive: false },
        select: { id: true, scaleId: true, nome: true, isActive: true, createdAt: true, updatedAt: true },
      });

      await audit(prisma, {
        action: "SCALE_FUNCTION_SOFT_DELETE",
        entity: "ScaleFunction",
        entityId: updated.id,
        userId: createdById,
        meta: {
          scaleId,
          functionId,
          nome: current.nome,
          fromActive: current.isActive,
          toActive: false,
        },
      });

      return NextResponse.json({
        ok: true,
        mode: "SOFT_DELETE",
        function: updated,
      });
    } catch (e: any) {
      return json(500, { error: e?.message ?? "Erro ao desativar função." });
    }
  }

  // ✅ hard delete PURGE
  try {
    const purged = await prisma.$transaction(async (tx) => {
      const delDuties = await tx.dutyEvent.deleteMany({ where: { scaleFunctionId: functionId } });
      const delReqs = await tx.scaleFunctionRequirement.deleteMany({ where: { scaleFunctionId: functionId } });
      const delOptOuts = await tx.scaleFunctionOptOut.deleteMany({ where: { scaleFunctionId: functionId } });

      await tx.scaleFunction.delete({ where: { id: functionId } });

      await audit(tx, {
        action: "SCALE_FUNCTION_HARD_DELETE_PURGE",
        entity: "ScaleFunction",
        entityId: functionId,
        userId: createdById,
        meta: {
          scaleId,
          functionId,
          nome: current.nome,
          purged: {
            dutyEvents: delDuties.count,
            requirements: delReqs.count,
            optOuts: delOptOuts.count,
          },
        },
      });

      return {
        purged: {
          dutyEvents: delDuties.count,
          requirements: delReqs.count,
          optOuts: delOptOuts.count,
        },
      };
    });

    return NextResponse.json({
      ok: true,
      mode: "HARD_DELETE_PURGE",
      functionId,
      purged: purged.purged,
    });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "Erro ao apagar função";
    return json(500, { error: msg });
  }
}
