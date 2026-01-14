// src/lib/engine/generateTx.ts
import type {
  Prisma,
  DutyEvent,
  DayType,
  CompetitionMode,
  DutyOrigin,
  RestrictionAppLiesTo,
  RestrictionType,
} from "@prisma/client";

/**
 * Garantias deste motor:
 * ✅ (1) Funções sem requirement no dia => qty = 0 (não gera)
 * ✅ (2) Total do dia = soma dos qty cadastrados (sem default 1)
 * ✅ (3) UpperAssignment só BLOQUEIA candidato no dia (não cria vaga)
 * ✅ (4) Idempotência por (função, slot): cria apenas slots faltantes
 * ✅ (5) usedToday bloqueia executor e, em caso de SWAP, também o titularId
 * ✅ (6) Debug detalhado quando faltar candidato elegível
 * ✅ (7) Se não houver nada para gerar (qty=0 em tudo), lança NOTHING_TO_GENERATE (não é “erro”)
 *
 * ⚠️ CRÍTICO:
 * - NUNCA use toISOString() para chave de dia. Sempre use isoDayLocal() abaixo.
 */

export type GenerateOpts = {
  allowOneDayRestOverride?: boolean;
  createdById?: string;
};

// -----------------------------
// Helpers 100% LOCAL (sem UTC)
// -----------------------------
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** YYYY-MM-DD baseado no calendário LOCAL (não UTC). */
function isoDayLocal(d: Date) {
  const x = normalizeDate(d);
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const dd = x.getDate();
  return `${y}-${pad2(m)}-${pad2(dd)}`;
}

function addDays(d: Date, n: number) {
  const x = normalizeDate(d);
  x.setDate(x.getDate() + n);
  return normalizeDate(x);
}

function sameDay(a: Date, b: Date) {
  return normalizeDate(a).getTime() === normalizeDate(b).getTime();
}

function diffDays(a: Date, b: Date) {
  const A = normalizeDate(a).getTime();
  const B = normalizeDate(b).getTime();
  return Math.floor((A - B) / 86400000);
}

// -----------------------------
// Regras de concorrência / restrição
// -----------------------------
function compAllows(mode: CompetitionMode, dayType: DayType) {
  if (mode === "NENHUMA") return false;
  if (mode === "AMBAS") return true;
  if (mode === "SOMENTE_PRETA") return dayType === "PRETA";
  if (mode === "SOMENTE_VERMELHA") return dayType === "VERMELHA";
  return false;
}

function restrictionBlocksDayType(
  appliesTo: RestrictionAppLiesTo | null | undefined,
  dayType: DayType
) {
  const a = appliesTo ?? "AMBAS";
  if (a === "AMBAS") return true;
  if (a === "PRETA") return dayType === "PRETA";
  if (a === "VERMELHA") return dayType === "VERMELHA";
  return true;
}

/**
 * SWAP conta pro TITULAR (quem era "o da vez").
 * AUTO/MANUAL contam pro executor.
 */
function creditedMilitarId(ev: {
  origin: DutyOrigin;
  titularId: string | null;
  executorId: string;
}) {
  if (ev.origin === "SWAP" && ev.titularId) return ev.titularId;
  return ev.executorId;
}

type Candidate = {
  militarId: string;
  antiguidade: number;
  competitionMode: CompetitionMode;
  folgaInicialPreta: number;
  folgaInicialVermelha: number;
};



type RestrLite = {
  militarId: string;
  startDate: Date | null;
  endDate: Date | null;
  indefinite: boolean;
  appliesTo: RestrictionAppLiesTo;
  type: RestrictionType;
};

type ScaleFnLite = {
  id: string;
  nome: string;
  isActive: boolean;
};

export async function generateForDayTx(
  tx: Prisma.TransactionClient,
  scaleId: string,
  date: Date,
  opts?: GenerateOpts
): Promise<DutyEvent> {
  const day = normalizeDate(date);

  // config geral do motor
  const cfg = await tx.engineConfig.findFirst();
  const minRestDays = cfg?.minRestDays ?? 2;
  const allowOneDayRest =
    opts?.allowOneDayRestOverride ?? (cfg?.allowOneDayRest ?? false);

  const requiredDiff = minRestDays + 1; // minRestDays=2 => diff>=3
  const requiredDiffWithOverride = 2; // exceção => diff>=2

  // dayType
  const cal = await tx.calendarDay.findUnique({ where: { date: day } });
  if (!cal) throw new Error(`CalendarDay not found for ${isoDayLocal(day)}.`);
  const dayType = cal.dayType;

  // membros ativos
  const members = await tx.scaleMember.findMany({
    where: { scaleId, isActive: true, militar: { ativo: true } },
include: {
  militar: {
    select: {
      id: true,
      antiguidade: true,
      folgaInicialPreta: true,
      folgaInicialVermelha: true,
    },
  },
},
  });

  const candidates: Candidate[] = members.map((m) => ({
  militarId: m.militarId,
  antiguidade: m.militar.antiguidade,
  competitionMode: m.competitionMode,
  folgaInicialPreta: m.militar.folgaInicialPreta ?? 0,
  folgaInicialVermelha: m.militar.folgaInicialVermelha ?? 0,
}));


  const candidateIds = candidates.map((c) => c.militarId);
  if (!candidateIds.length) throw new Error("No active members in this scale.");

  // funções ativas (se não tiver nenhuma => modo 1 vaga)
  const scaleFunctions = (await tx.scaleFunction.findMany({
    where: { scaleId, isActive: true },
    select: { id: true, nome: true, isActive: true },
    orderBy: { nome: "asc" },
  })) as ScaleFnLite[];

  // ============================================================
  // MODO 1: sem funções => 1 vaga (comportamento antigo)
  // ============================================================
  if (!scaleFunctions.length) {
    // idempotência antiga: se já existe BAIXO nesse dia, retorna
    const existingAny = await tx.dutyEvent.findFirst({
      where: { date: day, scaleId, kind: "BAIXO" },
      orderBy: { createdAt: "asc" },
    });
    if (existingAny) return existingAny;

    // restrições (globais + específicas)
    const restrictions = (await tx.restriction.findMany({
      where: {
        militarId: { in: candidateIds },
        OR: [{ scaleId: null }, { scaleId }],
      },
      select: {
        militarId: true,
        startDate: true,
        endDate: true,
        indefinite: true,
        appliesTo: true,
        type: true,
      },
    })) as RestrLite[];

    // index por militar (evita filter repetido)
    const restByMil = new Map<string, RestrLite[]>();
    for (const r of restrictions) {
      if (!restByMil.has(r.militarId)) restByMil.set(r.militarId, []);
      restByMil.get(r.militarId)!.push(r);
    }

    function isRestricted(militarId: string): boolean {
      const rs = restByMil.get(militarId) ?? [];
      for (const r of rs) {
        if (!restrictionBlocksDayType(r.appliesTo, dayType)) continue;
        if (r.indefinite) return true;

        const startOk = !r.startDate || normalizeDate(r.startDate) <= day;
        const endOk = !r.endDate || normalizeDate(r.endDate) >= day;
        if (startOk && endOk) return true;

        // FERIAS_PREJ bloqueia também o dia seguinte
        if (r.type === "FERIAS_PREJ" && r.endDate) {
          const restDay = addDays(r.endDate, 1);
          if (sameDay(day, restDay)) return true;
        }
      }
      return false;
    }

    // CIMA no mesmo dia bloqueia BAIXO
    const upperSameDay = await tx.upperAssignment.findMany({
      where: { date: day, militarId: { in: candidateIds } },
      select: { militarId: true },
    });
    const upperSameDaySet = new Set(upperSameDay.map((x) => x.militarId));

    // descanso global (BAIXO + CIMA)
    const since = addDays(day, -365);

    const baixoGlobal = await tx.dutyEvent.findMany({
      where: {
        kind: "BAIXO",
        date: { gte: since, lt: day },
        OR: [{ executorId: { in: candidateIds } }, { titularId: { in: candidateIds } }],
      },
      select: { date: true, origin: true, titularId: true, executorId: true },
      orderBy: { date: "desc" },
    });

    const cimaGlobal = await tx.upperAssignment.findMany({
      where: { date: { gte: since, lt: day }, militarId: { in: candidateIds } },
      select: { date: true, militarId: true },
      orderBy: { date: "desc" },
    });

    const lastDutyByMilitar = new Map<string, Date>();

    for (const ev of baixoGlobal) {
      const credited = creditedMilitarId(ev);
      if (!lastDutyByMilitar.has(credited)) {
        lastDutyByMilitar.set(credited, normalizeDate(ev.date));
      }
    }

    for (const ua of cimaGlobal) {
      const prev = lastDutyByMilitar.get(ua.militarId);
      const uaDay = normalizeDate(ua.date);
      if (!prev || uaDay > prev) lastDutyByMilitar.set(ua.militarId, uaDay);
    }

    function isRestOk(militarId: string) {
      const last = lastDutyByMilitar.get(militarId);
      if (!last) return true;
      const dd = diffDays(day, last);
      if (dd >= requiredDiff) return true;
      if (allowOneDayRest && dd >= requiredDiffWithOverride) return true;
      return false;
    }

    // fairness (streak) dentro da escala
    const windowStart = addDays(day, -120);

    const calendarWindow = await tx.calendarDay.findMany({
      where: { date: { gte: windowStart, lt: day } },
      select: { date: true, dayType: true },
      orderBy: { date: "asc" },
    });

    const baixoThisScale = await tx.dutyEvent.findMany({
      where: {
        kind: "BAIXO",
        scaleId,
        date: { gte: windowStart, lt: day },
        OR: [{ executorId: { in: candidateIds } }, { titularId: { in: candidateIds } }],
      },
      select: { date: true, origin: true, titularId: true, executorId: true },
    });

    const baixoMap = new Map<string, Set<string>>();
    for (const ev of baixoThisScale) {
      const credited = creditedMilitarId(ev);
      const k = isoDayLocal(ev.date);
      if (!baixoMap.has(k)) baixoMap.set(k, new Set());
      baixoMap.get(k)!.add(credited);
    }

    const folga = new Map<string, { preta: number; vermelha: number }>();

    for (const c of candidates) {
      folga.set(c.militarId, {
        preta: c.folgaInicialPreta ?? 0,
        vermelha: c.folgaInicialVermelha ?? 0,
      });
    }

    for (const d of calendarWindow) {
      const k = isoDayLocal(d.date);
      for (const c of candidates) {
        const f = folga.get(c.militarId)!;
        const didDuty = baixoMap.get(k)?.has(c.militarId) ?? false;

        if (d.dayType === "PRETA") f.preta = didDuty ? 0 : f.preta + 1;
        else f.vermelha = didDuty ? 0 : f.vermelha + 1;
      }
    }

    function scoreCompare(a: Candidate, b: Candidate) {
      const fa = folga.get(a.militarId)!;
      const fb = folga.get(b.militarId)!;

      const va = dayType === "PRETA" ? fa.preta : fa.vermelha;
      const vb = dayType === "PRETA" ? fb.preta : fb.vermelha;

      if (vb !== va) return vb - va;
      return b.antiguidade - a.antiguidade; // mais moderno tem antiguidade maior
    }

    const eligible = candidates.filter((c) => {
      if (!compAllows(c.competitionMode, dayType)) return false;
      if (upperSameDaySet.has(c.militarId)) return false;
      if (isRestricted(c.militarId)) return false;
      if (!isRestOk(c.militarId)) return false;
      return true;
    });


    if (!eligible.length) {
      throw new Error("No eligible candidates (rest/restrictions/upper blocks).");
    }

    eligible.sort(scoreCompare);
    const chosen = eligible[0];

    return tx.dutyEvent.create({
      data: {
        date: day,
        scaleId,
        kind: "BAIXO",
        origin: "AUTO",
        dayType,
        titularId: null,
        executorId: chosen.militarId,
        createdById: opts?.createdById ?? null,
        note: "Gerado automaticamente",
        scaleFunctionId: null,
        slot: null,
      },
    });
  }

  // ============================================================
  // MODO 2: com funções => N vagas por função (qty por dia)
  // ============================================================

    // ============================================================
  // MODO 2: com funções => N vagas por função (qty por dia)
  // ============================================================

  // 1) duties existentes no dia (snapshot)
  const existingTodayRaw = await tx.dutyEvent.findMany({
    where: { date: day, scaleId, kind: "BAIXO" },
    select: {
      id: true,
      origin: true,
      executorId: true,
      scaleFunctionId: true,
      slot: true,
      createdAt: true,
      titularId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 2) requirements do dia (qty por função)
  const dayStart = day;
  const dayEnd = addDays(dayStart, 1);

  const reqRows = await tx.scaleFunctionRequirement.findMany({
    where: {
      scaleFunctionId: { in: scaleFunctions.map((f) => f.id) },
      date: { gte: dayStart, lt: dayEnd },
    },
    select: { scaleFunctionId: true, qty: true },
  });

  const qtyByFn = new Map<string, number>();
  for (const r of reqRows) {
    qtyByFn.set(r.scaleFunctionId, Math.max(0, Math.floor(r.qty)));
  }

  const neededTotal = scaleFunctions.reduce(
    (acc, f) => acc + (qtyByFn.get(f.id) ?? 0),
    0
  );

  // ------------------------------------------------------------
  // ✅ CAPACITY SYNC (o que estava faltando de verdade)
  // - remove SOMENTE AUTO excedente
  // - garante que reduzir qty realmente reduz escala
  // ------------------------------------------------------------
  const toDeleteIds: string[] = [];

  for (const ev of existingTodayRaw) {
    if (ev.origin !== "AUTO") continue;
    if (!ev.scaleFunctionId) continue;
    if (typeof ev.slot !== "number") continue;

    const qty = qtyByFn.get(ev.scaleFunctionId) ?? 0;

    // qty=0 => remove todos slots AUTO daquela função no dia
    // qty>0 => remove apenas slots acima da capacidade
    if (qty <= 0 || ev.slot > qty) {
      toDeleteIds.push(ev.id);
    }
  }

  if (toDeleteIds.length) {
    await tx.dutyEvent.deleteMany({ where: { id: { in: toDeleteIds } } });
  }

  // ✅ recarrega depois do sync (isso é o que vale pra idempotência/usedToday)
  const existingToday = await tx.dutyEvent.findMany({
    where: { date: day, scaleId, kind: "BAIXO" },
    select: {
      id: true,
      origin: true,
      executorId: true,
      scaleFunctionId: true,
      slot: true,
      createdAt: true,
      titularId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // ✅ se não tem demanda do dia, retorna algo existente ou lança NOTHING_TO_GENERATE
  if (neededTotal <= 0) {
    const any = existingToday[0];
    if (any) return any as any;

    const err: any = new Error("NOTHING_TO_GENERATE");
    err.code = "NOTHING_TO_GENERATE";
    err.meta = { day: isoDayLocal(day), scaleId, neededTotal: 0 };
    throw err;
  }



  // 3) opt-outs por função
  const optOutRows = await tx.scaleFunctionOptOut.findMany({
    where: {
      scaleFunctionId: { in: scaleFunctions.map((f) => f.id) },
      militarId: { in: candidateIds },
    },
    select: { scaleFunctionId: true, militarId: true },
  });
  const optOutSet = new Set(optOutRows.map((r) => `${r.scaleFunctionId}:${r.militarId}`));

  // 4) restrições (globais + específicas)
  const restrictions = (await tx.restriction.findMany({
    where: {
      militarId: { in: candidateIds },
      OR: [{ scaleId: null }, { scaleId }],
    },
    select: {
      militarId: true,
      startDate: true,
      endDate: true,
      indefinite: true,
      appliesTo: true,
      type: true,
    },
  })) as RestrLite[];

  const restByMil = new Map<string, RestrLite[]>();
  for (const r of restrictions) {
    if (!restByMil.has(r.militarId)) restByMil.set(r.militarId, []);
    restByMil.get(r.militarId)!.push(r);
  }

  function isRestricted(militarId: string): boolean {
    const rs = restByMil.get(militarId) ?? [];
    for (const r of rs) {
      if (!restrictionBlocksDayType(r.appliesTo, dayType)) continue;
      if (r.indefinite) return true;

      const startOk = !r.startDate || normalizeDate(r.startDate) <= day;
      const endOk = !r.endDate || normalizeDate(r.endDate) >= day;
      if (startOk && endOk) return true;

      if (r.type === "FERIAS_PREJ" && r.endDate) {
        const restDay = addDays(r.endDate, 1);
        if (sameDay(day, restDay)) return true;
      }
    }
    return false;
  }

  // 5) CIMA do mesmo dia bloqueia BAIXO
  const upperSameDay = await tx.upperAssignment.findMany({
    where: { date: day, militarId: { in: candidateIds } },
    select: { militarId: true },
  });
  const upperSameDaySet = new Set(upperSameDay.map((x) => x.militarId));

  // 6) descanso global (BAIXO + CIMA)
  const since = addDays(day, -365);

  const baixoGlobal = await tx.dutyEvent.findMany({
    where: {
      kind: "BAIXO",
      date: { gte: since, lt: day },
      OR: [{ executorId: { in: candidateIds } }, { titularId: { in: candidateIds } }],
    },
    select: { date: true, origin: true, titularId: true, executorId: true },
    orderBy: { date: "desc" },
  });

  const cimaGlobal = await tx.upperAssignment.findMany({
    where: { date: { gte: since, lt: day }, militarId: { in: candidateIds } },
    select: { date: true, militarId: true },
    orderBy: { date: "desc" },
  });

  const lastDutyByMilitar = new Map<string, Date>();

  for (const ev of baixoGlobal) {
    const credited = creditedMilitarId(ev);
    if (!lastDutyByMilitar.has(credited)) {
      lastDutyByMilitar.set(credited, normalizeDate(ev.date));
    }
  }

  for (const ua of cimaGlobal) {
    const prev = lastDutyByMilitar.get(ua.militarId);
    const uaDay = normalizeDate(ua.date);
    if (!prev || uaDay > prev) lastDutyByMilitar.set(ua.militarId, uaDay);
  }

  function isRestOk(militarId: string) {
    const last = lastDutyByMilitar.get(militarId);
    if (!last) return true;
    const dd = diffDays(day, last);
    if (dd >= requiredDiff) return true;
    if (allowOneDayRest && dd >= requiredDiffWithOverride) return true;
    return false;
  }

  // 7) fairness (streak) dentro desta escala
  const windowStart = addDays(day, -120);

  const calendarWindow = await tx.calendarDay.findMany({
    where: { date: { gte: windowStart, lt: day } },
    select: { date: true, dayType: true },
    orderBy: { date: "asc" },
  });

  const baixoThisScale = await tx.dutyEvent.findMany({
    where: {
      kind: "BAIXO",
      scaleId,
      date: { gte: windowStart, lt: day },
      OR: [{ executorId: { in: candidateIds } }, { titularId: { in: candidateIds } }],
    },
    select: { date: true, origin: true, titularId: true, executorId: true },
  });

  const baixoMap = new Map<string, Set<string>>();
  for (const ev of baixoThisScale) {
    const credited = creditedMilitarId(ev);
    const k = isoDayLocal(ev.date);
    if (!baixoMap.has(k)) baixoMap.set(k, new Set());
    baixoMap.get(k)!.add(credited);
  }

  const folga = new Map<string, { preta: number; vermelha: number }>();

    for (const c of candidates) {
      folga.set(c.militarId, {
        preta: c.folgaInicialPreta ?? 0,
        vermelha: c.folgaInicialVermelha ?? 0,
      });
    }

  for (const d of calendarWindow) {
  const k = isoDayLocal(d.date);

  for (const c of candidates) {

    // ✅ antes de existir no sistema, não conta folga

    const f = folga.get(c.militarId)!;
    const didDuty = baixoMap.get(k)?.has(c.militarId) ?? false;

    if (d.dayType === "PRETA") f.preta = didDuty ? 0 : f.preta + 1;
    else f.vermelha = didDuty ? 0 : f.vermelha + 1;
  }
}


  function scoreCompare(a: Candidate, b: Candidate) {
    const fa = folga.get(a.militarId)!;
    const fb = folga.get(b.militarId)!;

    const va = dayType === "PRETA" ? fa.preta : fa.vermelha;
    const vb = dayType === "PRETA" ? fb.preta : fb.vermelha;

    if (vb !== va) return vb - va;
    return b.antiguidade - a.antiguidade;
  }

  // 8) idempotência + usedToday
  const existingSlotKeys = new Set<string>();
  const usedToday = new Set<string>();

  for (const ev of existingToday) {
  if (ev.executorId) usedToday.add(ev.executorId);
  if (ev.origin === "SWAP" && ev.titularId) usedToday.add(ev.titularId);

  if (ev.scaleFunctionId && typeof ev.slot === "number") {
    existingSlotKeys.add(`${ev.scaleFunctionId}:${ev.slot}`);
  }
}


  // 9) debug
  type IneligReason =
    | "USED_TODAY"
    | "COMP_MODE"
    | "UPPER_SAME_DAY"
    | "RESTRICTION"
    | "REST"
    | "OPTOUT";

  function reasonsFor(fnId: string, c: Candidate): IneligReason[] {
    const reasons: IneligReason[] = [];
    if (usedToday.has(c.militarId)) reasons.push("USED_TODAY");
    if (!compAllows(c.competitionMode, dayType)) reasons.push("COMP_MODE");
    if (upperSameDaySet.has(c.militarId)) reasons.push("UPPER_SAME_DAY");
    if (isRestricted(c.militarId)) reasons.push("RESTRICTION");
    if (!isRestOk(c.militarId)) reasons.push("REST");
    if (optOutSet.has(`${fnId}:${c.militarId}`)) reasons.push("OPTOUT");
    return reasons;
  }

  const created: DutyEvent[] = [];

  // 10) geração por função/slot
  for (const fn of scaleFunctions) {
    const qty = qtyByFn.get(fn.id) ?? 0;
    if (qty <= 0) continue;

    for (let slot = 1; slot <= qty; slot++) {
      const slotKey = `${fn.id}:${slot}`;

      // idempotência: slot já existe => pula
      if (existingSlotKeys.has(slotKey)) continue;

      const eligible = candidates.filter((c) => {
        if (usedToday.has(c.militarId)) return false;
        if (!compAllows(c.competitionMode, dayType)) return false;
        if (upperSameDaySet.has(c.militarId)) return false;
        if (isRestricted(c.militarId)) return false;
        if (!isRestOk(c.militarId)) return false;
        if (optOutSet.has(`${fn.id}:${c.militarId}`)) return false;
        return true;
      });

      if (!eligible.length) {
        const debugCandidates = candidates.map((c) => ({
          militarId: c.militarId,
          antiguidade: c.antiguidade,
          competitionMode: c.competitionMode,
          reasons: reasonsFor(fn.id, c),
          lastDuty: lastDutyByMilitar.get(c.militarId)
            ? isoDayLocal(lastDutyByMilitar.get(c.militarId)!)
            : null,
        }));

        const err: any = new Error(
          `No eligible candidates for "${fn.nome}" (slot ${slot}/${qty}). ` +
            `Candidates=${candidateIds.length}, NeededTotal=${neededTotal}, UsedToday=${usedToday.size}.`
        );
        err.code = "NO_ELIGIBLE_SLOT";
        err.meta = {
          day: isoDayLocal(day),
          dayType,
          scaleId,
          functionId: fn.id,
          functionName: fn.nome,
          slot,
          qty,
          candidatesCount: candidateIds.length,
          neededTotal,
          usedToday: Array.from(usedToday),
          debugCandidates,
        };
        throw err;
      }

      const scored = eligible.map((c) => {
      const f = folga.get(c.militarId)!;
      const v = dayType === "PRETA" ? f.preta : f.vermelha;
      return { militarId: c.militarId, folga: v, preta: f.preta, vermelha: f.vermelha, antiguidade: c.antiguidade };
    });

    scored.sort((a, b) => (b.folga - a.folga) || (b.antiguidade - a.antiguidade));

    console.log("SCORE DEBUG", {
      day: isoDayLocal(day),
      dayType,
      top5: scored.slice(0, 5),
    });

      const pickIds = {
      dinho: "COLE_ID_DINHO",
      yan: "COLE_ID_YAN",
    };

    for (const [label, id] of Object.entries(pickIds)) {
      const c = eligible.find((x) => x.militarId === id) ?? candidates.find((x) => x.militarId === id);
      if (!c) continue;

      const f = folga.get(c.militarId) ?? { preta: -1, vermelha: -1 };
      const v = dayType === "PRETA" ? f.preta : f.vermelha;

      console.log("🧾 COMPARE", {
        day: isoDayLocal(day),
        dayType,
        functionName: fn.nome,
        slot,
        label,
        militarId: c.militarId,
        folga: v,
        preta: f.preta,
        vermelha: f.vermelha,
        antiguidade: c.antiguidade,
        inEligible: eligible.some((x) => x.militarId === id),
        reasons: reasonsFor(fn.id, c),
      });
    }


      eligible.sort(scoreCompare);

      const chosen = eligible[0];
      const chosenF = folga.get(chosen.militarId)!;
      const chosenV = dayType === "PRETA" ? chosenF.preta : chosenF.vermelha;

      console.log("✅ CHOSEN", {
        day: isoDayLocal(day),
        dayType,
        functionName: fn.nome,
        slot,
        chosen: {
          militarId: chosen.militarId,
          folga: chosenV,
          preta: chosenF.preta,
          vermelha: chosenF.vermelha,
          antiguidade: chosen.antiguidade,
        },
      });


      const ev = await tx.dutyEvent.create({
        data: {
          date: day,
          scaleId,
          kind: "BAIXO",
          origin: "AUTO",
          dayType,
          titularId: null,
          executorId: chosen.militarId,
          createdById: opts?.createdById ?? null,
          note: `Gerado automaticamente — ${fn.nome} (slot ${slot})`,
          scaleFunctionId: fn.id,
          slot,
        },
      });

      created.push(ev);
      usedToday.add(chosen.militarId);
      existingSlotKeys.add(slotKey);
    }
  }

  // 11) se nada foi criado
  if (!created.length) {
    const any = existingToday[0];
    if (any) return any as any;

    const err: any = new Error("NO_DUTIES_CREATED_UNEXPECTED");
    err.code = "NO_DUTIES_CREATED_UNEXPECTED";
    err.meta = { day: isoDayLocal(day), dayType, scaleId, neededTotal };
    throw err;
  }

  return created[0];
}
