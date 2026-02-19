// src/app/api/scales/[scaleId]/manual/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

type PostBody = {
  date?: string; // YYYY-MM-DD
  militarId?: string;
  scaleFunctionId?: string;
  slot?: number | string | null; // 1..qty
  createdById?: string | null;
};

function parseSlot(raw: any) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
      ? Number.parseInt(raw, 10)
      : NaN;

  if (!Number.isFinite(n)) return NaN as any;
  return Math.floor(n);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const body = (await req.json().catch(() => ({}))) as PostBody;

  const dateISO = body.date;
  const militarId = body.militarId;
  const scaleFunctionId = body.scaleFunctionId;

  if (!dateISO) return noStoreJson({ error: "date is required (YYYY-MM-DD)" }, 400);
  if (!militarId) return noStoreJson({ error: "militarId is required" }, 400);
  if (!scaleFunctionId) return noStoreJson({ error: "scaleFunctionId is required" }, 400);

  const day = normalizeLocal(parseISODateLocal(dateISO));
  if (Number.isNaN(day.getTime())) return noStoreJson({ error: "Invalid date" }, 400);

  const slot = parseSlot(body.slot);
  if (!Number.isFinite(slot as any) || (slot as number) < 1) {
    return noStoreJson({ error: "slot must be a number >= 1" }, 400);
  }

  // CalendarDay => dayType
  const cal = await prisma.calendarDay.findUnique({ where: { date: day } });
  if (!cal) return noStoreJson({ error: `CalendarDay not found for ${isoDay(day)}` }, 404);

  // valida se a função pertence à escala e está ativa
  const fn = await prisma.scaleFunction.findFirst({
    where: { id: scaleFunctionId, scaleId, isActive: true },
    select: { id: true, nome: true },
  });
  if (!fn) return noStoreJson({ error: "ScaleFunction not found/active for this scale" }, 404);

  // ✅ requirement do dia (qty) — NÃO use variável chamada "req"
  const reqRow = await prisma.scaleFunctionRequirement.findFirst({
    where: { scaleFunctionId: fn.id, date: day },
    select: { qty: true },
  });

  const qty = Math.max(0, Math.floor(reqRow?.qty ?? 0));
  if (qty <= 0) {
    return noStoreJson(
      { error: `Esta função não tem vagas para ${isoDay(day)} (qty=0). Cadastre em "Qtd Função".` },
      409
    );
  }
  if ((slot as number) > qty) {
    return noStoreJson({ error: `Slot ${slot} inválido. Máximo para o dia: ${qty}.` }, 409);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Se já existe BAIXO deste militar no dia, atualiza
      const existing = await tx.dutyEvent.findFirst({
        where: { date: day, scaleId, kind: "BAIXO", executorId: militarId },
        select: { id: true, origin: true },
      });

      // Segurança: não mexer em SWAP por aqui
      if (existing?.origin === "SWAP") {
        const err: any = new Error(
          "Este militar está em uma TROCA (SWAP) neste dia. Desfaça a troca antes de escalar manualmente."
        );
        err.status = 409;
        throw err;
      }

      // conflito: slot já ocupado por outro duty
      const occupied = await tx.dutyEvent.findFirst({
        where: {
          date: day,
          scaleId,
          kind: "BAIXO",
          scaleFunctionId: fn.id,
          slot: slot as number,
          ...(existing ? { NOT: { id: existing.id } } : {}),
        },
        select: { id: true, executorId: true },
      });

      if (occupied) {
        const err: any = new Error("Esta vaga (função/slot) já está ocupada no dia.");
        err.status = 409;
        err.meta = { occupiedBy: occupied.executorId };
        throw err;
      }

      const saved = existing
        ? await tx.dutyEvent.update({
            where: { id: existing.id },
            data: {
              origin: "MANUAL",
              dayType: cal.dayType,
              scaleFunctionId: fn.id,
              slot: slot as number,
              titularId: null,
              createdById: body.createdById ?? null,
              note: `Atribuído manualmente — ${fn.nome} (slot ${slot})`,
            },
          })
        : await tx.dutyEvent.create({
            data: {
              date: day,
              scaleId,
              kind: "BAIXO",
              origin: "MANUAL",
              dayType: cal.dayType,
              executorId: militarId, // ✅ agora é string garantida
              titularId: null,
              createdById: body.createdById ?? null,
              note: `Atribuído manualmente — ${fn.nome} (slot ${slot})`,
              scaleFunctionId: fn.id,
              slot: slot as number,
            },
          });

      await tx.auditLog.create({
        data: {
          action: "DUTY_MANUAL_UPSERT",
          entity: "DutyEvent",
          entityId: saved.id,
          userId: body.createdById ?? null,
          metaJson: JSON.stringify({
            scaleId,
            date: isoDay(day),
            dayType: cal.dayType,
            militarId,
            scaleFunctionId: fn.id,
            functionNome: fn.nome,
            slot,
          }),
        },
      });

      return saved;
    });

    return noStoreJson({
      ok: true,
      duty: {
        id: result.id,
        date: isoDay(result.date),
        kind: result.kind,
        origin: result.origin,
        dayType: result.dayType,
        executorId: result.executorId,
        titularId: result.titularId,
        scaleFunctionId: result.scaleFunctionId,
        slot: result.slot,
      },
    });
  } catch (e: any) {
    const status = e?.status ?? 500;
    return noStoreJson({ error: e?.message ?? "Erro ao salvar manual", meta: e?.meta ?? null }, status);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ scaleId: string }> }
) {
  const { scaleId } = await params;

  const url = new URL(req.url);
  const dateStr = url.searchParams.get("date");
  const militarId = url.searchParams.get("militarId");
  const createdById = url.searchParams.get("createdById") || null;

  if (!dateStr) return noStoreJson({ error: "date query param is required (YYYY-MM-DD)" }, 400);
  if (!militarId) return noStoreJson({ error: "militarId query param is required" }, 400);

  const day = normalizeLocal(parseISODateLocal(dateStr));
  if (Number.isNaN(day.getTime())) return noStoreJson({ error: "Invalid date" }, 400);

  const existing = await prisma.dutyEvent.findFirst({
    where: { date: day, scaleId, kind: "BAIXO", executorId: militarId },
    select: { id: true, origin: true },
  });

  if (!existing) return noStoreJson({ ok: true, deleted: false });

  if (existing.origin === "SWAP") {
    return noStoreJson({ error: "Este registro é SWAP. Use o fluxo de desfazer troca." }, 409);
  }

  await prisma.$transaction(async (tx) => {
    await tx.dutyEvent.delete({ where: { id: existing.id } });

    await tx.auditLog.create({
      data: {
        action: "DUTY_MANUAL_DELETE",
        entity: "DutyEvent",
        entityId: existing.id,
        userId: createdById,
        metaJson: JSON.stringify({
          scaleId,
          date: isoDay(day),
          militarId,
          prevOrigin: existing.origin,
        }),
      },
    });
  });

  return noStoreJson({ ok: true, deleted: true });
}