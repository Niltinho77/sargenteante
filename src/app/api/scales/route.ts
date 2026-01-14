// src/app/api/scales/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const scales = await prisma.scale.findMany({
    where: { isActive: true },
    select: { id: true, nome: true, descricao: true, isActive: true, createdAt: true, updatedAt: true },
    orderBy: [{ nome: "asc" }],
  });
  return NextResponse.json(scales);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { nome, descricao } = body as { nome?: string; descricao?: string | null };

  if (!nome?.trim()) return NextResponse.json({ error: "nome is required" }, { status: 400 });

  const created = await prisma.scale.create({
    data: { nome: nome.trim(), descricao: descricao?.trim() ? descricao.trim() : null, isActive: true },
  });

  await prisma.auditLog.create({
    data: {
      action: "SCALE_CREATE",
      entity: "Scale",
      entityId: created.id,
      metaJson: JSON.stringify({ nome: created.nome }),
    },
  });

  return NextResponse.json(created);
}
