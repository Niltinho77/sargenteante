// src/app/api/scales/[scaleId]/members/[memberId]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ scaleId: string; memberId: string }>;
  }
) {
  const { scaleId, memberId } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    isActive?: boolean;
    competitionMode?: "AMBAS" | "SOMENTE_PRETA" | "SOMENTE_VERMELHA" | "NENHUMA";
  };

  const data: Record<string, any> = {};
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.competitionMode === "string") data.competitionMode = body.competitionMode;

  const updated = await prisma.scaleMember.update({
    where: { id: memberId },
    data,
  });

  await prisma.auditLog.create({
    data: {
      action: "SCALE_MEMBER_UPDATE",
      entity: "ScaleMember",
      entityId: updated.id,
      metaJson: JSON.stringify({ scaleId, patch: data }),
    },
  });

  return NextResponse.json(updated);
}
