// src/app/api/upper/functions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const funcs = await prisma.upperFunction.findMany({
    where: { isActive: true },
    select: { id: true, nome: true, isActive: true, createdAt: true, updatedAt: true },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(funcs);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { nome } = body as { nome?: string };
  if (!nome?.trim()) return NextResponse.json({ error: "nome is required" }, { status: 400 });

  const created = await prisma.upperFunction.create({ data: { nome: nome.trim(), isActive: true } });

  await prisma.auditLog.create({
    data: { action: "UPPER_FUNCTION_CREATE", entity: "UpperFunction", entityId: created.id, metaJson: JSON.stringify({ nome: created.nome }) },
  });

  return NextResponse.json(created);
}
