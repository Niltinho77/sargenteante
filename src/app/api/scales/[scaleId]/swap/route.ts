// src/app/api/scales/[scaleId]/swap/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, isoDay } from "@/lib/date";

type Body = {
  date?: string;              // YYYY-MM-DD
  dutyId?: string;            // opcional (recomendado)
  toMilitarId?: string;       // quem vai executar
};

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

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

function diffDays(a: Date, b: Date) {
  const A = normalizeDate(a).getTime();
  const B = normalizeDate(b).getTime();
  return Math.floor((A - B) / 86400000);
}

// descanso mínimo 1 dia => último serviço precisa ser <= D-2 (diff >= 2)

export async function POST(req: Request, { params }: { params: Promise<{ scaleId: string }> }) {
  const { scaleId } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) return json(400, { error: "date is required (YYYY-MM-DD)" });
  if (!body.dutyId) return json(400, { error: "dutyId is required" }); // ✅ ADD
  if (!body.toMilitarId) return json(400, { error: "toMilitarId is required" });

  const day = normalizeDate(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) return json(400, { error: "Invalid date" });

  // pega o duty do dia (BAIXO) desta escala
  const duty = await prisma.dutyEvent.findFirst({
    where: { id: body.dutyId, scaleId, kind: "BAIXO" },
  });

  if (!duty) return json(404, { error: "DutyEvent BAIXO not found" });

  // ✅ segurança extra: confere se duty é mesmo do dia enviado
  if (isoDay(duty.date) !== isoDay(day)) {
    return json(409, { error: "DutyEvent não pertence à data informada." });
  }

  // ✅ só quem está de serviço no dia pode "trocar"
  // (UI já vai abrir a troca só na célula azul, mas validamos no server também)
  const currentExecutorId = duty.executorId;

  const toMilitarId = body.toMilitarId;

  if (toMilitarId === currentExecutorId) return json(409, { error: "Mesmo militar." });

  // ✅ troca só dentro da mesma escala
  const member = await prisma.scaleMember.findFirst({
    where: { scaleId, militarId: toMilitarId, isActive: true, militar: { ativo: true } },
    select: { militarId: true },
  });
  if (!member) return json(409, { error: "Substituto não pertence a esta escala (ou está inativo)." });

  // substituto não pode já estar em CIMA no mesmo dia
  const upperSameDay = await prisma.upperAssignment.findFirst({
    where: { date: day, militarId: toMilitarId },
    select: { id: true },
  });
  if (upperSameDay) return json(409, { error: "Substituto está na escala de cima neste dia." });

  // ✅ restrição (respeitando appliesTo)
  const cal = await prisma.calendarDay.findUnique({ where: { date: day }, select: { dayType: true } });
  if (!cal) return json(400, { error: `CalendarDay not found for ${isoDay(day)}` });

  const restrictions = await prisma.restriction.findMany({
    where: { militarId: toMilitarId, OR: [{ scaleId: null }, { scaleId }] },
    select: { startDate: true, endDate: true, indefinite: true, appliesTo: true },
  });

  const blocksByType = (appliesTo: any, dayType: any) => {
    const a = appliesTo ?? "AMBAS";
    if (a === "AMBAS") return true;
    if (a === "PRETA") return dayType === "PRETA";
    if (a === "VERMELHA") return dayType === "VERMELHA";
    return true;
  };

  const activeRestriction = (r: any) => {
    if (r.indefinite) return true;
    const startOk = !r.startDate || r.startDate <= day;
    const endOk = !r.endDate || r.endDate >= day;
    return startOk && endOk;
  };

  for (const r of restrictions) {
    if (!blocksByType(r.appliesTo, cal.dayType)) continue;
    if (activeRestriction(r)) return json(409, { error: "Substituto está restrito para este dia/tipo." });
  }

  // ✅ descanso mínimo 1 dia pro substituto (global: BAIXO + CIMA via UpperAssignment)
  const since = addDays(day, -365);

  const recentDuty = await prisma.dutyEvent.findFirst({
    where: {
      date: { gte: since, lt: day },
      OR: [{ executorId: toMilitarId }, { titularId: toMilitarId }],
    },
    select: { date: true },
    orderBy: { date: "desc" },
  });

  const recentUpper = await prisma.upperAssignment.findFirst({
    where: { date: { gte: since, lt: day }, militarId: toMilitarId },
    select: { date: true },
    orderBy: { date: "desc" },
  });

  const last = (() => {
    const a = recentDuty?.date ? normalizeDate(recentDuty.date) : null;
    const b = recentUpper?.date ? normalizeDate(recentUpper.date) : null;
    if (!a) return b;
    if (!b) return a;
    return b > a ? b : a;
  })();

  // ✅ regras do motor (global)
  const cfg = await prisma.engineConfig.findFirst();
  const minRestDays = cfg?.minRestDays ?? 2;
  const allowOneDayRest = cfg?.allowOneDayRest ?? false;

  // padrão: minRestDays=2 => diff>=3 (2 dias “cheios” de descanso)
  const requiredDiff = minRestDays + 1;

  // exceção: 1 dia de descanso => diff>=2 (mesmo padrão do generateTx)
  const requiredDiffWithOverride = 2;


    if (last) {
    const dd = diffDays(day, last);

    const ok =
      dd >= requiredDiff ||
      (allowOneDayRest && dd >= requiredDiffWithOverride);

    if (!ok) {
      return json(409, {
        error: allowOneDayRest
          ? "Substituto sem descanso mínimo (regra: 1 dia quando habilitado)."
          : `Substituto sem descanso mínimo (regra: ${minRestDays} dias).`,
        meta: { dd, requiredDiff, requiredDiffWithOverride, allowOneDayRest, minRestDays },
      });
    }
  }


  // ✅ aplica troca
  const originalOrigin = duty.origin;
  const originalExecutor = duty.executorId;
  const originalTitular = duty.titularId; // normalmente null

  const updated = await prisma.dutyEvent.update({
    where: { id: duty.id },
    data: {
      origin: "SWAP",
      // garante que "o serviço conta pro da vez"
      titularId: originalTitular ?? originalExecutor,
      executorId: toMilitarId,
      note: `Troca: ${originalExecutor} -> ${toMilitarId} (orig=${originalOrigin})`,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "DUTY_SWAP",
      entity: "DutyEvent",
      entityId: updated.id,
      metaJson: JSON.stringify({
        date: isoDay(day),
        scaleId,
        from: originalExecutor,
        to: toMilitarId,
        originalOrigin,
      }),
    },
  });

  return json(200, { ok: true, dutyId: updated.id });
}
