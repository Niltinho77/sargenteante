// src/components/admin/ScaleSettings.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import RestrictionsPanel from "@/components/admin/parts/RestrictionsPanel";
import UpperPanel from "@/components/upper/UpperPanel";
import FunctionsPanel from "@/components/admin/parts/FunctionsPanel";

type Militar = {
  id: string;
  nome: string;
  postoGrad: string | null;
  antiguidade: number;
  ativo: boolean;
};

type MemberRow = {
  id: string;
  isActive: boolean;
  competitionMode: "AMBAS" | "SOMENTE_PRETA" | "SOMENTE_VERMELHA" | "NENHUMA";
  militar: Militar;
};

type EngineConfig = {
  id: string;
  minRestDays: number;
  allowOneDayRest: boolean;
  recalcHorizonDays: number;
  updatedAt: string;
};

type Scale = { id: string; nome: string; descricao: string | null; isActive: boolean };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `HTTP ${r.status}`);
  return j as T;
}

const modes = [
  { v: "AMBAS", label: "Ambas" },
  { v: "SOMENTE_PRETA", label: "Só Preta" },
  { v: "SOMENTE_VERMELHA", label: "Só Vermelha" },
  { v: "NENHUMA", label: "Nenhuma" },
] as const;

const yyyyMmDd = (d: Date) => d.toISOString().slice(0, 10);

export default function ScaleSettings({ scaleId }: { scaleId: string }) {
  const [scale, setScale] = useState<Scale | null>(null);
  const [militars, setMilitars] = useState<Militar[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const [addMilitarId, setAddMilitarId] = useState<string>("");
  const [addMode, setAddMode] = useState<MemberRow["competitionMode"]>("AMBAS");

  const [upperDate, setUpperDate] = useState<string>(() => yyyyMmDd(new Date()));

  const notLinked = useMemo(() => {
    const linked = new Set(members.map((m) => m.militar.id));
    return militars.filter((m) => !linked.has(m.id));
  }, [militars, members]);

  const militarLite = useMemo(
    () => militars.map((m) => ({ id: m.id, nome: m.nome, postoGrad: m.postoGrad })),
    [militars]
  );

  async function loadAll() {
    setLoading(true);
    setErr(null);
    try {
      const [scales, mils, mems, cfg] = await Promise.all([
        json<Scale[]>("/api/scales"),
        json<Militar[]>("/api/militars"),
        json<MemberRow[]>(`/api/scales/${scaleId}/members`),
        json<EngineConfig>("/api/engine-config"),
      ]);

      setEngineConfig(cfg);
      setScale(scales.find((s) => s.id === scaleId) ?? null);
      setMilitars(mils);
      setMembers(mems);

      // define default do select de "vincular"
      if (!addMilitarId && mils.length) setAddMilitarId(mils[0]?.id ?? "");
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar configurações.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleAllowOneDayRest(next: boolean) {
    try {
      setSavingCfg(true);
      setErr(null);

      const saved = await json<EngineConfig>("/api/engine-config", {
        method: "PATCH",
        body: JSON.stringify({ allowOneDayRest: next }),
      });

      setEngineConfig(saved);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar configuração do motor.");
    } finally {
      setSavingCfg(false);
    }
  }

  async function addMember() {
    if (!addMilitarId) return;
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/scales/${scaleId}/members`, {
        method: "POST",
        body: JSON.stringify({ militarId: addMilitarId, competitionMode: addMode }),
      });
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao vincular militar.");
    } finally {
      setLoading(false);
    }
  }

  async function updateMember(
    memberId: string,
    patch: Partial<Pick<MemberRow, "isActive" | "competitionMode">>
  ) {
    setLoading(true);
    setErr(null);
    try {
      await json(`/api/scales/${scaleId}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao atualizar membro.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div>
          <div className="text-lg font-semibold text-foreground">Configurar escala</div>
          <div className="mt-0.5 text-xs text-muted">
            {scale?.nome ?? "..."} {scale?.descricao ? `• ${scale.descricao}` : ""}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className="btn text-sm" href={`/scales/${scaleId}`}>
            Voltar para planilha
          </Link>
          <Link className="btn text-sm" href="/scales">
            Todas escalas
          </Link>
        </div>
      </div>

      {/* Error */}
      {err ? (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-sm font-semibold text-foreground">Atenção</div>
          <div className="mt-1 text-sm text-muted">{err}</div>
        </div>
      ) : null}

      {/* Vincular militar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">Vincular militar</div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <select
            className="input text-sm"
            value={addMilitarId}
            onChange={(e) => setAddMilitarId(e.target.value)}
            disabled={loading}
          >
            <option value="">Selecione…</option>
            {notLinked.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} {m.postoGrad ? `— ${m.postoGrad}` : ""}
              </option>
            ))}
          </select>

          <select
            className="input text-sm"
            value={addMode}
            onChange={(e) => setAddMode(e.target.value as any)}
            disabled={loading}
          >
            {modes.map((m) => (
              <option key={m.v} value={m.v}>
                {m.label}
              </option>
            ))}
          </select>

          <button
            className="btn btn-primary text-sm font-medium disabled:opacity-50"
            onClick={addMember}
            disabled={loading || !addMilitarId}
          >
            Vincular
          </button>
        </div>

        {notLinked.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-muted p-2 text-xs text-muted">
            Todos os militares já estão vinculados a esta escala.
          </div>
        ) : null}
      </div>

      {/* Tabela membros */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Membros da escala</div>
          </div>
          <div className="text-xs text-muted">
            Total: <span className="font-semibold text-foreground">{members.length}</span>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:text-left [&>th]:text-xs [&>th]:font-semibold [&>th]:text-muted">
                <th>Militar</th>
                <th>Concorre</th>
                <th>Status</th>
                <th className="w-[140px]">Ações</th>
              </tr>
            </thead>

            <tbody className="[&>tr]:border-t [&>tr]:border-border">
              {members.map((m, idx) => (
                <tr
                  key={m.id}
                  className={`${
                    idx % 2 === 0 ? "bg-card" : "bg-muted/30"
                  } hover:bg-muted/60 transition`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{m.militar.nome}</div>
                    <div className="text-[11px] text-muted">
                      {m.militar.postoGrad ?? "-"} • antiguidade {m.militar.antiguidade}
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <select
                      className="input text-sm"
                      value={m.competitionMode}
                      onChange={(e) => updateMember(m.id, { competitionMode: e.target.value as any })}
                      disabled={loading}
                    >
                      {modes.map((mm) => (
                        <option key={mm.v} value={mm.v}>
                          {mm.label}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full border border-border px-2.5 py-1 text-xs ${
                        m.isActive ? "bg-card text-foreground" : "bg-muted text-muted"
                      }`}
                    >
                      {m.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <button
                      className="btn text-xs"
                      onClick={() => updateMember(m.id, { isActive: !m.isActive })}
                      disabled={loading}
                      title="Ativa/desativa o militar nesta escala"
                    >
                      {m.isActive ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              ))}

              {!members.length ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-muted" colSpan={4}>
                    {loading ? "Carregando..." : "Nenhum militar vinculado nesta escala."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Motor */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">Regras do motor (global)</div>
          
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted p-3">
          <div>
            <div className="text-sm font-medium text-foreground">Permitir descanso de apenas 1 dia</div>
            
          </div>

          <input
            type="checkbox"
            checked={Boolean(engineConfig?.allowOneDayRest)}
            onChange={(e) => toggleAllowOneDayRest(e.target.checked)}
            disabled={loading || savingCfg || !engineConfig}
            className="h-5 w-5"
            aria-label="Permitir descanso de 1 dia"
          />
        </label>

        {savingCfg ? <div className="mt-2 text-xs text-muted">Salvando...</div> : null}
      </div>

      {/* Restrições */}
      <RestrictionsPanel scaleId={scaleId} militars={militarLite} onChanged={loadAll} />

      {/* Escala de cima */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Operar escala de cima</div>
          </div>

         
        </div>

        <div className="space-y-3">
          <FunctionsPanel scaleId={scaleId} />
          <UpperPanel date={upperDate} militars={militarLite} onChanged={loadAll} />
        </div>
      </div>
    </div>
  );
}
