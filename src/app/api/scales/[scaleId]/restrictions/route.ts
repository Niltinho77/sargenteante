// src/app/api/scales/[scaleId]/restrictions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const items = await prisma.restriction.findMany({
    where: {
      OR: [{ scaleId }, { scaleId: null }],
    },
    select: {
      id: true,
      scaleId: true,
      militarId: true,
      startDate: true,
      endDate: true,
      indefinite: true,
      reason: true,
      appliesTo: true, // ✅
      type: true, // ✅
      militar: {
        select: {
          id: true,
          nome: true,
          postoGrad: true,
        },
      },
    },
    orderBy: [{ militar: { nome: "asc" } }],
  });

  return NextResponse.json(
    items.map((r) => ({
      ...r, appliesTo: r.appliesTo, type: r.type, // ✅
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    }))
  );
}
