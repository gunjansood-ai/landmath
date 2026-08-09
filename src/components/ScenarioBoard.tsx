"use client";

/**
 * ScenarioBoard — verdict-first display of the development scenario optimizer.
 *
 * Mobile-first: the first thing on screen is ONE answer ("best play"), with a
 * ranked list of alternatives behind progressive disclosure. Every scenario
 * shows its legal basis (municipal code + state statute citations) and a
 * confidence grade; low-confidence ideas are tucked into a collapsed section.
 */

import { useMemo, useState } from "react";
import {
  Trophy, ChevronDown, ChevronUp, Scale, TrendingUp, Clock,
  AlertTriangle, ExternalLink, Layers, Home, Building2, Hammer,
  CircleDollarSign, KeyRound,
} from "lucide-react";
import type { PropertyData, QualityTier, FinancingConfig } from "@/store/useStore";
import { formatCurrency } from "@/lib/calculations";
import {
  optimizeProperty,
  type ScenarioResult,
  type ScenarioExit,
  type ScenarioForm,
} from "@/lib/optimizer";

const FORM_ICON: Record<ScenarioForm, typeof Home> = {
  sfr: Home,
  sfr_adu: Layers,
  plex: Building2,
  townhome: Building2,
  multifamily: Building2,
  flip: Hammer,
  keep_dadu: KeyRound,
};

function ConfidencePill({ s }: { s: ScenarioResult }) {
  const cls =
    s.confidenceLabel === "High"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : s.confidenceLabel === "Medium"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>
      {s.confidenceLabel} {s.confidence}
    </span>
  );
}

function FeasBadge({ s }: { s: ScenarioResult }) {
  return s.feasibility === "permitted" ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      Permitted
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
      Conditional
    </span>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/15 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
      <p className="text-[9px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-xs font-bold">{value}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between py-1">
      <span className={`text-xs ${bold ? "font-bold text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>{label}</span>
      <span className={`text-xs ${bold ? "font-bold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-gray-300"}`}>{value}</span>
    </div>
  );
}

function ScenarioDetail({ s }: { s: ScenarioResult }) {
  const f = s.financials;
  return (
    <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700/60">
      <div className="pt-3 space-y-0.5">
        <Row label={s.exit === "hold" ? "Stabilized value" : "Sale revenue"} value={formatCurrency(f.revenue)} />
        <Row label="Acquisition (incl. closing)" value={formatCurrency(f.acquisitionCost)} />
        <Row label="Construction (all-in)" value={formatCurrency(f.constructionCost)} />
        <Row label="Holding + loan costs" value={formatCurrency(f.holdingCost)} />
        {s.exit === "sell" && <Row label="Selling costs" value={formatCurrency(f.sellingCosts)} />}
        <Row label="Cash required (peak)" value={formatCurrency(f.totalCashInvested)} />
        <Row label="Avg cash deployed (ROI basis)" value={formatCurrency(f.avgCashDeployed ?? f.totalCashInvested)} />
        <Row
          label={s.exit === "hold" ? "Equity created" : "Net profit"}
          value={formatCurrency(f.profit)}
          bold
        />
        {s.exit === "hold" && (
          <>
            <Row label="Gross rent" value={`${formatCurrency(f.monthlyGrossRent ?? 0)}/mo`} />
            <Row label="NOI / cap rate" value={`${formatCurrency(f.noi ?? 0)} @ ${f.capRate}%`} />
            <Row label="Refi loan (72% LTV)" value={formatCurrency(f.refiLoan ?? 0)} />
            <Row label="Cash left in deal after refi" value={formatCurrency(f.cashLeftInDeal ?? 0)} />
            <Row
              label="Annual cash flow / CoC"
              value={`${formatCurrency(f.annualCashFlow ?? 0)}${(f.cashOnCash ?? 0) > 0 && (f.cashOnCash ?? 0) < 999 ? ` (${f.cashOnCash}%)` : (f.cashOnCash ?? 0) >= 999 ? " (∞ — no cash left in)" : ""}`}
            />
          </>
        )}
      </div>

      <div className="mt-3 space-y-1.5">
        {s.why.map((w, i) => (
          <p key={i} className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">• {w}</p>
        ))}
        {s.notes.map((n, i) => (
          <p key={`n${i}`} className="text-[11px] leading-relaxed text-orange-700 dark:text-orange-400 flex gap-1.5">
            <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /> <span>{n}</span>
          </p>
        ))}
      </div>

      {s.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.citations.map((c) => (
            <a key={c.label} href={c.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 dark:bg-slate-700/60 border border-gray-200 dark:border-slate-600 rounded-lg text-[10px] text-gray-600 dark:text-gray-300 hover:bg-gray-100">
              <Scale size={9} /> {c.label} <ExternalLink size={8} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ s, rank }: { s: ScenarioResult; rank: number }) {
  const [open, setOpen] = useState(false);
  const Icon = FORM_ICON[s.form];
  const f = s.financials;
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 active:bg-gray-50 dark:active:bg-slate-700/40">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-[11px] font-bold text-gray-500 dark:text-gray-300">
            #{rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <Icon size={13} className="text-gray-400 flex-shrink-0" />
              <p className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{s.label}</p>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <ConfidencePill s={s} />
              <FeasBadge s={s} />
              <span className="text-[10px] text-gray-400">{f.timelineMonths} mo</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className={`text-sm font-bold ${f.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {formatCurrency(f.profit)}
            </p>
            <p className="text-[10px] text-gray-400">
              {s.exit === "hold" ? `equity · ${((f.cashOnCash ?? 0) >= 999) ? "∞" : `${f.cashOnCash ?? 0}%`} CoC` : `${f.roi}% ROI`}
            </p>
          </div>
          {open ? <ChevronUp size={16} className="text-gray-300 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-300 flex-shrink-0" />}
        </div>
      </button>
      {open && <ScenarioDetail s={s} />}
    </div>
  );
}

export default function ScenarioBoard({
  property, tier, costPerSqft, financing,
}: {
  property: PropertyData;
  tier: QualityTier;
  costPerSqft: number;
  financing: FinancingConfig;
}) {
  const [exitFilter, setExitFilter] = useState<"all" | ScenarioExit>("all");
  const [showLongShots, setShowLongShots] = useState(false);
  const [bestOpen, setBestOpen] = useState(false);

  const report = useMemo(
    () => optimizeProperty(property, tier, costPerSqft, financing),
    [property, tier, costPerSqft, financing],
  );

  const filtered = useMemo(
    () => report.scenarios.filter((s) => exitFilter === "all" || s.exit === exitFilter),
    [report.scenarios, exitFilter],
  );

  const { best } = report;
  const env = report.envelopeSummary;

  return (
    <section className="mb-6">
      {/* ── Verdict hero ─────────────────────────────────────────────────── */}
      {best ? (
        <div className="rounded-3xl overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 text-white shadow-lg">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy size={14} className="text-amber-300" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">Best play for this land</p>
            </div>
            <h2 className="text-lg font-bold leading-snug mb-1">{best.label}</h2>
            <p className="text-3xl font-extrabold tracking-tight">
              {formatCurrency(best.financials.profit)}
              <span className="text-sm font-semibold text-emerald-200 ml-2">
                {best.exit === "hold" ? "equity created" : "projected profit"}
              </span>
            </p>
            <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide">
              <MetricChip label="ROI" value={`${best.financials.roi}%`} />
              <MetricChip label="Annualized" value={`${best.financials.annualizedRoi}%`} />
              <MetricChip label="Timeline" value={`${best.financials.timelineMonths} mo`} />
              <MetricChip label="Cash needed" value={formatCurrency(best.financials.totalCashInvested)} />
              {best.exit === "hold" && (
                <MetricChip label="Cash flow" value={`${formatCurrency(best.financials.annualCashFlow ?? 0)}/yr`} />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              <ConfidencePill s={best} />
              <FeasBadge s={best} />
              <span className="text-[10px] text-emerald-100/80">
                {best.totalUnits} unit{best.totalUnits > 1 ? "s" : ""} · {best.totalBuildSqft.toLocaleString()} sqft new
              </span>
            </div>
          </div>
          <button
            onClick={() => setBestOpen(!bestOpen)}
            className="w-full px-5 py-2.5 bg-black/15 text-left flex items-center justify-between text-xs font-semibold text-emerald-50"
          >
            Why this wins + full numbers
            {bestOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {bestOpen && (
            <div className="bg-white dark:bg-slate-800 text-gray-900 dark:text-white">
              <ScenarioDetail s={best} />
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-3xl bg-gradient-to-br from-gray-600 to-gray-800 text-white px-5 py-5 shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-300" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-200">Verdict</p>
          </div>
          <h2 className="text-lg font-bold">Pass at this price</h2>
          <p className="text-xs text-gray-300 mt-1 leading-relaxed">
            None of the {report.scenarios.length + report.longShots.length} legal development scenarios pencil at the current
            ask. Try lowering the acquisition price (tap the Ask chip above) to find your maximum viable offer.
          </p>
        </div>
      )}

      {/* ── Zoning envelope summary ──────────────────────────────────────── */}
      <div className="mt-3 px-1 flex items-start gap-2">
        <Scale size={12} className="text-gray-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          <strong className="text-gray-700 dark:text-gray-300">{env.zoningCode}</strong>
          {env.codeSection ? <> · {env.codeSection}</> : <> · not in registry (generic parsing)</>}
          {env.minLotSqft ? <> · min lot {env.minLotSqft.toLocaleString()} sqft</> : null}
          {" "}· up to <strong>{env.maxLots} lot{env.maxLots > 1 ? "s" : ""}</strong>, <strong>{env.maxUnitsPerLot} units/lot</strong>, <strong>{env.maxAdusPerLot} ADUs</strong>
          {env.verified === "unverified" && <span className="text-orange-500 font-semibold"> · UNVERIFIED zone data</span>}
        </p>
      </div>

      {/* ── Exit filter ──────────────────────────────────────────────────── */}
      {report.scenarios.length > 0 && (
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl mt-4 mb-3">
          {([
            { key: "all", label: "All exits", icon: TrendingUp },
            { key: "sell", label: "Build & sell", icon: CircleDollarSign },
            { key: "hold", label: "Hold & rent", icon: Clock },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setExitFilter(key)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                exitFilter === key
                  ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Ranked scenarios ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        {filtered.map((s, i) => (
          <ScenarioCard key={s.id} s={s} rank={i + 1} />
        ))}
        {filtered.length === 0 && report.scenarios.length > 0 && (
          <p className="text-xs text-gray-400 text-center py-3">No {exitFilter === "hold" ? "hold" : "sell"} scenarios at medium+ confidence.</p>
        )}
      </div>

      {/* ── Long shots (low confidence) ──────────────────────────────────── */}
      {report.longShots.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowLongShots(!showLongShots)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-dashed border-gray-200 dark:border-slate-700 rounded-2xl text-xs font-medium text-gray-500">
            <span>{report.longShots.length} low-confidence idea{report.longShots.length > 1 ? "s" : ""} (verify before pursuing)</span>
            {showLongShots ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showLongShots && (
            <div className="space-y-2 mt-2">
              {report.longShots.map((s, i) => (
                <ScenarioCard key={s.id} s={s} rank={report.scenarios.length + i + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
