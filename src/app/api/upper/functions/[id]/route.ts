// src/app/api/upper/functions/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  const updated = await prisma.upperFunction.update({
    where: { id },
    data: { isActive: false },
  });

  await prisma.auditLog.create({
    data: {
      action: "UPPER_FUNCTION_DISABLE",
      entity: "UpperFunction",
      entityId: id,
      metaJson: JSON.stringify({ id }),
    },
  });

  return NextResponse.json({ ok: true, id: updated.id });
}

