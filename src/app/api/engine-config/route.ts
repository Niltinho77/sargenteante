// src/app/api/engine-config/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function GET() {
  const cfg = await prisma.engineConfig.findFirst();

  // se não existir ainda, cria com defaults do prisma schema
  if (!cfg) {
    const created = await prisma.engineConfig.create({ data: {} });
    return NextResponse.json(created);
  }

  return NextResponse.json(cfg);
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({} as any));

  const { minRestDays, allowOneDayRest, recalcHorizonDays } = body as {
    minRestDays?: number;
    allowOneDayRest?: boolean;
    recalcHorizonDays?: number;
  };

  const cfg = await prisma.engineConfig.findFirst();

  const data: any = {};
  if (typeof minRestDays === "number" && Number.isFinite(minRestDays) && minRestDays >= 0) {
    data.minRestDays = Math.floor(minRestDays);
  }
  if (typeof allowOneDayRest === "boolean") {
    data.allowOneDayRest = allowOneDayRest;
  }
  if (typeof recalcHorizonDays === "number" && Number.isFinite(recalcHorizonDays) && recalcHorizonDays >= 1) {
    data.recalcHorizonDays = Math.floor(recalcHorizonDays);
  }

  const saved = cfg
    ? await prisma.engineConfig.update({ where: { id: cfg.id }, data })
    : await prisma.engineConfig.create({ data });

  await prisma.auditLog.create({
    data: {
      action: "ENGINE_CONFIG_UPDATE",
      entity: "EngineConfig",
      entityId: saved.id,
      metaJson: JSON.stringify({ patch: data }),
    },
  });

  return json(200, saved);
}
