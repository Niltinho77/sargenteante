// src/app/api/scales/[scaleId]/members/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const items = await prisma.scaleMember.findMany({
    where: { scaleId },
    select: {
      id: true,
      isActive: true,
      competitionMode: true,
      militar: {
        select: {
          id: true,
          nome: true,
          postoGrad: true,
          antiguidade: true,
          ativo: true,
          folgaInicialPreta: true,
          folgaInicialVermelha: true,
        },
      },
    },
    orderBy: [{ militar: { nome: "asc" } }],
  });

  return NextResponse.json(items);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    militarId?: string;
    competitionMode?: "AMBAS" | "SOMENTE_PRETA" | "SOMENTE_VERMELHA" | "NENHUMA";
  };

  const militarId = body.militarId;
  if (!militarId) {
    return NextResponse.json({ error: "militarId is required" }, { status: 400 });
  }

  const created = await prisma.scaleMember.upsert({
    where: {
      scaleId_militarId: {
        scaleId,
        militarId,
      },
    },
    update: {
      isActive: true,
      competitionMode: body.competitionMode ?? "AMBAS",
    },
    create: {
      scaleId,
      militarId,
      competitionMode: body.competitionMode ?? "AMBAS",
      isActive: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "SCALE_MEMBER_UPSERT",
      entity: "ScaleMember",
      entityId: created.id,
      metaJson: JSON.stringify({
        scaleId,
        militarId,
        competitionMode: created.competitionMode,
      }),
    },
  });

  return NextResponse.json(created);
}
