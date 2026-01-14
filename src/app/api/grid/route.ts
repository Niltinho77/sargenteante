// src/app/api/grid/route.ts
import { NextResponse } from "next/server";
import { buildGrid } from "@/lib/grid/buildGrid";

function parseDateParam(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const scaleId = searchParams.get("scaleId");
  const from = parseDateParam(searchParams.get("from"));
  const to = parseDateParam(searchParams.get("to"));

  if (!scaleId) return NextResponse.json({ error: "scaleId is required" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "from/to are required (YYYY-MM-DD)" }, { status: 400 });

  const data = await buildGrid(scaleId, from, to);
  return NextResponse.json(data);
}
