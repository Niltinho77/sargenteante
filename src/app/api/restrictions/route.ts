// src/app/api/restrictions/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { militarId, scaleId, startDate, endDate, indefinite, reason, appliesTo, type } = body as {
    militarId?: string;
    scaleId?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    indefinite?: boolean;
    reason?: string | null;
    appliesTo?: "AMBAS" | "PRETA" | "VERMELHA" | null;
    type?: "AFASTAMENTO" | "FERIAS_PREJ" | null;
  };

  if (!militarId) return NextResponse.json({ error: "militarId is required" }, { status: 400 });

  const finalType = type ?? "AFASTAMENTO";
  const finalAppliesTo = finalType === "FERIAS_PREJ" ? "AMBAS" : (appliesTo ?? "AMBAS");

const created = await prisma.restriction.create({
  data: {
    militarId,
    scaleId: scaleId ?? null,
    startDate: startDate ? normalizeDate(new Date(startDate)) : null,
    endDate: endDate ? normalizeDate(new Date(endDate)) : null,
    indefinite: Boolean(indefinite),
    reason: reason?.trim() ? reason.trim() : null,
    appliesTo: finalAppliesTo,
    type: finalType,
  },
}); 

  return NextResponse.json(created);
}
