// src/lib/engine/generate.ts
import { prisma } from "@/lib/prisma";
import type {
  DayType,
  DutyEvent,
  CompetitionMode,
  DutyOrigin,
  DutyKind,
} from "@prisma/client";

export type GenerateOpts = {
  createdById?: string;
  allowOneDayRestOverride?: boolean;
};

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function compAllows(mode: CompetitionMode, dayType: DayType) {
  if (mode === "NENHUMA") return false;
  if (mode === "AMBAS") return true;
  if (mode === "SOMENTE_PRETA") return dayType === "PRETA";
  if (mode === "SOMENTE_VERMELHA") return dayType === "VERMELHA";
  return false;
}

function creditedMilitarId(ev: {
  origin: DutyOrigin;
  titularId: string | null;
  executorId: string;
}) {
  // SWAP conta para o titular (quem era o da vez)
  if (ev.origin === "SWAP" && ev.titularId) return ev.titularId;
  return ev.executorId;
}

function diffDays(a: Date, b: Date) {
  // a - b em dias inteiros
  const A = normalizeDate(a).getTime();
  const B = normalizeDate(b).getTime();
  return Math.floor((A - B) / 86400000);
}

export async function generateForDay(
  scaleId: string,
  date: Date,
  opts: GenerateOpts = {}
): Promise<DutyEvent> {
  const day = normalizeDate(date);

  // já existe BAIXO nesse dia?
  const existing = await prisma.dutyEvent.findFirst({
    where: { date: day, scaleId, kind: "BAIXO" },
  });
  if (existing) return existing;

  const config = await prisma.engineConfig.findFirst();

  // config.minRestDays = DIAS DE FOLGA (default 2)
  const minOffDays = config?.minRestDays ?? 2;

  // diferença mínima entre datas de serviço:
  // 2 folgas => diff >= 3 (serviu dia D -> pode dia D+3)
  const requiredDiff = minOffDays + 1;

  // exceção 1 folga => diff >= 2
  const allowOneDayRest =
    opts.allowOneDayRestOverride ?? (config?.allowOneDayRest ?? false);
  const requiredDiffWithOverride = 2;

  const cal = await prisma.calendarDay.findUnique({ where: { date: day } });
  if (!cal)
    throw new Error(
      `CalendarDay not found for ${day.toISOString().slice(0, 10)}`
    );
  const dayType = cal.dayType;

  // membros ativos
  const members = await prisma.scaleMember.findMany({
    where: { scaleId, isActive: true, militar: { ativo: true } },
    include: { militar: { select: { id: true, antiguidade: true } } },
  });

  const candidateIds = members.map((m) => m.militarId);
  if (!candidateIds.length) throw new Error("No active members in this scale.");

  // restrições (globais + desta escala)
  const restrictions = await prisma.restriction.findMany({
    where: {
      militarId: { in: candidateIds },
      OR: [{ scaleId: null }, { scaleId }],
    },
    select: { militarId: true, startDate: true, endDate: true, indefinite: true },
  });

  const restrictedSet = new Set<string>();
  for (const r of restrictions) {
    if (r.indefinite) {
      restrictedSet.add(r.militarId);
      continue;
    }
    const startOk = !r.startDate || r.startDate <= day;
    const endOk = !r.endDate || r.endDate >= day;
    if (startOk && endOk) restrictedSet.add(r.militarId);
  }

  // BLOQUEIO CIMA no dia (upperAssignment)
  const upperToday = await prisma.upperAssignment.findMany({
    where: { date: day, militarId: { in: candidateIds } },
    select: { militarId: true },
  });
  const blockedUpperToday = new Set(upperToday.map((u) => u.militarId));

  // DESCANSO GLOBAL: conta BAIXO + CIMA (upperAssignment), qualquer escala
  const lookbackDays = 365;
  const since = addDays(day, -lookbackDays);

  // 1) dutyEvent BAIXO/CIMA existentes
  const recentEvents = await prisma.dutyEvent.findMany({
    where: {
      kind: { in: ["BAIXO", "CIMA"] as DutyKind[] },
      date: { gte: since, lt: day },
      OR: [
        { executorId: { in: candidateIds } },
        { titularId: { in: candidateIds } },
      ],
    },
    select: { date: true, kind: true, origin: true, titularId: true, executorId: true },
    orderBy: { date: "desc" },
  });

  // 2) upperAssignment (mesmo que não tenha materializado em dutyEvent)
  const recentUpper = await prisma.upperAssignment.findMany({
    where: { date: { gte: since, lt: day }, militarId: { in: candidateIds } },
    select: { date: true, militarId: true },
    orderBy: { date: "desc" },
  });

  const lastDuty = new Map<string, Date>();

  // aplica BAIXO/CIMA via DutyEvent
  for (const ev of recentEvents) {
    const who =
      ev.kind === "CIMA" ? ev.executorId : creditedMilitarId(ev);
    if (!lastDuty.has(who)) lastDuty.set(who, ev.date);
  }

  // aplica CIMA via UpperAssignment (se for mais recente)
  for (const ua of recentUpper) {
    const prev = lastDuty.get(ua.militarId);
    if (!prev || ua.date > prev) lastDuty.set(ua.militarId, ua.date);
  }

  // FOLGA por tipo (PRETA/VERMELHA) dentro desta escala
  const windowStart = addDays(day, -180);

  const calendar = await prisma.calendarDay.findMany({
    where: { date: { gte: windowStart, lt: day } },
    orderBy: { date: "asc" },
    select: { date: true, dayType: true },
  });

  const windowDuties = await prisma.dutyEvent.findMany({
    where: { kind: "BAIXO", scaleId, date: { gte: windowStart, lt: day } },
    select: { date: true, dayType: true, origin: true, titularId: true, executorId: true },
  });

  const lastByType = new Map<string, { PRETA: Date | null; VERMELHA: Date | null }>();
  for (const m of members) lastByType.set(m.militarId, { PRETA: null, VERMELHA: null });

  for (const ev of windowDuties) {
    const who = creditedMilitarId(ev);
    const entry = lastByType.get(who);
    if (!entry) continue;

    const t = ev.dayType;
    const prev = entry[t];
    if (!prev || ev.date > prev) entry[t] = ev.date;
  }

  function folgaCount(militarId: string, t: DayType) {
    const last = lastByType.get(militarId)?.[t] ?? null;
    let c = 0;
    for (const d of calendar) {
      if (d.dayType !== t) continue;
      if (!last || d.date > last) c += 1;
    }
    return c;
  }

  const eligible = members
    .map((m) => ({
      militarId: m.militarId,
      antiguidade: m.militar.antiguidade,
      competitionMode: m.competitionMode,
      folga: 0,
    }))
    .filter((c) => {
      if (!compAllows(c.competitionMode, dayType)) return false;
      if (restrictedSet.has(c.militarId)) return false;
      if (blockedUpperToday.has(c.militarId)) return false;

      const last = lastDuty.get(c.militarId);
      if (!last) return true;

      const dd = diffDays(day, last);

      if (dd >= requiredDiff) return true;
      if (allowOneDayRest && dd >= requiredDiffWithOverride) return true;

      return false;
    })
    .map((c) => ({
      ...c,
      folga: folgaCount(c.militarId, dayType),
    }))
    .sort((a, b) => {
      if (b.folga !== a.folga) return b.folga - a.folga;
      return b.antiguidade - a.antiguidade;
    });

  if (!eligible.length) {
    // ERRO “controlado” (vai virar 409 na rota)
    throw new Error("NO_ELIGIBLE");
  }

  const chosen = eligible[0];

  const created = await prisma.dutyEvent.create({
    data: {
      date: day,
      scaleId,
      kind: "BAIXO",
      origin: "AUTO",
      dayType,
      titularId: null,
      executorId: chosen.militarId,
      createdById: opts.createdById ?? null,
      note: "Gerado automaticamente",
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: opts.createdById ?? null,
      action: "ENGINE_GENERATE",
      entity: "DutyEvent",
      entityId: created.id,
      metaJson: JSON.stringify({
        scaleId,
        day: day.toISOString().slice(0, 10),
        chosen: chosen.militarId,
        dayType,
        minOffDays,
        requiredDiff,
        allowOneDayRest,
      }),
    },
  });

  return created;
}
