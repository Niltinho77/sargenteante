// src/lib/grid/buildGrid.ts
import { prisma } from "@/lib/prisma";
import type { CompetitionMode, DayType, Prisma } from "@prisma/client";

type GridDay = {
  date: string; // YYYY-MM-DD
  dayType: DayType;
  label?: string | null;
};

type CellFlags = {
  isBaixo: boolean;       // serviço escala de baixo (zera folga)
  isCima: boolean;        // bloqueio escala de cima (não zera)
  isSwap: boolean;        // troca
  isManual: boolean;      // lançado manualmente
  restricted: boolean;    // restrição ativa no dia
};

type GridCell = {
  folga: number;
  flags: CellFlags;
  note?: string | null;
  // para tooltip
  executorId?: string;
  titularId?: string | null;
};

type GridMilitar = {
  id: string;
  nome: string;
  postoGrad?: string | null;
  antiguidade: number;
  competitionMode: CompetitionMode;
  ativo: boolean;
};

export type GridResponse = {
  scale: { id: string; nome: string };
  days: GridDay[];
  militars: GridMilitar[];
  cells: Record<string, Record<string, GridCell>>; // militarId -> day -> cell
};

function normalizeDate(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function inRange(day: Date, start: Date, end: Date): boolean {
  return day >= start && day <= end;
}

function compAllows(mode: CompetitionMode, dayType: DayType): boolean {
  switch (mode) {
    case "NENHUMA":
      return false;
    case "AMBAS":
      return true;
    case "SOMENTE_PRETA":
      return dayType === "PRETA";
    case "SOMENTE_VERMELHA":
      return dayType === "VERMELHA";
    default:
      return false;
  }
}

function creditedId(ev: { origin: string; titularId: string | null; executorId: string }) {
  if (ev.origin === "SWAP" && ev.titularId) return ev.titularId;
  return ev.executorId;
}

export async function buildGrid(scaleId: string, from: Date, to: Date): Promise<GridResponse> {
  const start = normalizeDate(from);
  const end = normalizeDate(to);

  const scale = await prisma.scale.findUnique({
    where: { id: scaleId },
    select: { id: true, nome: true },
  });
  if (!scale) throw new Error("Scale not found.");

  // days
  const calendar = await prisma.calendarDay.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true, dayType: true, label: true },
    orderBy: { date: "asc" },
  });

  const days: GridDay[] = calendar.map((d) => ({
    date: isoDay(d.date),
    dayType: d.dayType,
    label: d.label,
  }));

  // members
  const members = await prisma.scaleMember.findMany({
    where: { scaleId, isActive: true },
    select: {
      competitionMode: true,
      militar: { select: { id: true, nome: true, postoGrad: true, antiguidade: true, ativo: true } },
    },
    orderBy: [{ militar: { nome: "asc" } }],
  });

  const militars: GridMilitar[] = members.map((m) => ({
    id: m.militar.id,
    nome: m.militar.nome,
    postoGrad: m.militar.postoGrad,
    antiguidade: m.militar.antiguidade,
    competitionMode: m.competitionMode,
    ativo: m.militar.ativo,
  }));

  const militarIds = militars.map((m) => m.id);

  // restrictions (global or scale)
  const restrictions = await prisma.restriction.findMany({
    where: { militarId: { in: militarIds }, OR: [{ scaleId: null }, { scaleId }] },
    select: { militarId: true, startDate: true, endDate: true, indefinite: true },
  });

  const restrictionsByMilitar = new Map<
    string,
    Array<{ startDate: Date | null; endDate: Date | null; indefinite: boolean }>
  >();
  for (const r of restrictions) {
    const arr = restrictionsByMilitar.get(r.militarId) ?? [];
    arr.push({ startDate: r.startDate, endDate: r.endDate, indefinite: r.indefinite });
    restrictionsByMilitar.set(r.militarId, arr);
  }

  // duties in range (BAIXO for scale + CIMA global)
  const duties = await prisma.dutyEvent.findMany({
    where: {
      date: { gte: start, lte: end },
      AND: [
        {
          OR: [
            { kind: "BAIXO", scaleId },
            { kind: "CIMA", scaleId: null },
          ],
        },
        {
          OR: [
            { executorId: { in: militarIds } },
            { titularId: { in: militarIds } },
          ],
        },
      ],
    },
    select: {
      date: true,
      kind: true,
      origin: true,
      dayType: true,
      note: true,
      executorId: true,
      titularId: true,
      scaleId: true,
    },
  });

  // index duties by day
  const baixoByDay = new Map<string, Array<typeof duties[number]>>();
  const cimaByDay = new Map<string, Array<typeof duties[number]>>();
  for (const d of duties) {
    const k = isoDay(d.date);
    if (d.kind === "BAIXO") {
      const arr = baixoByDay.get(k) ?? [];
      arr.push(d);
      baixoByDay.set(k, arr);
    } else {
      const arr = cimaByDay.get(k) ?? [];
      arr.push(d);
      cimaByDay.set(k, arr);
    }
  }

  // init cells
  const cells: GridResponse["cells"] = {};
  for (const m of militars) {
    cells[m.id] = {};
    for (const day of days) {
      const rs = restrictionsByMilitar.get(m.id) ?? [];
      const restricted =
        rs.some((r) => {
          if (r.indefinite) return true;
          const startOk = !r.startDate || r.startDate <= new Date(day.date);
          const endOk = !r.endDate || r.endDate >= new Date(day.date);
          return startOk && endOk;
        }) || !m.ativo;

      cells[m.id][day.date] = {
        folga: 0,
        flags: {
          isBaixo: false,
          isCima: false,
          isSwap: false,
          isManual: false,
          restricted,
        },
        note: null,
      };
    }
  }

  // compute folgas across range with a pre-window scan (start-120 to end) to make values correct at range start
  const preStart = normalizeDate(new Date(start));
  preStart.setDate(preStart.getDate() - 120);

  const preCalendar = await prisma.calendarDay.findMany({
    where: { date: { gte: preStart, lte: end } },
    select: { date: true, dayType: true },
    orderBy: { date: "asc" },
  });

  const preBaixo = await prisma.dutyEvent.findMany({
    where: {
      kind: "BAIXO",
      scaleId,
      date: { gte: preStart, lte: end },
      OR: [{ executorId: { in: militarIds } }, { titularId: { in: militarIds } }],
    },
    select: { date: true, origin: true, titularId: true, executorId: true },
  });

  const dutyMap = new Map<string, Set<string>>();
  for (const ev of preBaixo) {
    const id = creditedId(ev);
    const k = isoDay(ev.date);
    const set = dutyMap.get(k) ?? new Set<string>();
    set.add(id);
    dutyMap.set(k, set);
  }

  const folgaState = new Map<string, { preta: number; vermelha: number }>();
  for (const id of militarIds) folgaState.set(id, { preta: 0, vermelha: 0 });

  for (const d of preCalendar) {
    const k = isoDay(d.date);
    const didDutySet = dutyMap.get(k);

    for (const id of militarIds) {
      const st = folgaState.get(id)!;
      const didDuty = didDutySet?.has(id) ?? false;

      if (d.dayType === "PRETA") st.preta = didDuty ? 0 : st.preta + 1;
      else st.vermelha = didDuty ? 0 : st.vermelha + 1;

      if (k >= isoDay(start) && k <= isoDay(end)) {
        const dayType = d.dayType;
        const val = dayType === "PRETA" ? st.preta : st.vermelha;
        cells[id][k].folga = val;
      }
    }
  }

  // mark flags (BAIXO/CIMA/TROCA/MANUAL) for visible range
  for (const day of days) {
    const k = day.date;

    const baixo = baixoByDay.get(k) ?? [];
    for (const ev of baixo) {
      const credited = creditedId(ev);
      if (!cells[credited]?.[k]) continue;
      cells[credited][k].flags.isBaixo = true;
      cells[credited][k].flags.isSwap = ev.origin === "SWAP";
      cells[credited][k].flags.isManual = ev.origin === "MANUAL";
      cells[credited][k].note = ev.note ?? null;
      cells[credited][k].executorId = ev.executorId;
      cells[credited][k].titularId = ev.titularId;
      // folga já é 0 nesse dia (porque state zerou); mantém.
    }

    const cima = cimaByDay.get(k) ?? [];
    for (const ev of cima) {
      const id = ev.executorId;
      if (!cells[id]?.[k]) continue;
      cells[id][k].flags.isCima = true;
      // não altera folga
    }
  }

  return { scale, days, militars, cells };
}
