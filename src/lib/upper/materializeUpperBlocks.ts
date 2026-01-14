import { prisma } from "@/lib/prisma";

function normalizeDate(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function materializeUpperBlocksForDay(date: Date) {
  const day = normalizeDate(date);

  // assignments do dia
  const assignments = await prisma.upperAssignment.findMany({
    where: { date: day },
    select: { militarId: true },
  });

  const militarIds = Array.from(
    new Set(assignments.map((a) => a.militarId).filter(Boolean))
  ) as string[];

  // remove TODOS os CIMA do dia (limpa "fantasmas")
  await prisma.dutyEvent.deleteMany({
    where: { date: day, kind: "CIMA" },
  });

  if (!militarIds.length) return { date: day, created: 0 };

  // cria CIMA atual
  await prisma.dutyEvent.createMany({
    data: militarIds.map((militarId) => ({
      date: day,
      kind: "CIMA",
      origin: "AUTO",
      dayType: "PRETA", // opcional/irrelevante para CIMA; se quiser, busca CalendarDay
      scaleId: null,
      executorId: militarId,
      titularId: null,
      note: "Bloqueio (escala de cima)",
      createdById: null,
    })),
    skipDuplicates: true,
  });

  return { date: day, created: militarIds.length };
}
