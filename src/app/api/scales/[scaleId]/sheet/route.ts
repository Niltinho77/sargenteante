// src/app/api/scales/[scaleId]/sheet/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

// soma dias mantendo "meia-noite local"
function addDaysLocal(d: Date, n: number) {
  const x = normalizeLocal(d);
  x.setDate(x.getDate() + n);
  return normalizeLocal(x);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;
  const { searchParams } = new URL(req.url);

  // 1) lê query
  const fromStr = searchParams.get("from"); // YYYY-MM-DD
  const toStr = searchParams.get("to");     // YYYY-MM-DD

  // 2) define defaults em STRING primeiro (pra não dar bug de timezone)
  const todayISO = isoDay(normalizeLocal(new Date()));

  const fromISO = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? fromStr : todayISO;

  const toISO =
    toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr)
      ? toStr
      : isoDay(addDaysLocal(parseISODateLocal(fromISO), 14));

  // 3) converte para Date (meia-noite local)
  const from = normalizeLocal(parseISODateLocal(fromISO));
  const to = normalizeLocal(parseISODateLocal(toISO));

  // 4) intervalo inclusivo robusto: gte from, lt (to + 1)
  const toPlus1 = addDaysLocal(to, 1);

  // 5) Calendar days (no range)
  const daysDb = await prisma.calendarDay.findMany({
    where: { date: { gte: from, lt: toPlus1 } },
    orderBy: { date: "asc" },
    select: { date: true, dayType: true },
  });

  // IMPORTANTE: days sempre retornam em ISO (YYYY-MM-DD)
  const days = daysDb.map((d) => ({ date: isoDay(d.date), dayType: d.dayType }));
  const calMap = new Map(days.map((d) => [d.date, d.dayType] as const));

  // 6) Members (ativos)
  const members = await prisma.scaleMember.findMany({
    where: { scaleId, isActive: true, militar: { ativo: true } },
    select: {
      id: true,
      scaleId: true,
      militarId: true,
      competitionMode: true,
      isActive: true,
      militar: {
        select: {
          id: true,
          nome: true,
          postoGrad: true,
          antiguidade: true,
          createdAt: true, 
          folgaInicialPreta: true,
          folgaInicialVermelha: true,
          ativo: true,
        },
      },
    },
    orderBy: [{ militar: { nome: "asc" } }],
  });


  const memberIds = members.map((m) => m.militar.id);

  // 7) BAIXO desta escala (AUTO/MANUAL/SWAP) — dentro do range
  const baixoDb = await prisma.dutyEvent.findMany({
    where: {
      scaleId,
      kind: "BAIXO",
      date: { gte: from, lt: toPlus1 },
      OR: [{ executorId: { in: memberIds } }, { titularId: { in: memberIds } }],
    },
    select: {
      id: true,
      date: true,
      kind: true,
      dayType: true,
      origin: true,
      executorId: true,
      titularId: true,
      scaleId: true,
      scaleFunctionId: true,
      slot: true,
      createdAt: true,
      // ✅ ADD
      scaleFunction: { select: { nome: true } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });


  const baixo = baixoDb.map((b) => ({
    id: b.id,
    date: isoDay(b.date),
    kind: b.kind,
    dayType: b.dayType,
    origin: b.origin,
    executorId: b.executorId,
    titularId: b.titularId,
    scaleId: b.scaleId,
    scaleFunctionId: b.scaleFunctionId,
    slot: b.slot,
    functionNome: b.scaleFunction?.nome ?? null, // ✅ ADD
    createdAt: b.createdAt,
  }));


  // 8) CIMA (escala de cima) — só dos membros e no range
  const upperAssignments = await prisma.upperAssignment.findMany({
    where: { date: { gte: from, lt: toPlus1 }, militarId: { in: memberIds } },
    select: { date: true, militarId: true },
    orderBy: [{ date: "asc" }],
  });

  const cima = upperAssignments.map((a) => {
    const d = isoDay(a.date);
    return {
      id: `upper:${d}:${a.militarId}`,
      date: d,
      kind: "CIMA" as const,
      dayType: calMap.get(d) ?? "PRETA",
      origin: "AUTO" as const,
      executorId: a.militarId,
      titularId: null,
      scaleId: null as any, // só UI
    };
  });

  // 9) Restrictions (globais + desta escala), só dos membros
  const restrictionsDb = await prisma.restriction.findMany({
    where: {
      militarId: { in: memberIds },
      OR: [{ scaleId }, { scaleId: null }],
    },
    select: {
      militarId: true,
      startDate: true,
      endDate: true,
      indefinite: true,
      appliesTo: true,
    },
  });

  const restrictions = restrictionsDb.map((r) => ({
    militarId: r.militarId,
    startDate: r.startDate ? isoDay(r.startDate) : null,
    endDate: r.endDate ? isoDay(r.endDate) : null,
    indefinite: r.indefinite,
    appliesTo: r.appliesTo, // "AMBAS" | "PRETA" | "VERMELHA"
  }));

  // ✅ retorno consistente: from/to em ISO correto, igual ao calculado
  return NextResponse.json({
    from: fromISO,
    to: toISO,
    days,
    members,
    duties: [...baixo, ...cima],
    restrictions,
  });
}
