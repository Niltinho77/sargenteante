// src/lib/engine/recalc.ts
import { prisma } from "@/lib/prisma";
import type { Prisma, DutyOrigin } from "@prisma/client";
import { generateForDay } from "@/lib/engine/generate";

type RecalcOptions = {
  createdById?: string;
  scaleId?: string;            // se omitido, recalcula todas as escalas ativas
  horizonDays?: number;        // se omitido, usa EngineConfig.recalcHorizonDays (default 120)
  keepManual?: boolean;        // default true
  keepSwaps?: boolean;         // default true
  allowOneDayRestOverride?: boolean;
};

function normalizeDate(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function recalcFrom(fromDate: Date, opts: RecalcOptions = {}) {
  const from = normalizeDate(fromDate);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const config = await tx.engineConfig.findFirst();
    const horizon = opts.horizonDays ?? config?.recalcHorizonDays ?? 120;

    const to = addDays(from, horizon);

    const scales = opts.scaleId
      ? await tx.scale.findMany({ where: { id: opts.scaleId, isActive: true }, select: { id: true } })
      : await tx.scale.findMany({ where: { isActive: true }, select: { id: true } });

    const scaleIds = scales.map((s) => s.id);

    if (scaleIds.length === 0) {
      throw new Error("No active scales to recalc.");
    }

    const keepManual = opts.keepManual ?? true;
    const keepSwaps = opts.keepSwaps ?? true;

    const originsToDelete: DutyOrigin[] = ["AUTO"];
    if (!keepManual) originsToDelete.push("MANUAL");
    if (!keepSwaps) originsToDelete.push("SWAP");

    // delete AUTO (and optionally MANUAL/SWAP) BAIXO duties in range
    const del = await tx.dutyEvent.deleteMany({
      where: {
        kind: "BAIXO",
        scaleId: { in: scaleIds },
        date: { gte: from, lt: to },
        origin: { in: originsToDelete },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: opts.createdById ?? null,
        action: "ENGINE_RECALC_DELETE",
        entity: "DutyEvent",
        entityId: null,
        metaJson: JSON.stringify({
          from: isoDay(from),
          to: isoDay(to),
          scaleIds,
          deletedCount: del.count,
          keepManual,
          keepSwaps,
        }),
      },
    });

    // Ensure calendar is present for every day in window
    const calendarDays = await tx.calendarDay.findMany({
      where: { date: { gte: from, lt: to } },
      select: { date: true },
    });
    const calendarSet = new Set(calendarDays.map((d) => isoDay(d.date)));

    for (let i = 0; i < horizon; i++) {
      const day = addDays(from, i);
      if (!calendarSet.has(isoDay(day))) {
        throw new Error(`CalendarDay missing for ${isoDay(day)}. Create calendar before recalc.`);
      }
    }

    // generate day-by-day for each scale
    // note: generateForDay uses global prisma; OK in practice but to keep a single TX,
    // we run generation outside TX scope. Here we keep it simple and safe: run sequentially after delete.
    // Return metadata only. (If you want strict atomicity, we can refactor generateForDay to accept tx.)
    return { from, to, scaleIds, deleted: del.count };
  });
}

export async function recalcAndGenerate(fromDate: Date, opts: RecalcOptions = {}) {
  const meta = await recalcFrom(fromDate, opts);

  const from = new Date(meta.from);
  const to = new Date(meta.to);

  const horizonDays = Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

  for (const scaleId of meta.scaleIds) {
    for (let i = 0; i < horizonDays; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      await generateForDay(scaleId, day, {
        createdById: opts.createdById,
        allowOneDayRestOverride: opts.allowOneDayRestOverride,
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: opts.createdById ?? null,
      action: "ENGINE_RECALC_GENERATE",
      entity: "Engine",
      entityId: null,
      metaJson: JSON.stringify({
        from: isoDay(from),
        horizonDays,
        scaleIds: meta.scaleIds,
      }),
    },
  });

  return { ...meta, generatedDays: horizonDays };
}
