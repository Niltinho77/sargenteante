// src/app/api/engine/recalc/route.ts
import { NextResponse } from "next/server";
import { recalcAndGenerate } from "@/lib/engine/recalc";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const { fromDate, scaleId, horizonDays, allowOneDayRestOverride } = body as {
    fromDate?: string; // YYYY-MM-DD
    scaleId?: string;
    horizonDays?: number;
    allowOneDayRestOverride?: boolean;
  };

  if (!fromDate) return NextResponse.json({ error: "fromDate is required (YYYY-MM-DD)" }, { status: 400 });

  const from = new Date(fromDate);
  if (Number.isNaN(from.getTime())) return NextResponse.json({ error: "Invalid fromDate" }, { status: 400 });

  const result = await recalcAndGenerate(from, {
    scaleId,
    horizonDays,
    allowOneDayRestOverride,
    keepManual: true,
    keepSwaps: true,
  });

  return NextResponse.json(result);
}
