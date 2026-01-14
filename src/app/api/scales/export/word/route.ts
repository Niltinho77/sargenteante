// src/app/api/scales/export/word/route.ts
import { prisma } from "@/lib/prisma";
import { parseISODateLocal, normalizeLocal, isoDay } from "@/lib/date";

import fs from "fs";
import path from "path";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Garantia de runtime Node (pra ler arquivo do brasão via fs)
export const runtime = "nodejs";

type Body = {
  date: string;       // YYYY-MM-DD
  scaleIds: string[]; // escalas selecionadas
};

/* ---------------- UTILS ---------------- */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ptBrLongDate(d: Date) {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];
  return `${pad2(d.getDate())} de ${months[d.getMonth()]} de ${d.getFullYear()}`;
}

function weekdayPtBr(d: Date) {
  const days = [
    "Domingo", "Segunda-Feira", "Terça-Feira",
    "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado",
  ];
  return days[d.getDay()];
}

function thinBorder() {
  return { style: BorderStyle.SINGLE, size: 6, color: "000000" };
}

function allBorders() {
  const b = thinBorder();
  return { top: b, bottom: b, left: b, right: b };
}

function daysDiff(a: Date, b: Date) {
  const ms = 24 * 60 * 60 * 1000;
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((da.getTime() - db.getTime()) / ms);
}

/**
 * Aditamento dinâmico:
 * base: nº 07 em 13/01/2026
 * 14/01/2026 -> 08, 15/01/2026 -> 09, ...
 */
function aditamentoNumero(date: Date) {
  const baseDate = new Date(2026, 0, 13); // 13/01/2026
  baseDate.setHours(0, 0, 0, 0);
  const baseNo = 7;

  const diff = daysDiff(date, baseDate);
  const n = baseNo + Math.max(0, diff); // não deixa diminuir
  return pad2(n);
}

function upperPT(s: string) {
  return (s ?? "").toLocaleUpperCase("pt-BR");
}

// Mantém exatamente "07:50h" como no modelo (não vira 07:50H)
function keepTimeLikeModel(s: string) {
  const t = (s ?? "").trim();
  if (/^\d{2}:\d{2}h$/i.test(t)) return t.replace(/H$/, "h");
  return upperPT(t);
}

/* ---------------- REGRAS (DUAS LINHAS FINAS) ---------------- */

function makeDoubleRule() {
  const b = thinBorder();
  // 2 parágrafos com borda inferior fina e espaçamento curtinho
  return [
    new Paragraph({
      border: { bottom: b },
      spacing: { before: 0, after: 40 },
    }),
    new Paragraph({
      border: { bottom: b },
      spacing: { before: 0, after: 120 },
    }),
  ];
}

/* ---------------- BRASÃO CENTRALIZADO ---------------- */

function makeBrasao() {
  // coloque o arquivo em: /public/brasao-eb.png
  const imgPath = path.join(process.cwd(), "public", "brasao.jpg");
  const img = fs.readFileSync(imgPath);

  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [
      new ImageRun({
        data: img,
        type: "jpg",
        transformation: { width: 85, height: 85 }, // ajuste fino aqui se quiser
      }),
    ],
  });
}

/* ---------------- HEADER (SEM TABELA) ---------------- */

function makeHeader(date: Date) {
  const adtNo = aditamentoNumero(date);

  const tightCenter = (text: string, bold = false) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 }, // ✅ sem pular linha
      children: [new TextRun({ text, bold })],
    });

  return [
    // VISTO SGTE (sem espaço extra depois)
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 0 }, // ✅ sem pular linha
      children: [new TextRun({ text: "VISTO SGTE", bold: true })],
    }),

    // brasão (logo abaixo, colado)
    makeBrasao(),

    // linhas do cabeçalho (coladas)
    tightCenter("MINISTÉRIO DA DEFESA", true),
    tightCenter("EXÉRCITO BRASILEIRO", true),
    tightCenter("6º REGIMENTO DE CAVALARIA BLINDADO", true),
    tightCenter("(10º Regimento de Cavalaria Ligeira/1888)"),
    tightCenter("REGIMENTO JOSÉ DE ABREU", true), // ✅ sem after

    // sem linhas em branco aqui
    tightCenter(`Aditamento ao Boletim Interno nº ${adtNo} de ${ptBrLongDate(date)}`),
    tightCenter("Para conhecimento deste Esquadrão e devida execução publico o seguinte:"),

    // título final — sem espaçamento extra antes da tabela
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 0 }, // ✅ era after 250
      children: [
        new TextRun({
          text: `Escala de serviço para o dia ${ptBrLongDate(date)} (${weekdayPtBr(date)})`,
          bold: true,
        }),
      ],
    }),
  ];
}


/* ---------------- TABELA PRINCIPAL (UMA SÓ) ---------------- */

/**
 * Para a coluna ficar realmente menor/maior no Word:
 * - layout FIXED
 * - widths em DXA (twips)
 *
 * Ajuste aqui se quiser ainda mais “função menor”:
 * Função 2300 | Militares 7700
 */
function makeScaleTable(rows: { func: string; people: string }[]) {
  const W_FUNC = 2300;
  const W_PPL = 7700;

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: W_FUNC + W_PPL, type: WidthType.DXA },
    rows: rows.map((r) => {
      const func = upperPT(r.func.trim());
      const people = keepTimeLikeModel(r.people);

      return new TableRow({
        height: { value: 360, rule: HeightRule.ATLEAST }, // mantém “respiro” (não achatado)
        children: [
          new TableCell({
            width: { size: W_FUNC, type: WidthType.DXA },
            borders: allBorders(),
            children: [
              new Paragraph({
                spacing: { before: 60, after: 60 }, // mantém espaçamento confortável
                children: [
                  new TextRun({
                    text: func,
                    size: 22, // ~11pt (um pouco maior)
                  }),
                ],
              }),
            ],
          }),

          new TableCell({
            width: { size: W_PPL, type: WidthType.DXA },
            borders: allBorders(),
            children: [
              new Paragraph({
                spacing: { before: 60, after: 60 },
                children: [
                  new TextRun({
                    text: people,
                    size: 22,
                  }),
                ],
              }),
            ],
          }),
        ],
      });
    }),
  });
}

/* ---------------- BLOCOS DAS PARTES ---------------- */

function makePart(title: string, text: string) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280, after: 120 },
      children: [new TextRun({ text: title, bold: true })],
    }),

    new Table({
      layout: TableLayoutType.FIXED,
      width: { size: 10000, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: allBorders(),
              width: { size: 10000, type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 120, after: 120 },
                  children: [new TextRun({ text })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ];
}

/* ---------------- ROUTE ---------------- */

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  if (!body.date) {
    return new Response(JSON.stringify({ error: "date is required (YYYY-MM-DD)" }), { status: 400 });
  }
  if (!Array.isArray(body.scaleIds) || body.scaleIds.length === 0) {
    return new Response(JSON.stringify({ error: "scaleIds is required (array)" }), { status: 400 });
  }

  const day = normalizeLocal(parseISODateLocal(body.date));
  if (Number.isNaN(day.getTime())) {
    return new Response(JSON.stringify({ error: "Invalid date" }), { status: 400 });
  }

  // intervalo [day, day+1)
  const dayEnd = new Date(day);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const duties = await prisma.dutyEvent.findMany({
    where: {
      kind: "BAIXO",
      scaleId: { in: body.scaleIds },
      date: { gte: day, lt: dayEnd },
    },
    select: {
      scaleFunction: { select: { nome: true } },
      executor: { select: { nome: true, postoGrad: true } },
    },
    orderBy: [{ scaleFunction: { nome: "asc" } }],
  });

  // Agrupa por FUNÇÃO (mistura escalas selecionadas, como você quer)
  const map = new Map<string, string[]>();

  for (const d of duties) {
    const fn = (d.scaleFunction?.nome ?? "SEM FUNÇÃO").trim();
    const pg = (d.executor?.postoGrad ?? "").trim();
    const nm = (d.executor?.nome ?? "").trim();
    const person = `${pg ? pg + " " : ""}${nm}`.trim();
    if (!person) continue;

    if (!map.has(fn)) map.set(fn, []);
    map.get(fn)!.push(person);
  }

  // rows da tabela (função -> lista)
  const rows = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([func, people]) => ({
      func,
      people: people.join(" – "),
    }));

  // ✅ sempre adiciona as duas linhas do modelo (mesmo se não vier do banco)
  rows.push(
    { func: "SALA D’ARMAS", people: "ESQD C AP" },
    { func: "PARADA DIÁRIA", people: "07:50h" } // mantém "h" minúsculo
  );

  const children = [
    ...makeHeader(day),

    makeScaleTable(
      rows.length ? rows : [{ func: "-", people: "SEM MILITARES ESCALADOS NO DIA." }]
    ),
    ...makePart("2ª PARTE – INSTRUÇÃO", "Sem Alteração."),
    ...makePart("3ª PARTE – ASSUNTOS GERAIS E ADMINISTRATIVOS", "Sem Alteração."),
    ...makePart("4ª PARTE – JUSTIÇA E DISCIPLINA", "Sem Alteração."),
  ];

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const bytes = new Uint8Array(buffer);

  const filename = `escala-${isoDay(day)}-${Date.now()}.docx`;

  return new Response(bytes, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
