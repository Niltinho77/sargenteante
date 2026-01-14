// src/app/api/audit/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const take = Math.min(200, Math.max(1, Number(searchParams.get("take") ?? 50)));

  const logs = await prisma.auditLog.findMany({
    take,
    orderBy: { createdAt: "desc" },
    select: { id: true, action: true, entity: true, entityId: true, metaJson: true, createdAt: true, userId: true },
  });

  return NextResponse.json(logs);
}
