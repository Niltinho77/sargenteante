// src/app/api/restrictions/[id]/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await req.json().catch(() => ({} as any));
  const { startDate, endDate, indefinite, reason, appliesTo, type } = body as {
    startDate?: string | null;
    endDate?: string | null;
    indefinite?: boolean;
    reason?: string | null;
    appliesTo?: "AMBAS" | "PRETA" | "VERMELHA" | null;
    type?: "AFASTAMENTO" | "FERIAS_PREJ" | null;
  };

  const data: any = {};
  if (startDate === null) data.startDate = null;
  if (endDate === null) data.endDate = null;
  if (typeof startDate === "string") data.startDate = normalizeDate(new Date(startDate));
  if (typeof endDate === "string") data.endDate = normalizeDate(new Date(endDate));
  if (typeof indefinite === "boolean") data.indefinite = indefinite;
  if (typeof reason === "string") data.reason = reason.trim() || null;
  if (reason === null) data.reason = null;

  // enum não-null: se vier null, volta pra AMBAS
  if (typeof appliesTo === "string") data.appliesTo = appliesTo;
  if (appliesTo === null) data.appliesTo = "AMBAS";
  if (typeof type === "string") data.type = type;

  // se virou FERIAS_PREJ, força AMBAS
  const nextType = typeof type === "string" ? type : undefined;
  if (nextType === "FERIAS_PREJ") data.appliesTo = "AMBAS";

  const updated = await prisma.restriction.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      action: "RESTRICTION_UPDATE",
      entity: "Restriction",
      entityId: updated.id,
      metaJson: JSON.stringify({ patch: data }),
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await prisma.restriction.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      action: "RESTRICTION_DELETE",
      entity: "Restriction",
      entityId: id,
      metaJson: JSON.stringify({ id }),
    },
  });

  return NextResponse.json({ ok: true });
}
