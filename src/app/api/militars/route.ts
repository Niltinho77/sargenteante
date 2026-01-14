// src/app/api/militars/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const all = searchParams.get("all") === "1";

  const items = await prisma.militar.findMany({
    where: all ? {} : { ativo: true },
    select: {
      id: true,
      nome: true,
      postoGrad: true,
      antiguidade: true,
      ativo: true,
      folgaInicialPreta: true,
      folgaInicialVermelha: true,
    },
    orderBy: [{ antiguidade: "desc" }, { nome: "asc" }],
  });

  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    nome?: string;
    postoGrad?: string | null;
    antiguidade?: number;
    folgaInicialPreta?: number;
    folgaInicialVermelha?: number;
  };

  const nome = String(body.nome ?? "").trim();
  const postoGrad = typeof body.postoGrad === "string" ? body.postoGrad.trim() : null;

  if (!nome || nome.length < 3) {
    return NextResponse.json({ error: "nome is required (min 3 chars)" }, { status: 400 });
  }

  const a = body.antiguidade;
  if (typeof a !== "number" || Number.isNaN(a) || !Number.isInteger(a) || a < 0) {
    return NextResponse.json({ error: "antiguidade is required (integer >= 0)" }, { status: 400 });
  }

  // ✅ saldos iniciais (opcionais; default 0)
  const fp = body.folgaInicialPreta;
  const fv = body.folgaInicialVermelha;

  if (fp !== undefined && (!Number.isInteger(fp) || fp < 0)) {
    return NextResponse.json({ error: "folgaInicialPreta must be integer >= 0" }, { status: 400 });
  }
  if (fv !== undefined && (!Number.isInteger(fv) || fv < 0)) {
    return NextResponse.json({ error: "folgaInicialVermelha must be integer >= 0" }, { status: 400 });
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.militar.updateMany({
      where: { antiguidade: { gte: a } },
      data: { antiguidade: { increment: 1 } },
    });

    const m = await tx.militar.create({
      data: {
        nome,
        postoGrad: postoGrad && postoGrad.length ? postoGrad : null,
        antiguidade: a,
        ativo: true,
        folgaInicialPreta: fp ?? 0,
        folgaInicialVermelha: fv ?? 0,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "MILITAR_CREATE",
        entity: "Militar",
        entityId: m.id,
        metaJson: JSON.stringify({
          nome: m.nome,
          postoGrad: m.postoGrad,
          antiguidade: m.antiguidade,
          folgaInicialPreta: m.folgaInicialPreta,
          folgaInicialVermelha: m.folgaInicialVermelha,
        }),
      },
    });

    return m;
  });

  return NextResponse.json(created);
}
