"use client";

console.log("✅ ScaleGrid SHEET carregou");


import { useEffect, useMemo, useState } from "react";

type Day = { date: string; dayType: "PRETA" | "VERMELHA" };

type Militar = {
  id: string;
  nome: string;
  postoGrad: string | null;
  antiguidade: number;
  createdAt: string;

  // ✅ ADD
  folgaInicialPreta?: number;
  folgaInicialVermelha?: number;
};


type Member = { militar: Militar };

type Duty = {
  id: string;
  date: string;
  kind: "BAIXO" | "CIMA";
  origin?: "AUTO" | "MANUAL" | "SWAP";
  executorId: string;
  titularId: string | null;

  // ✅ multi-funções
  scaleFunctionId?: string | null;
  functionNome?: string | null;
  slot?: number | null;
};


type RestrPaint = {
  militarId: string;
  startDate: string | null;
  endDate: string | null;
  indefinite: boolean;
  appliesTo: "AMBAS" | "PRETA" | "VERMELHA";
};

type Sheet = {
  from: string;
  to: string;
  days: Day[];
  members: Member[];
  duties: Duty[];
  restrictions?: RestrPaint[];
};

type UpperFunction = { id: string; nome: string };
type UpperAssignmentRow = { upperFunctionId: string; militarId: string | null };

type ScalePick = { id: string; nome: string; isActive?: boolean };

async function downloadWord(url: string, body: any, filename: string) {
  // ✅ cache-bust na URL
  const u = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`;

  const r = await fetch(u, {
    method: "POST",
    cache: "no-store", // ✅ importantíssimo
    headers: {
      "Content-Type": "application/json",
      "Accept":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(t);
      msg = j?.error || msg;
    } catch {
      if (t) msg = t.slice(0, 200);
    }
    throw new Error(msg);
  }

  // ✅ se o backend mandar filename, usa ele
  const cd = r.headers.get("content-disposition") || "";
  const match = cd.match(/filename="([^"]+)"/i);
  const finalName = match?.[1] || filename;

  const blob = await r.blob();

  // ✅ opcional: log pra você confirmar que veio arquivo novo
  console.log("📄 EXPORT WORD:", {
    url: u,
    finalName,
    size: blob.size,
    type: blob.type,
    body,
  });

  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(href), 4000);
}



async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function postJson<T>(
  url: string,
  body: any
): Promise<{ status: number; ok: boolean; data: T | any }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { raw: text };
        }
      })()
    : null;

  return { status: r.status, ok: r.ok, data };
}



function weekdayShort(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function hashToHue(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

function getFnColors(scaleFunctionId: string) {
  const hue = hashToHue(scaleFunctionId);
  return {
    bg: `hsl(${hue} 85% 90%)`,
    border: `hsl(${hue} 70% 40%)`,
    text: `hsl(${hue} 40% 18%)`,
  };
}


function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoLocal(d: Date) {
  const x = new Date(d);
  // zera pro "dia local"
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const dd = x.getDate();
  return `${y}-${pad2(m)}-${pad2(dd)}`;
}

function parseISODateLocalFront(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function addDaysISO(baseISO: string, n: number) {
  const d = parseISODateLocalFront(baseISO);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

function subDaysISO(baseISO: string, n: number) {
  return addDaysISO(baseISO, -n);
}


export default function ScaleGrid({ scaleId }: { scaleId: string }) {
  const today = useMemo(() => isoLocal(new Date()), []);

  const [rangeStart, setRangeStart] = useState(today);
  const [rangeEnd, setRangeEnd] = useState(addDaysISO(today, 14));
  const [data, setData] = useState<Sheet | null>(null);

  // modal gerar escala
  const [open, setOpen] = useState(false);
  const [targetDate, setTargetDate] = useState(today);
  const [upperFunctions, setUpperFunctions] = useState<UpperFunction[]>([]);
  const [militars, setMilitars] = useState<Militar[]>([]);
  const [upperDraft, setUpperDraft] = useState<Record<string, string | "">>({});
  const [loadingGenerate, setLoadingGenerate] = useState(false);

  // avisos
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeType, setNoticeType] = useState<"info" | "warn" | "error">("info");

  // modal troca
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapDuty, setSwapDuty] = useState<Duty | null>(null);
  const [swapTo, setSwapTo] = useState<string>("");
  const [swapErr, setSwapErr] = useState<string | null>(null);
  const [swapLoading, setSwapLoading] = useState(false);
  const [clearingDay, setClearingDay] = useState(false);

  // export modal
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [allScales, setAllScales] = useState<ScalePick[]>([]);
  const [exportSelected, setExportSelected] = useState<Set<string>>(
    () => new Set([scaleId])
  );



  const membersLite = useMemo(() => data?.members.map((x) => x.militar) ?? [], [data]);

  type FnLite = { id: string; nome: string; isActive: boolean };
type ReqRow = { scaleFunctionId: string; date: string; qty: number };

const [manualMode, setManualMode] = useState(false);
const [manualOpen, setManualOpen] = useState(false);
const [manualDate, setManualDate] = useState<string>(today);
const [manualMilitarId, setManualMilitarId] = useState<string>("");
const [manualFns, setManualFns] = useState<FnLite[]>([]);
const [manualQtyByFn, setManualQtyByFn] = useState<Map<string, number>>(new Map());
const [manualFnId, setManualFnId] = useState<string>("");
const [manualSlot, setManualSlot] = useState<string>("1");
const [manualErr, setManualErr] = useState<string | null>(null);
const [manualSaving, setManualSaving] = useState(false);

async function openManualPicker(dateISO: string, militarId: string) {
  try {
    setManualErr(null);
    setManualDate(dateISO);
    setManualMilitarId(militarId);

    const bust = Date.now();

    const [fns, reqs] = await Promise.all([
      getJson<FnLite[]>(`/api/scales/${scaleId}/functions?_=${bust}`),
      getJson<ReqRow[]>(
        `/api/scales/${scaleId}/functions/requirements?from=${dateISO}&to=${dateISO}&_=${bust}`
      ),
    ]);

    const active = (fns ?? []).filter((x) => x.isActive);
    const qtyMap = new Map<string, number>();
    for (const r of reqs ?? []) {
      if (r.date === dateISO) qtyMap.set(r.scaleFunctionId, Math.max(0, Math.floor(r.qty)));
    }

    setManualFns(active);
    setManualQtyByFn(qtyMap);

    // default: primeira função com qty>0
    const first = active.find((x) => (qtyMap.get(x.id) ?? 0) > 0) ?? active[0];
    setManualFnId(first?.id ?? "");
    setManualSlot("1");

    setManualOpen(true);
  } catch (e: any) {
    setManualErr(e?.message ?? "Erro ao abrir escala manual");
    setManualOpen(true);
  }
}

function occupiedSlotsFor(dateISO: string, fnId: string, ignoreMilitarId?: string) {
  const slots = new Set<number>();
  for (const ev of data?.duties ?? []) {
    if (ev.kind !== "BAIXO") continue;
    if (String(ev.date).slice(0, 10) !== dateISO) continue;
    if (ev.scaleFunctionId !== fnId) continue;
    if (ignoreMilitarId && ev.executorId === ignoreMilitarId) continue;
    if (typeof ev.slot === "number") slots.add(ev.slot);
  }
  return slots;
}

async function saveManual() {
  if (!manualFnId || !manualMilitarId || !manualDate) return;

  try {
    setManualSaving(true);
    setManualErr(null);

    const slotNum = Math.max(1, Math.floor(Number(manualSlot || "1")));
    const res = await postJson(`/api/scales/${scaleId}/manual`, {
      date: manualDate,
      militarId: manualMilitarId,
      scaleFunctionId: manualFnId,
      slot: slotNum,
      createdById: null,
    });

    if (!res.ok) {
      throw new Error(res.data?.error || `HTTP ${res.status}`);
    }

    await load();
    setManualOpen(false);
  } catch (e: any) {
    setManualErr(e?.message ?? "Erro ao salvar manual");
  } finally {
    setManualSaving(false);
  }
}

async function deleteManualForCell() {
  if (!manualMilitarId || !manualDate) return;

  try {
    setManualSaving(true);
    setManualErr(null);

    const qs = new URLSearchParams();
    qs.set("date", manualDate);
    qs.set("militarId", manualMilitarId);

    const r = await fetch(`/api/scales/${scaleId}/manual?${qs.toString()}`, {
      method: "DELETE",
      cache: "no-store",
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as any)?.error || `HTTP ${r.status}`);

    await load();
    setManualOpen(false);
  } catch (e: any) {
    setManualErr(e?.message ?? "Erro ao remover");
  } finally {
    setManualSaving(false);
  }
}

  const militarsInThisScale = useMemo(() => {
  const list = membersLite.slice();
  list.sort((a, b) => {
    // 1) postoGrad (opcional) 2) nome
    const pa = (a.postoGrad ?? "").toLowerCase();
    const pb = (b.postoGrad ?? "").toLowerCase();
    if (pa !== pb) return pa.localeCompare(pb);
    return a.nome.localeCompare(b.nome);
  });
  return list;
}, [membersLite]);


  async function load() {
  const fetchFrom = subDaysISO(rangeStart, 180);
  const sheet = await getJson<Sheet>(`/api/scales/${scaleId}/sheet?from=${fetchFrom}&to=${rangeEnd}`);

  const t = targetDate; // ISO YYYY-MM-DD

  const debugDate = "2026-01-12";

const dutiesOnDebug = (sheet.duties ?? []).filter(
  (x) => String(x.date).slice(0, 10) === debugDate
);

const memberIds = new Set((sheet.members ?? []).map((m) => m.militar.id));

console.log("SHEET DEBUG:", {
  from: sheet.from,
  to: sheet.to,
  debugDate,
  dutiesOnDebug,
  baixosOnDebug: dutiesOnDebug.filter((x) => x.kind === "BAIXO"),
  membersCount: sheet.members?.length,
});

console.log(
  "MATCH DEBUG:",
  dutiesOnDebug
    .filter((x) => x.kind === "BAIXO")
    .map((b) => ({
      executorId: b.executorId,
      executorIsMember: memberIds.has(b.executorId),
      titularId: b.titularId,
      titularIsMember: b.titularId ? memberIds.has(b.titularId) : null,
    }))
);

setData(sheet);

}

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId, rangeStart, rangeEnd]);

  /**
   * dutyMap: dateISO -> Map<militarId, Duty>
   * - prioridade BAIXO > CIMA (como já tava)
   * - chaveando por executorId (importante: SWAP mostra no executor)
   */
  const dutyMap = useMemo(() => {
  const m = new Map<string, Map<string, Duty>>();

  for (const d of data?.duties ?? []) {
    const dayISO = String(d.date).slice(0, 10);
    if (!m.has(dayISO)) m.set(dayISO, new Map());
    const row = m.get(dayISO)!;

    // sempre salva CIMA se não existir nada ainda
    if (d.kind === "CIMA") {
      if (!row.has(d.executorId)) row.set(d.executorId, d);
      continue;
    }

    // BAIXO sempre sobrescreve qualquer coisa
    if (d.kind === "BAIXO") {
      row.set(d.executorId, d);
      continue;
    }
  }

  return m;
}, [data]);


  /**
   * dutyByDay (BAIXO):
   * - dateISO -> Duty (único do dia nessa escala)
   * - usado pra abrir a troca mesmo clicando na célula azul (executor)
   */
  

  // ✅ marcações extras da troca: também pinta o TITULAR (mesmo sem duty na célula dele)
const swapMarks = useMemo(() => {
  // dateISO -> Map<militarId, "EXECUTOR" | "TITULAR">
  const m = new Map<string, Map<string, "EXECUTOR" | "TITULAR">>();

  for (const ev of data?.duties ?? []) {
    if (ev.kind !== "BAIXO") continue;
    if (ev.origin !== "SWAP") continue;

    const dateISO = String(ev.date).slice(0, 10);
    if (!m.has(dateISO)) m.set(dateISO, new Map());

    // executor (quem foi tirar)
    m.get(dateISO)!.set(ev.executorId, "EXECUTOR");

    // titular (quem “leva o serviço”)
    if (ev.titularId) m.get(dateISO)!.set(ev.titularId, "TITULAR");
  }

  return m;
}, [data]);


  /**
   * restrictionMap: dateISO -> Set<militarId>
   * - respeita appliesTo (PRETA/VERMELHA/AMBAS)
   */
  const restrictionMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (!data) return map;

    const restrictions = data.restrictions ?? [];
    if (!restrictions.length) return map;

    for (const r of restrictions) {
      const start = r.startDate ?? data.from;
      const end = r.indefinite ? data.to : r.endDate ?? data.to;

      for (const day of data.days) {
        const dateISO = day.date.slice(0, 10);
        if (dateISO < start || dateISO > end) continue;

        if (r.appliesTo === "PRETA" && day.dayType !== "PRETA") continue;
        if (r.appliesTo === "VERMELHA" && day.dayType !== "VERMELHA") continue;

        if (!map.has(dateISO)) map.set(dateISO, new Set());
        map.get(dateISO)!.add(r.militarId);
      }
    }
    return map;
  }, [data]);

  /**
   * folgaByDay (streak):
   * - SOMENTE BAIXO zera a folga
   * - afastamento NÃO zera (apenas pinta), mantendo contador visível
   */
  // ✅ folga por dia (streak) — zera SOMENTE quem “recebe o serviço”
// regra: SWAP conta pro TITULAR (folga do titular zera); executor mantém folga
const folgaByDay = useMemo(() => {
  if (!data) return new Map<string, Map<string, number | null>>();

  const baixoCreditedByDate = new Map<string, Set<string>>();

  for (const ev of data.duties ?? []) {
    if (ev.kind !== "BAIXO") continue;

    const k = String(ev.date).slice(0, 10);

    const credited =
      ev.origin === "SWAP" && ev.titularId ? ev.titularId : ev.executorId;

    if (!baixoCreditedByDate.has(k)) baixoCreditedByDate.set(k, new Set());
    baixoCreditedByDate.get(k)!.add(credited);
  }

  const result = new Map<string, Map<string, number | null>>();
  const streak = new Map<string, { PRETA: number; VERMELHA: number }>();

  // ✅ init streak com folgas iniciais (-1 truque)
  for (const m of data.members) {
    const fp = Number.isInteger(m.militar.folgaInicialPreta) ? (m.militar.folgaInicialPreta as number) : 0;
    const fv = Number.isInteger(m.militar.folgaInicialVermelha) ? (m.militar.folgaInicialVermelha as number) : 0;

    streak.set(m.militar.id, {
      PRETA: Math.max(0, fp - 1),
      VERMELHA: Math.max(0, fv - 1),
    });
  }

  for (const d of data.days) {
    const dateISO = String(d.date).slice(0, 10);
    const didCreditedBaixo = baixoCreditedByDate.get(dateISO) ?? new Set<string>();
    const dayMap = new Map<string, number | null>();

    for (const m of data.members) {
      const id = m.militar.id;

      // ✅ não conta antes do cadastro
      const createdAtISO = m.militar.createdAt ? String(m.militar.createdAt).slice(0, 10) : null;
      if (createdAtISO && dateISO < createdAtISO) {
        dayMap.set(id, null); // antes do cadastro -> vazio
        continue;
      }

      const s = streak.get(id)!;
      const servedToday = didCreditedBaixo.has(id);

      if (d.dayType === "PRETA") s.PRETA = servedToday ? 0 : s.PRETA + 1;
      else s.VERMELHA = servedToday ? 0 : s.VERMELHA + 1;

      dayMap.set(id, d.dayType === "PRETA" ? s.PRETA : s.VERMELHA);
    }

    result.set(dateISO, dayMap);
  }

  return result;
}, [data]);


const viewDays = useMemo(() => {
  if (!data) return [];
  return data.days.filter((d) => {
    const dateISO = String(d.date).slice(0, 10);
    return dateISO >= rangeStart && dateISO <= rangeEnd;
  });
}, [data, rangeStart, rangeEnd]);

const functionLegend = useMemo(() => {
  const map = new Map<string, { nome: string; colors: ReturnType<typeof getFnColors> }>();

  for (const ev of data?.duties ?? []) {
    if (ev.kind !== "BAIXO") continue;
    if (!ev.scaleFunctionId) continue;

    const nome = ev.functionNome ?? "Função";
    if (!map.has(ev.scaleFunctionId)) {
      map.set(ev.scaleFunctionId, { nome, colors: getFnColors(ev.scaleFunctionId) });
    }
  }

  return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
}, [data]);

  async function clearDay() {
    const ok = window.confirm(
      `Tem certeza que deseja LIMPAR o dia ${targetDate}?\n\nIsso apagará a escala de baixo (BAIXO) deste dia e você poderá gerar novamente.`
    );
    if (!ok) return;

    try {
      setClearingDay(true);
      setNotice(null);

      const res = await postJson(`/api/scales/${scaleId}/clear-day`, {
        date: targetDate,
        clearUpper: false, // ✅ por padrão NÃO mexe na escala de cima
        createdById: null,
      });

      await load();

      if (!res.ok) {
        setNoticeType("error");
        setNotice(res.data?.error || `HTTP ${res.status}`);
        return;
      }

      setNoticeType("info");
      setNotice(`Dia ${targetDate} limpo com sucesso. Agora você pode gerar novamente.`);
    } catch (e: any) {
      setNoticeType("error");
      setNotice(e?.message ?? "Erro ao limpar o dia");
    } finally {
      setClearingDay(false);
    }
  }

  async function toggleDayType(dateISO: string, current: "PRETA" | "VERMELHA") {
  const next = current === "PRETA" ? "VERMELHA" : "PRETA";

  const ok = window.confirm(
    `Alterar o dia ${dateISO} de ${current} para ${next}?\n\n` +
    `✔ Use com responsabilidade CB LUAN` 
    
  );

  if (!ok) return;

  try {
    const res = await fetch(`/api/calendar/${dateISO}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayType: next }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || `HTTP ${res.status}`);
    }

    await load(); // 🔁 recarrega planilha inteira
  } catch (e: any) {
    alert(e?.message ?? "Erro ao alterar tipo do dia");
  }
}
  


  async function openGenerate() {
    const [ufs, existingRaw] = await Promise.all([
      getJson<UpperFunction[]>("/api/upper/functions"),
      getJson<any>(`/api/upper/assignments?date=${targetDate}`),
    ]);;

    setUpperFunctions(ufs);
    setMilitars(militarsInThisScale);


    const existing = Array.isArray(existingRaw)
      ? existingRaw
      : Array.isArray(existingRaw?.assignments)
      ? existingRaw.assignments
      : Array.isArray(existingRaw?.items)
      ? existingRaw.items
      : [];

    const draft: Record<string, string | ""> = {};
    for (const uf of ufs) draft[uf.id] = "";

    for (const row of existing) {
      if (row?.upperFunctionId) draft[row.upperFunctionId] = row.militarId ?? "";
    }

    setUpperDraft(draft);
    setOpen(true);
  }



  async function generateDay() {
    try {
      setLoadingGenerate(true);
      setNotice(null);

      const assignments: UpperAssignmentRow[] = upperFunctions.map((f) => ({
        upperFunctionId: f.id,
        militarId: upperDraft[f.id] ? upperDraft[f.id] : null,
      }));

      const res = await postJson(`/api/scales/${scaleId}/generate`, {
        date: targetDate,
        upperAssignments: assignments,
      });

      console.log("GENERATE:", {
        ok: res.ok,
        status: res.status,
        duty: res.data?.duty,
        dayDuties: res.data?.dayDuties,
      });


      await load();

      if (res?.data?.upperSaved) setOpen(false);

      if (!res.ok) {
        const msg = (res.data && typeof res.data.error === "string" && res.data.error) || `HTTP ${res.status}`;

        if (res.status === 409 && res?.data?.upperSaved) {
          setNoticeType("warn");
          setNotice(`Escala de cima salva. Não foi possível gerar a escala de baixo: ${msg}`);
          return;
        }

        setNoticeType("error");
        setNotice(msg);
        return;
      }

      setNoticeType("info");
      setNotice("Escala gerada com sucesso.");
    } catch (e: any) {
      setNoticeType("error");
      setNotice(e?.message ?? "Erro ao gerar escala");
    } finally {
      setLoadingGenerate(false);
    }
  }

  /**
   * troca: abre modal só se clicar em BAIXO (azul/roxo)
   * - troca só pode partir de quem está de serviço no dia: UI força isso abrindo somente na célula do executor
   */
  function openSwap(duty: Duty, clickedMilitarId: string) {
    if (!duty) return;
    if (duty.kind !== "BAIXO") return;

    // ✅ só abre se a célula clicada for do executor desse duty
    if (duty.executorId !== clickedMilitarId) return;

    setSwapDuty(duty);
    setSwapTo("");
    setSwapErr(null);
    setSwapOpen(true);
  }


  async function doSwap() {
    if (!swapDuty || !swapTo) return;

    try {
      setSwapLoading(true);
      setSwapErr(null);

      const res = await postJson(`/api/scales/${scaleId}/swap`, {
        date: String(swapDuty.date).slice(0, 10),
        dutyId: swapDuty.id,
        toMilitarId: swapTo,
      });

      if (!res.ok) {
        throw new Error(res.data?.error || `HTTP ${res.status}`);
      }

      await load();
      setSwapOpen(false);
    } catch (e: any) {
      setSwapErr(e?.message ?? "Erro na troca");
    } finally {
      setSwapLoading(false);
    }
  }

  async function undoSwap() {
    if (!swapDuty) return;

    try {
      setSwapLoading(true);
      setSwapErr(null);

      const res = await postJson(`/api/scales/${scaleId}/swap/undo`, {
        dutyId: swapDuty.id,
      });

      if (!res.ok) {
        throw new Error(res.data?.error || `HTTP ${res.status}`);
      }

      await load();
      setSwapOpen(false);
    } catch (e: any) {
      setSwapErr(e?.message ?? "Erro ao desfazer");
    } finally {
      setSwapLoading(false);
    }
  }

  async function openExport() {
  try {
    setExportErr(null);

    // carrega lista de escalas (para escolher quais exportar)
    const list = await getJson<ScalePick[]>(`/api/scales?_${Date.now()}`);

    // por padrão seleciona a escala atual (mantém seleção se já tiver)
    setAllScales(list ?? []);
    setExportSelected((prev) => {
      const next = new Set(prev);
      next.add(scaleId);
      return next;
    });

    setExportOpen(true);
  } catch (e: any) {
    // fallback: mesmo sem lista, deixa exportar só a atual
    setAllScales([]);
    setExportSelected(new Set([scaleId]));
    setExportOpen(true);
    setExportErr(
      `Não consegui carregar a lista de escalas. Vou exportar apenas esta escala atual. (${e?.message ?? "erro"})`
    );
  }
}

async function doExport() {
  try {
    setExporting(true);
    setExportErr(null);

    const ids = Array.from(exportSelected);
    if (!ids.length) throw new Error("Selecione pelo menos 1 escala para exportar.");

   const filename = `escala_${targetDate}_${Date.now()}.docx`;
  await downloadWord("/api/scales/export/word", { date: targetDate, scaleIds: ids }, filename);

    setExportOpen(false);
  } catch (e: any) {
    setExportErr(e?.message ?? "Erro ao exportar");
  } finally {
    setExporting(false);
  }
}


  if (!data) return <div className="rounded border p-4 text-sm">Carregando planilha…</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <div className="text-xs text-muted">Período</div>
            <div className="flex gap-2">
              <input
                type="date"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                className="input text-sm"
              />
              <input
                type="date"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                className="input text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted">Gerar escala (dia)</div>
            <div className="flex gap-2">
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="input text-sm"
              />
              <button
                onClick={openGenerate}
                className="btn text-sm"
              >
                Escalar
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setManualMode((v) => !v)}
            className={`btn text-sm ${manualMode ? "btn-primary" : ""}`}
            title="Quando ligado, clique em uma célula para escalar manualmente"
          >
            {manualMode ? "Modo manual: ON" : "Modo manual: OFF"}
          </button>

          <button
            onClick={openExport}
            className="btn text-sm"
            title="Gera um Word editável igual ao modelo"
          >
            Exportar Word
          </button>
        </div>

      </div>

      {notice && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            noticeType === "warn"
              ? "bg-amber-50 dark:bg-amber-900/20"
              : noticeType === "error"
              ? "bg-red-50 dark:bg-red-900/20"
              : "bg-muted"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button className="text-xs underline opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
              fechar
            </button>
          </div>
        </div>
      )}

      {functionLegend.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {functionLegend.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs bg-card ">
              <span className="h-3 w-3 rounded-full" style={{ background: f.colors.border }} />
              <span>{f.nome}</span>
            </div>
          ))}
        </div>
      )}


      <div className="overflow-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left ">Militar</th>
              {viewDays.map((d) => {
                const dateISO = String(d.date).slice(0, 10);
                

                return (
                 <th
                  key={dateISO}
                  onClick={() => toggleDayType(dateISO, d.dayType)}
                  className={`px-2 py-2 text-center cursor-pointer select-none transition ${
                    d.dayType === "VERMELHA"
                      ? "bg-red-950/70 text-red-100 hover:bg-red-900"
                      : "bg-muted hover:bg-muted/70"
                  }`}
                  title="Clique para alternar PRETA / VERMELHA"
                >
                  <div className="text-[11px] opacity-70">{dateISO}</div>
                  <div className="text-sm font-semibold">
                    {new Date(`${dateISO}T00:00:00`).getDate()}
                  </div>
                </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {data.members.map((m) => (
              <tr key={m.militar.id} className="border-t">
                <td className="sticky left-0 bg-card px-3 py-2 ">
                  <div className="font-medium">{m.militar.nome}</div>
                  <div className="text-xs opacity-70">
                    {m.militar.postoGrad ?? "-"} • ant {m.militar.antiguidade}
                  </div>
                </td>

                {viewDays.map((d) => {
                  const dateISO = String(d.date).slice(0, 10);

                 const duty = dutyMap.get(dateISO)?.get(m.militar.id);

                 const fnId = duty?.kind === "BAIXO" ? duty.scaleFunctionId : null;
                const fnColors = fnId ? getFnColors(fnId) : null;

                const fnTooltip =
                  duty?.kind === "BAIXO" && duty.functionNome
                  ? `${duty.functionNome}${typeof duty.slot === "number" ? ` • Vaga ${duty.slot}` : ""}`
                    : "";

                 if (dateISO === "2026-01-12" && m.militar.id === "cmk9qek3q000a3p0c8gs8assv") {
                  console.log("🎯 CELL DEBUG (Sofia 12/01):", {
                    dateISO,
                    militarId: m.militar.id,
                    dutyFromMap: duty,
                    dutiesRawForDay: (data?.duties ?? []).filter((x) => String(x.date).slice(0,10) === dateISO),
                  });
                }

                const isRestricted = restrictionMap.get(dateISO)?.has(m.militar.id) ?? false;
                const folga = folgaByDay.get(dateISO)?.get(m.militar.id) ?? null;

                // ✅ swap roles
                const swapRole = swapMarks.get(dateISO)?.get(m.militar.id) ?? null;
                const isSwapExec = duty?.kind === "BAIXO" && duty?.origin === "SWAP"; // executor
                const isSwapTit = !duty && swapRole === "TITULAR"; // titular “marcado” sem duty na célula

                // base
                const baseClass =
                  duty?.kind === "BAIXO"
                    ? isSwapExec
                      ? "bg-purple-200 dark:bg-purple-800"
                      : "bg-blue-200 dark:bg-blue-800"
                    : duty?.kind === "CIMA"
                    ? "bg-amber-200 dark:bg-amber-800"
                    : d.dayType === "VERMELHA"
                    ? "bg-red-950/55"
                    : "bg-transparent";

                // ✅ se for titular do swap (sem duty), pinta também
                const cellClass =
                  isSwapTit
                    ? "bg-purple-200/70 dark:bg-purple-800/70"
                    : baseClass;

                // clique abre troca só no executor BAIXO
                const canClick = manualMode || duty?.kind === "BAIXO";
                const cursor = canClick ? "cursor-pointer" : "cursor-default";

                return (
                  <td style={
                        fnColors && duty?.kind === "BAIXO" && duty?.origin !== "SWAP"
                          ? {
                              // ✅ se o dia é VERMELHA, mantém o vermelho do dia como base
                              // e usa a cor da função só como "highlight" (borda + leve glow)
                              background: d.dayType === "VERMELHA" ? undefined : fnColors.bg,
                              boxShadow: `inset 0 0 0 2px ${fnColors.border}`,
                              color: fnColors.text,
                            }
                          : undefined
                      }

                    key={dateISO}
                    className={`relative h-10 border-l text-center ${cellClass} ${cursor}`}
                    onClick={() => {
                  
                      // ✅ modo manual tem prioridade
                      if (manualMode) {
                        openManualPicker(dateISO, m.militar.id);
                        return;
                      }

                      // ✅ comportamento antigo (swap)
                      if (!duty || duty.kind !== "BAIXO") return;
                      openSwap(duty, m.militar.id);
                    }}

                    title={
                      duty?.kind === "BAIXO"
                        ? (fnTooltip || "Clique para trocar serviço")
                        : isSwapTit
                        ? "Troca (serviço conta para este militar)"
                        : duty?.kind === "CIMA"
                        ? "Bloqueio (escala de cima)"
                        : isRestricted
                        ? "Afastado"
                        : ""
                    }

                  >
                    {/* 1) duty normal */}
                    {duty ? (
                      duty.kind === "BAIXO" ? (
                        isSwapExec ? (
                          // ✅ executor da troca: marca com setinha, mas MOSTRA folga normal
                          <div className="flex h-full items-center justify-center gap-1">
                            <span className="text-sm font-semibold">⇄</span>
                            <span className="text-[11px] opacity-70">{folga}</span>
                          </div>
                        ) : (
                          "●"
                        )
                      ) : (
                        "▲"
                      )
                    ) : isSwapTit ? (
                      // ✅ titular da troca: marca com setinha + folga (que vai estar zerada)
                      <div className="flex h-full items-center justify-center gap-1">
                        <span className="text-sm font-semibold">⇄</span>
                        <span className="text-[11px] opacity-70">{folga}</span>
                      </div>
                    ) : (
                      // 2) sem duty: mostra folga sempre
                      <span className="text-[11px] opacity-70">{folga === null ? "" : folga}</span>

                    )}

                    {/* overlay de afastamento SEM esconder folga */}
                    {isRestricted && !duty && !isSwapTit && (
                      <>
                        <span className="absolute inset-0 pointer-events-none bg-zinc-200/35 dark:bg-zinc-800/35" />
                        <span className="absolute right-1 top-1 rounded bg-card/70 px-1 text-[10px] font-semibold opacity-90 /60">
                          AF
                        </span>
                      </>
                    )}
                  </td>
                );

                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* modal exportar word */}
{exportOpen && (
  <div className="fixed inset-0 z-50 modal-overlay p-4">
    <div className="mx-auto w-full max-w-xl rounded-xl bg-card p-4 shadow-lg ">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Exportar Word</div>
          <div className="text-xs text-muted">
            Data: <span className="font-medium">{targetDate}</span> • Selecione quais escalas entram no documento
          </div>
        </div>

        <button
          onClick={() => setExportOpen(false)}
          className="btn text-sm"
          disabled={exporting}
        >
          Fechar
        </button>
      </div>

      {exportErr ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {exportErr}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {allScales.length ? (
          allScales.map((s) => {
            const checked = exportSelected.has(s.id);
            return (
              <label key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="text-sm font-medium">{s.nome}</div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setExportSelected((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    });
                  }}
                  disabled={exporting}
                />
              </label>
            );
          })
        ) : (
          <div className="rounded-lg border p-3 text-sm">
            Lista de escalas indisponível. Vou exportar apenas a escala atual.
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={() => setExportOpen(false)}
          disabled={exporting}
        >
          Cancelar
        </button>

        <button
          className="btn btn-primary text-sm font-medium disabled:opacity-50"
          onClick={doExport}
          disabled={exporting}
        >
          {exporting ? "Gerando..." : "Gerar Word"}
        </button>
      </div>
    </div>
  </div>
)}


      {/* modal gerar escala */}
      {open && (
        <div className="fixed inset-0 z-50 modal-overlay p-4">
          <div className="mx-auto w-full max-w-3xl rounded-xl bg-card p-4 shadow-lg ">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Escalar para {targetDate}</div>
                <div className="text-xs text-muted">
                  Informe a escala de cima e gere a escala de baixo automaticamente.
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn text-sm"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {upperFunctions.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="text-sm font-medium">{f.nome}</div>
                  <select
                    value={upperDraft[f.id] ?? ""}
                    onChange={(e) => setUpperDraft((p) => ({ ...p, [f.id]: e.target.value }))}
                    className="min-w-[260px] rounded border px-2 py-1 text-sm bg-card "
                  >
                    <option value="">(sem militar)</option>
                    {militars.map((mm) => (
                      <option key={mm.id} value={mm.id}>
                        {mm.nome} {mm.postoGrad ? `- ${mm.postoGrad}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="btn text-sm"
              >
                Cancelar
              </button>

              <button
                onClick={clearDay}
                disabled={loadingGenerate || clearingDay}
                className="rounded-md border px-3 py-1.5 text-sm bg-red-600 text-foreground hover:bg-red-700 disabled:opacity-50"
                title="Apaga a escala de baixo (BAIXO) deste dia para refazer"
              >
                {clearingDay ? "Limpando..." : "Limpar dia"}
              </button>

              <button
                onClick={generateDay}
                disabled={loadingGenerate || clearingDay}
                  className="btn btn-primary text-sm font-medium disabled:opacity-50"
              >
                {loadingGenerate ? "Gerando..." : "Salvar escala de cima e gerar"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* modal modo manual */}
{manualOpen && (
  <div className="fixed inset-0 z-50 modal-overlay p-4">
    <div className="mx-auto w-full max-w-xl rounded-xl bg-card p-4 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Escala manual</div>
          <div className="text-xs text-muted">
            Data: <span className="font-medium">{manualDate}</span>
          </div>
        </div>

        <button className="btn text-sm" onClick={() => setManualOpen(false)} disabled={manualSaving}>
          Fechar
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-sm">
          <span className="opacity-70">Militar:</span>{" "}
          <span className="font-semibold">
            {membersLite.find((x) => x.id === manualMilitarId)?.nome ?? manualMilitarId}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted">Função</div>
          <select
            value={manualFnId}
            onChange={(e) => setManualFnId(e.target.value)}
            className="w-full rounded border px-2 py-2 text-sm bg-card"
            disabled={manualSaving}
          >
            {manualFns.map((f) => {
              const qty = manualQtyByFn.get(f.id) ?? 0;
              return (
                <option key={f.id} value={f.id}>
                  {f.nome} {qty ? `(qtd ${qty})` : "(sem demanda)"}
                </option>
              );
            })}
          </select>
          <div className="text-[11px] opacity-70">
            Dica: se estiver “sem demanda”, o motor pode não ter vaga cadastrada para o dia.
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted">Vaga (slot)</div>
          <input
            value={manualSlot}
            onChange={(e) => setManualSlot(e.target.value)}
            className="w-full rounded border px-2 py-2 text-sm bg-card"
            inputMode="numeric"
            disabled={manualSaving}
          />
          {manualFnId ? (() => {
            const occ = occupiedSlotsFor(manualDate, manualFnId, manualMilitarId);
            const qty = manualQtyByFn.get(manualFnId) ?? 0;
            return (
              <div className="text-[11px] opacity-70">
                Ocupados: {occ.size ? Array.from(occ).sort((a,b)=>a-b).join(", ") : "nenhum"} •
                Capacidade do dia: {qty || "0"}
              </div>
            );
          })() : null}
        </div>

        {manualErr ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {manualErr}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={deleteManualForCell}
          disabled={manualSaving}
          title="Remove qualquer escala MANUAL desse militar nesse dia"
        >
          Remover
        </button>

        <button
          className="btn btn-primary text-sm font-medium disabled:opacity-50"
          onClick={saveManual}
          disabled={manualSaving || !manualFnId || !manualMilitarId}
        >
          {manualSaving ? "Salvando..." : "Salvar manual"}
        </button>
      </div>
    </div>
  </div>
)}

      {/* modal troca */}
      {swapOpen && swapDuty && (
        <div className="fixed inset-0 z-50 modal-overlay p-4">
          <div className="mx-auto w-full max-w-xl rounded-xl bg-card p-4 shadow-lg ">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Troca de serviço — {String(swapDuty.date).slice(0, 10)}</div>
              <button className="rounded-md border px-3 py-1.5 text-sm" onClick={() => setSwapOpen(false)} disabled={swapLoading}>
                Fechar
              </button>
            </div>

            <div className="mt-3 text-xs text-muted">
              Somente quem está de serviço hoje pode trocar. Substituto deve ser da mesma escala e ter 1 dia de descanso.
            </div>

            <div className="mt-4 space-y-3">
              <div className="text-sm">
                <span className="opacity-70">Titular (conta o serviço): </span>
                <span className="font-semibold">
                  {membersLite.find((x) => x.id === (swapDuty.titularId ?? swapDuty.executorId))?.nome ??
                    (swapDuty.titularId ?? swapDuty.executorId)}
                </span>
              </div>

              <div className="text-sm">
                <span className="opacity-70">Executor atual: </span>
                <span className="font-semibold">
                  {membersLite.find((x) => x.id === swapDuty.executorId)?.nome ?? swapDuty.executorId}
                </span>
                {swapDuty.origin === "SWAP" ? <span className="ml-2 text-xs opacity-70">(troca ativa)</span> : null}
              </div>

              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Para:</div>
                <select
                  className="min-w-[280px] rounded border px-2 py-1 text-sm bg-card "
                  value={swapTo}
                  onChange={(e) => setSwapTo(e.target.value)}
                  disabled={swapLoading}
                >
                  <option value="">(selecionar)</option>
                  {membersLite
                    .filter((x) => x.id !== swapDuty.executorId)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome} {x.postoGrad ? `- ${x.postoGrad}` : ""}
                      </option>
                    ))}
                </select>
              </div>

              {swapErr ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{swapErr}</div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {swapDuty.origin === "SWAP" ? (
                <button
                  className="rounded-md border px-3 py-1.5 text-sm"
                  onClick={undoSwap}
                  disabled={swapLoading}
                >
                  Desfazer troca
                </button>
              ) : null}

              <button
                className="btn btn-primary text-sm font-medium disabled:opacity-50"
                onClick={doSwap}
                disabled={swapLoading || !swapTo}
              >
                {swapLoading ? "Salvando..." : "Confirmar troca"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
