// src/app/api/militars/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeNome(n: any) {
  if (typeof n !== "string") return null;
  const x = n.trim();
  if (x.length < 3) return null;
  return x;
}

function normalizePostoGrad(p: any) {
  if (p === null) return null;
  if (typeof p !== "string") return undefined; // "não mexe"
  const x = p.trim();
  return x.length ? x : null;
}

function toInt(n: any) {
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}

function toIntOrNull(n: any) {
  if (n === null) return null;
  if (typeof n !== "number" || Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}


export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    postoGrad?: string | null;
    antiguidade?: number;
    ativo?: boolean;

    folgaInicialPreta?: number;
    folgaInicialVermelha?: number;
  };


  try {
    
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.militar.findUnique({ where: { id } });
      if (!current) {
        return NextResponse.json({ error: "Militar not found" }, { status: 404 });
      }

      const patch: Record<string, any> = {};

      // ✅ folgaInicialPreta / folgaInicialVermelha
      if (body.folgaInicialPreta !== undefined) {
        const fp = toInt(body.folgaInicialPreta);
        if (fp === null || fp < 0) {
          return NextResponse.json(
            { error: "folgaInicialPreta must be an integer >= 0" },
            { status: 400 }
          );
        }
        patch.folgaInicialPreta = fp;
      }

      if (body.folgaInicialVermelha !== undefined) {
        const fv = toInt(body.folgaInicialVermelha);
        if (fv === null || fv < 0) {
          return NextResponse.json(
            { error: "folgaInicialVermelha must be an integer >= 0" },
            { status: 400 }
          );
        }
        patch.folgaInicialVermelha = fv;
      }


      // nome
      const nome = normalizeNome(body.nome);
      if (body.nome !== undefined) {
        if (!nome) {
          return NextResponse.json(
            { error: "nome must have at least 3 characters" },
            { status: 400 }
          );
        }
        patch.nome = nome;
      }

      // postoGrad
      const pg = normalizePostoGrad(body.postoGrad);
      if (pg !== undefined) patch.postoGrad = pg;

      // ativo
      if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

      // antiguidade (✅ com shift)
      const nextA = toInt(body.antiguidade);
      if (body.antiguidade !== undefined) {
        if (nextA === null || nextA < 0) {
          return NextResponse.json(
            { error: "antiguidade must be an integer >= 0" },
            { status: 400 }
          );
        }

        const oldA = current.antiguidade;

        if (nextA !== oldA) {
          // moveu para um número maior: puxa o intervalo (decrementa)
          if (nextA > oldA) {
            await tx.militar.updateMany({
              where: {
                id: { not: current.id },
                antiguidade: { gt: oldA, lte: nextA },
              },
              data: { antiguidade: { decrement: 1 } },
            });
          }

          // moveu para um número menor: empurra o intervalo (incrementa)
          if (nextA < oldA) {
            await tx.militar.updateMany({
              where: {
                id: { not: current.id },
                antiguidade: { gte: nextA, lt: oldA },
              },
              data: { antiguidade: { increment: 1 } },
            });
          }

          patch.antiguidade = nextA;
        }
      }

      const m = await tx.militar.update({
        where: { id },
        data: patch,
        select: {
          id: true,
          nome: true,
          postoGrad: true,
          antiguidade: true,
          ativo: true,
          folgaInicialPreta: true,
          folgaInicialVermelha: true,
        },
      });


      await tx.auditLog.create({
        data: {
          action: "MILITAR_UPDATE",
          entity: "Militar",
          entityId: m.id,
          metaJson: JSON.stringify({ patch }),
        },
      });

      return NextResponse.json(m);
    });

    // @ts-ignore (pode ser NextResponse dentro da transaction)
    if (updated?.headers) return updated as any;

    return updated as any;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao atualizar militar" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ✅ force=1 ativa exclusão permanente mesmo com vínculos
  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.militar.findUnique({ where: { id } });
      if (!current) {
        return NextResponse.json({ error: "Militar not found" }, { status: 404 });
      }

      // Conta vínculos (pra responder bem e pra audit)
      const [scaleMembers, restrictions, upperAssignments, dutiesExecutor, dutiesTitular, functionOptOuts] =
        await Promise.all([
          tx.scaleMember.count({ where: { militarId: id } }),
          tx.restriction.count({ where: { militarId: id } }),
          tx.upperAssignment.count({ where: { militarId: id } }),
          tx.dutyEvent.count({ where: { executorId: id } }),
          tx.dutyEvent.count({ where: { titularId: id } }),
          tx.scaleFunctionOptOut.count({ where: { militarId: id } }),
        ]);

      const linked =
        scaleMembers +
        restrictions +
        upperAssignments +
        dutiesExecutor +
        dutiesTitular +
        functionOptOuts;

      // ✅ modo seguro (padrão): trava
      if (!force && linked > 0) {
        return NextResponse.json(
          {
            error:
              "Não é possível excluir este militar porque ele já possui vínculos (escala/restrição/serviço). " +
              "Sugestão: desative o militar em vez de excluir. (Ou use exclusão permanente).",
            links: {
              scaleMembers,
              restrictions,
              upperAssignments,
              dutiesExecutor,
              dutiesTitular,
              functionOptOuts,
            },
            canForceDelete: true,
          },
          { status: 409 }
        );
      }

      // ✅ modo force: apaga tudo que referencia o militar (ordem importa por FK)
      let delScaleMembers = 0;
      let delRestrictions = 0;
      let delUpperAssignments = 0;
      let delDuties = 0;
      let delOptOuts = 0;

      // 1) scale members
      {
        const del = await tx.scaleMember.deleteMany({ where: { militarId: id } });
        delScaleMembers = del.count;
      }

      // 2) restrictions
      {
        const del = await tx.restriction.deleteMany({ where: { militarId: id } });
        delRestrictions = del.count;
      }

      // 3) upper assignments
      {
        const del = await tx.upperAssignment.deleteMany({ where: { militarId: id } });
        delUpperAssignments = del.count;
      }

      // 4) function opt-outs
      {
        const del = await tx.scaleFunctionOptOut.deleteMany({ where: { militarId: id } });
        delOptOuts = del.count;
      }

      // 5) duty events (executor OU titular)
      //    ⚠️ executorId é obrigatório no schema -> tem que deletar, não dá pra set null
      {
        const del = await tx.dutyEvent.deleteMany({
          where: { OR: [{ executorId: id }, { titularId: id }] },
        });
        delDuties = del.count;
      }

      // 6) remove militar
      await tx.militar.delete({ where: { id } });

      // ✅ puxa antiguidade (fecha buraco)
      await tx.militar.updateMany({
        where: { antiguidade: { gt: current.antiguidade } },
        data: { antiguidade: { decrement: 1 } },
      });

      await tx.auditLog.create({
        data: {
          action: force ? "MILITAR_PURGE" : "MILITAR_DELETE",
          entity: "Militar",
          entityId: id,
          metaJson: JSON.stringify({
            nome: current.nome,
            postoGrad: current.postoGrad,
            antiguidade: current.antiguidade,
            force,
            deleted: {
              scaleMembers: delScaleMembers,
              restrictions: delRestrictions,
              upperAssignments: delUpperAssignments,
              functionOptOuts: delOptOuts,
              dutyEvents: delDuties,
            },
          }),
        },
      });

      return NextResponse.json({
        ok: true,
        force,
        deleted: {
          scaleMembers: delScaleMembers,
          restrictions: delRestrictions,
          upperAssignments: delUpperAssignments,
          functionOptOuts: delOptOuts,
          dutyEvents: delDuties,
        },
      });
    });

    // @ts-ignore
    return result;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Erro ao excluir militar" },
      { status: 400 }
    );
  }
}

