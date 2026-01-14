// src/app/api/scales/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({} as any));
  const { nome, descricao, isActive } = body as { nome?: string; descricao?: string | null; isActive?: boolean };

  const data: any = {};
  if (typeof nome === "string") data.nome = nome.trim();
  if (typeof descricao === "string") data.descricao = descricao.trim() || null;
  if (descricao === null) data.descricao = null;
  if (typeof isActive === "boolean") data.isActive = isActive;

  const updated = await prisma.scale.update({ where: { id: params.id }, data });

  await prisma.auditLog.create({
    data: {
      action: "SCALE_UPDATE",
      entity: "Scale",
      entityId: updated.id,
      metaJson: JSON.stringify({ patch: data }),
    },
  });

  return NextResponse.json(updated);
}
