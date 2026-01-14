// src/app/api/scales/[scaleId]/generate/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, isoDay, normalizeLocal } from "@/lib/date";
import { generateForDayTx } from "@/lib/engine/generateTx";
import type { DayType, DutyEvent, Prisma } from "@prisma/client";

type UpperRow = { upperFunctionId: string; militarId: string | null };

/**
 * ✅ NOVO: modo de geração
 * - DAY_ONLY: gera somente o dia solicitado
 * - HORIZON: recalcula o horizonte (engineConfig.recalcHorizonDays)
 */
type GenerateMode = "DAY_ONLY" | "HORIZON";

type Body = {
  date?: string; // YYYY-MM-DD
  createdById?: string;
  allowOneDayRestOverride?: boolean;
  upperAssignments?: UpperRow[];
  mode?: GenerateMode; // ✅ novo
};

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

// soma dias mantendo "meia-noite local"
function addDaysLocal(d: Date, n: number) {
  const x = normalizeLocal(d);
  x.setDate(x.getDate() + n);
  return normalizeLocal(x);
}

function sameDay(a: Date, b: Date) {
  return normalizeLocal(a).getTime() === normalizeLocal(b).getTime();
}

function diffDays(a: Date, b: Date) {
  const A = normalizeLocal(a).getTime();
  const B = normalizeLocal(b).getTime();
  return Math.floor((A - B) / 86400000);
}

function restrictionBlocksDayType(
  appliesTo: "AMBAS" | "PRETA" | "VERMELHA" | null | undefined,
  dayType: DayType
) {
  const a = appliesTo ?? "AMBAS";
  if (a === "AMBAS") return true;
  if (a === "PRETA") return dayType === "PRETA";
  if (a === "VERMELHA") return dayType === "VERMELHA";
  return true;
}

function isActiveRestriction(
  r: { startDate: Date | null; endDate: Date | null; indefinite: boolean },
  day: Date
) {
  if (r.indefinite) return true;
  const startOk = !r.startDate || normalizeLocal(r.startDate) <= day;
  const endOk = !r.endDate || normalizeLocal(r.endDate) >= day;
  return startOk && endOk;
}

function isPostVacationRestDay(
  r: { type?: string | null; endDate: Date | null },
  day: Date
) {
  if (r.type !== "FERIAS_PREJ") return false;
  if (!r.endDate) return false;
  const restDay = addDaysLocal(r.endDate, 1);
  return sameDay(day, restDay);
}

async function validateUpperAssignments(args: {
  day: Date;
  dayType: DayType;
  scaleId: string;
  allowOneDayRestOverride?: boolean;
  rows: UpperRow[];
}) {
  const { day, dayType, scaleId, allowOneDayRestOverride, rows } = args;

  const cleaned = rows.filter(
    (r) =>
      r &&
      typeof r.upperFunctionId === "string" &&
      r.upperFunctionId.trim().length > 0
  );

  const upperIds = Array.from(new Set(cleaned.map((r) => r.upperFunctionId)));
  if (!upperIds.length) return { ok: true as const, rows: [] as UpperRow[] };

  const existingUFs = await prisma.upperFunction.findMany({
    where: { id: { in: upperIds } },
    select: { id: true },
  });

  const allowedUF = new Set(existingUFs.map((x) => x.id));
  const filtered = cleaned.filter((r) => allowedUF.has(r.upperFunctionId));

  const pickedMilitars = filtered
    .map((r) => r.militarId)
    .filter(Boolean) as string[];

  const dup = pickedMilitars.find((id, idx) => pickedMilitars.indexOf(id) !== idx);
  if (dup) {
    return {
      ok: false as const,
      code: "UPPER_INVALID",
      error:
        "O mesmo militar foi selecionado em duas funções da escala de cima no mesmo dia.",
      invalid: [{ militarId: dup, reason: "DUPLICATE_IN_UPPER" }],
    };
  }

  const militarIds = Array.from(new Set(pickedMilitars));
  if (!militarIds.length) return { ok: true as const, rows: filtered as UpperRow[] };

  const config = await prisma.engineConfig.findFirst();
  const minRestDays = config?.minRestDays ?? 2;
  const requiredDiff = minRestDays + 1;
  const allowOneDayRest =
    allowOneDayRestOverride ?? (config?.allowOneDayRest ?? false);
  const requiredDiffWithOverride = 2;

  const since = addDaysLocal(day, -365);

  const restrictions = await prisma.restriction.findMany({
    where: {
      militarId: { in: militarIds },
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
  });

  const restrictedSet = new Set<string>();
  for (const r of restrictions) {
    if (!restrictionBlocksDayType(r.appliesTo as any, dayType)) continue;
    if (isActiveRestriction(r, day) || isPostVacationRestDay(r, day)) {
      restrictedSet.add(r.militarId);
    }
  }

  const recentBaixo = await prisma.dutyEvent.findMany({
    where: {
      kind: "BAIXO",
      date: { gte: since, lt: day },
      OR: [{ executorId: { in: militarIds } }, { titularId: { in: militarIds } }],
    },
    select: { date: true, origin: true, titularId: true, executorId: true },
    orderBy: { date: "desc" },
  });

  const recentUpper = await prisma.upperAssignment.findMany({
    where: { date: { gte: since, lt: day }, militarId: { in: militarIds } },
    select: { date: true, militarId: true },
    orderBy: { date: "desc" },
  });

  const lastDuty = new Map<string, Date>();

  for (const ev of recentBaixo) {
    const who = ev.origin === "SWAP" && ev.titularId ? ev.titularId : ev.executorId;
    if (!lastDuty.has(who)) lastDuty.set(who, normalizeLocal(ev.date));
  }

  for (const ua of recentUpper) {
    const prev = lastDuty.get(ua.militarId);
    const uaDay = normalizeLocal(ua.date);
    if (!prev || uaDay > prev) lastDuty.set(ua.militarId, uaDay);
  }

  const invalid: { upperFunctionId?: string; militarId: string; reason: string }[] =
    [];

  for (const r of filtered) {
    if (!r.militarId) continue;

    if (restrictedSet.has(r.militarId)) {
      invalid.push({
        upperFunctionId: r.upperFunctionId,
        militarId: r.militarId,
        reason: "RESTRICTION",
      });
      continue;
    }

    const last = lastDuty.get(r.militarId);
    if (last) {
      const dd = diffDays(day, last);
      const ok = dd >= requiredDiff || (allowOneDayRest && dd >= requiredDiffWithOverride);
      if (!ok) {
        invalid.push({
          upperFunctionId: r.upperFunctionId,
          militarId: r.militarId,
          reason: "REST",
        });
      }
    }
  }

  if (invalid.length) {
    return {
      ok: false as const,
      code: "UPPER_INVALID",
      error:
        "Não é possível escalar um ou mais militares na escala de cima para este dia (descanso/restrição).",
      invalid,
    };
  }

  return { ok: true as const, rows: filtered as UpperRow[] };
}

async function fetchDayState(scaleId: string, day: Date) {
  const dayISO = isoDay(day);

  const baixoDay = await prisma.dutyEvent.findMany({
    where: { scaleId, kind: "BAIXO", date: day },
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
    },
    orderBy: [{ createdAt: "asc" }],
  });

  const upperDay = await prisma.upperAssignment.findMany({
    where: { date: day },
    select: { upperFunctionId: true, militarId: true },
  });

  return {
    day: dayISO,
    dayDuties: baixoDay.map((d) => ({ ...d, date: isoDay(d.date) })),
    dayUpper: upperDay,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });

  const day = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  // ✅ modo default: gera SOMENTE o dia (não recalcula horizonte)
  const mode: GenerateMode = body.mode ?? "DAY_ONLY";

  const cal = await prisma.calendarDay.findUnique({ where: { date: day } });
  if (!cal) return json(400, { error: `CalendarDay not found for ${isoDay(day)}` });
  const dayType = cal.dayType;

  const rowsRaw = Array.isArray(body.upperAssignments) ? body.upperAssignments : [];
  const validation = await validateUpperAssignments({
    day,
    dayType,
    scaleId,
    allowOneDayRestOverride: body.allowOneDayRestOverride,
    rows: rowsRaw,
  });
  if (!validation.ok) return json(409, validation);

  // ✅ salva escala de cima (fora do recalc)
  const rows = validation.rows;
  if (rows.length) {
    await prisma.$transaction(async (tx) => {
      for (const r of rows) {
        if (!r.militarId) {
          await tx.upperAssignment.deleteMany({
            where: { date: day, upperFunctionId: r.upperFunctionId },
          });
          continue;
        }

        await tx.upperAssignment.upsert({
          where: { date_upperFunctionId: { date: day, upperFunctionId: r.upperFunctionId } },
          update: { militarId: r.militarId, createdById: body.createdById ?? null },
          create: {
            date: day,
            upperFunctionId: r.upperFunctionId,
            militarId: r.militarId,
            createdById: body.createdById ?? null,
          },
        });
      }
    });
  }

  const targetISO = isoDay(day);

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const cfg = await tx.engineConfig.findFirst();
      const defaultHorizon = cfg?.recalcHorizonDays ?? 120;

      /**
       * ✅ MUDANÇA PRINCIPAL:
       * - DAY_ONLY: horizonDays = 1 (só o dia selecionado)
       * - HORIZON: horizonDays = defaultHorizon (ex.: 120)
       */
      const horizonDays = mode === "HORIZON" ? defaultHorizon : 1;

      const from = day;
      const toExclusive = addDaysLocal(day, horizonDays); // [from, toExclusive)

      // 1) calendário do range
      const calDays = await tx.calendarDay.findMany({
        where: { date: { gte: from, lt: toExclusive } },
        select: { date: true },
        orderBy: { date: "asc" },
      });
      const calSet = new Set(calDays.map((c) => isoDay(c.date)));
      if (!calSet.has(targetISO)) throw new Error(`CalendarDay not found for ${targetISO}`);

      // 2) funções ativas
      const activeFns = await tx.scaleFunction.findMany({
        where: { scaleId, isActive: true },
        select: { id: true },
      });
      const activeFnIds = activeFns.map((f) => f.id);

      // 3) requirements do range -> soma por dia
      const neededTotalByDayISO = new Map<string, number>();
      if (activeFnIds.length) {
        const reqRows = await tx.scaleFunctionRequirement.findMany({
          where: {
            scaleFunctionId: { in: activeFnIds },
            date: { gte: from, lt: toExclusive },
          },
          select: { date: true, qty: true },
        });

        for (const r of reqRows) {
          const k = isoDay(r.date);
          const v = Math.max(0, Math.floor(r.qty));
          neededTotalByDayISO.set(k, (neededTotalByDayISO.get(k) ?? 0) + v);
        }
      }

      // ✅ Guard rail 1 (melhorado): se faltar requirement no dia alvo, tenta herdar do último dia anterior
      if (activeFnIds.length) {
        let neededTarget = neededTotalByDayISO.get(targetISO) ?? 0;

        if (neededTarget <= 0) {
          // 1) acha o último requirement anterior (por função) com qty > 0
          const lastByFn = await tx.scaleFunctionRequirement.groupBy({
            by: ["scaleFunctionId"],
            where: {
              scaleFunctionId: { in: activeFnIds },
              date: { lt: day },
              qty: { gt: 0 },
            },
            _max: { date: true },
          });

          const pairs = lastByFn
            .map((r) => ({ scaleFunctionId: r.scaleFunctionId, date: r._max.date }))
            .filter((p) => p.date) as { scaleFunctionId: string; date: Date }[];

          if (pairs.length) {
            // 2) busca os registros exatos (fnId + maxDate)
            const lastReqs = await tx.scaleFunctionRequirement.findMany({
              where: {
                OR: pairs.map((p) => ({
                  scaleFunctionId: p.scaleFunctionId,
                  date: p.date,
                })),
              },
              select: { scaleFunctionId: true, qty: true, date: true },
            });

            // 3) cria/atualiza requirements do DIA ALVO com os qty herdados
            //    (faz upsert para permitir override futuro)
            await Promise.all(
              lastReqs.map((r) =>
                tx.scaleFunctionRequirement.upsert({
                  where: { scaleFunctionId_date: { scaleFunctionId: r.scaleFunctionId, date: day } },
                  update: { qty: r.qty, createdById: body.createdById ?? null },
                  create: {
                    scaleFunctionId: r.scaleFunctionId,
                    date: day,
                    qty: r.qty,
                    createdById: body.createdById ?? null,
                  },
                })
              )
            );

            // 4) recalcula neededTarget localmente (não precisa refazer o range inteiro)
            neededTarget = lastReqs.reduce((acc, r) => acc + Math.max(0, Math.floor(r.qty)), 0);
            neededTotalByDayISO.set(targetISO, neededTarget);
          }
        }

        // se mesmo assim continuou 0, aí sim é erro real
        if (neededTarget <= 0) {
          return {
            ok: false as const,
            code: "NO_REQUIREMENTS_FOR_DAY",
            upperSaved: true,
            generated: false,
            error:
              "Escala de cima salva, mas NÃO há vagas por função (requirements) cadastradas para este dia. Cadastre qty > 0 em Configurar → Vagas por função.",
            meta: {
              day: targetISO,
              scaleId,
              mode,
              horizonDays,
              activeFunctions: activeFnIds.length,
              neededTarget,
            },
          };
        }
      }


      // 4) existing AUTO no range
      const existing = await tx.dutyEvent.findMany({
        where: { scaleId, kind: "BAIXO", date: { gte: from, lt: toExclusive } },
        select: { id: true, date: true, origin: true, createdAt: true } as any,
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });

      const autoIdsByDayISO = new Map<string, string[]>();
      for (const ev of existing) {
        if (ev.origin !== "AUTO") continue;
        const k = isoDay(ev.date);
        if (!autoIdsByDayISO.has(k)) autoIdsByDayISO.set(k, []);
        autoIdsByDayISO.get(k)!.push(ev.id);
      }

      const deletedAutoDays: string[] = [];
      const createdDays: string[] = [];
      const nothingToGenerateDays: string[] = [];

      let targetDuty: DutyEvent | null = null;

      // ✅ MUDANÇA: loop agora respeita horizonDays (1 no DAY_ONLY)
      for (let i = 0; i < horizonDays; i++) {
        const cur = addDaysLocal(day, i);
        const curISO = isoDay(cur);
        if (!calSet.has(curISO)) break;

        // regra: se tem funções e needed do dia for 0 => não mexe
        if (activeFnIds.length) {
          const needed = neededTotalByDayISO.get(curISO) ?? 0;
          if (needed <= 0) {
            nothingToGenerateDays.push(curISO);
            continue;
          }
        }

        const autoIds = autoIdsByDayISO.get(curISO) ?? [];
        if (autoIds.length) {
          await tx.dutyEvent.deleteMany({ where: { id: { in: autoIds } } });
          deletedAutoDays.push(curISO);
        }

        try {
          const createdEv = await generateForDayTx(tx, scaleId, cur, {
            createdById: body.createdById,
            allowOneDayRestOverride: body.allowOneDayRestOverride,
          });

          createdDays.push(curISO);
          if (sameDay(cur, day)) targetDuty = createdEv;
        } catch (e: any) {
          if (e?.code === "NOTHING_TO_GENERATE" || e?.message === "NOTHING_TO_GENERATE") {
            nothingToGenerateDays.push(curISO);
            continue;
          }
          throw e;
        }
      }

      if (!targetDuty) {
        targetDuty = await tx.dutyEvent.findFirst({
          where: { scaleId, kind: "BAIXO", date: day },
          orderBy: { createdAt: "asc" },
        });
      }

      // ✅ Guard rail 2: terminou e não existe BAIXO no dia alvo => não foi gerado
      if (!targetDuty) {
        return {
          ok: false as const,
          code: "NO_BAIXO_FOR_TARGET_DAY",
          upperSaved: true,
          generated: false,
          error:
            "Escala de cima salva, mas NÃO existe escala de baixo no dia alvo. Isso normalmente acontece por falta de requirements (qty) ou falta de candidatos elegíveis (restrição/descanso/upper).",
          meta: {
            day: targetISO,
            scaleId,
            mode,
            horizonDays,
            createdDays,
            nothingToGenerateDays,
            deletedAutoDays,
          },
        };
      }

      return {
        ok: true as const,
        upperSaved: true,
        generated: true,
        mode,
        horizonDays,
        recalc: { deletedAutoDays, createdDays, nothingToGenerateDays },
        duty: {
          id: targetDuty.id,
          date: isoDay(targetDuty.date),
          kind: targetDuty.kind,
          dayType: targetDuty.dayType,
          origin: targetDuty.origin,
          executorId: targetDuty.executorId,
          titularId: targetDuty.titularId,
          scaleId: targetDuty.scaleId,
          scaleFunctionId: targetDuty.scaleFunctionId,
          slot: targetDuty.slot,
        },
      };
    });

    // se motor devolveu ok:false, vira 409 pro front entender como warning/erro
    if (!result.ok) {
      const dayState = await fetchDayState(scaleId, day);
      return json(409, { ...result, ...dayState });
    }

    const dayState = await fetchDayState(scaleId, day);
    return json(200, { ...result, ...dayState });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "RECALC_FAILED";
    return json(409, {
      ok: false,
      code: "RECALC_FAILED",
      upperSaved: true,
      generated: false,
      error: msg,
      engineCode: e?.code ?? null,
      meta: e?.meta ?? null,
    });
  }
}
