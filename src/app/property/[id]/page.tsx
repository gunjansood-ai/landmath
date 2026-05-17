"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Scissors,
  Home,
  Wrench,
  XCircle,
  Share2,
  CheckCircle2,
  AlertTriangle,
  Ban,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ShieldCheck,
  Info,
  AlertOctagon,
  Rows3,
  Star,
  RefreshCw,
  Pencil,
} from "lucide-react";
import Navigation from "@/components/Navigation";
import DealNarrator from "@/components/DealNarrator";
import PermitRadar from "@/components/PermitRadar";
import LenderReport from "@/components/LenderReport";
import DownloadReportButton from "@/components/DownloadReportButton";
import FeasibilityReasoningModal from "@/components/FeasibilityReasoningModal";
import {
  useStore,
  Strategy,
  QualityTier,
  FinancingConfig,
  PropertyData,
  AnalysisResult,
  TownhomeInputs,
  MultiFamilyInputs,
  MFExitType,
  DEFAULT_TOWNHOME_INPUTS,
  DEFAULT_MF_INPUTS,
} from "@/store/useStore";
import {
  analyzeAllStrategies,
  formatCurrency,
  formatPercent,
  STRATEGIES,
  QUALITY_TIERS,
  getDefaultSellPricePerSqft,
  StrategyOverrides,
  calculateTownhomeAnalysis,
  calculateMultiFamilyAnalysis,
  getMarketRentDefaults,
} from "@/lib/calculations";
import type { TypologyBucket } from "@/lib/buildability";

// ─── Icons ───────────────────────────────────────────────────────────────────

const strategyIcons: Record<Strategy, React.ReactNode> = {
  fresh_build: <Building2 size={18} />,
  split_build: <Scissors size={18} />,
  main_adu: <Home size={18} />,
  flip_fix: <Wrench size={18} />,
  townhome: <Rows3 size={18} />,
  multifamily: <Building2 size={18} />,
  pass: <XCircle size={18} />,
};

const STRATEGY_ORDER: Strategy[] = [
  "fresh_build",
  "split_build",
  "main_adu",
  "flip_fix",
  "townhome",
  "multifamily",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// feasibilityBadge replaced by FeasibilityReasoningModal component

function confidenceChip(score?: number, label?: string) {
  if (typeof score !== "number") return null;
  const tone =
    score >= 85
      ? "bg-green-50 text-green-700 border-green-200"
      : score >= 65
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : score >= 40
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-medium border ${tone} px-2 py-0.5 rounded-full`}
      title={`Confidence: ${score}/100`}
    >
      <ShieldCheck size={10} /> {label ?? "—"} · {score}
    </span>
  );
}

function caveatIcon(sev: "info" | "warning" | "block") {
  if (sev === "block") return <AlertOctagon size={12} className="text-red-500 flex-shrink-0 mt-0.5" />;
  if (sev === "warning") return <AlertTriangle size={12} className="text-amber-500 flex-shrink-0 mt-0.5" />;
  return <Info size={12} className="text-blue-500 flex-shrink-0 mt-0.5" />;
}

function caveatTone(sev: "info" | "warning" | "block") {
  if (sev === "block") return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40 text-red-900 dark:text-red-300";
  if (sev === "warning") return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-300";
  return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40 text-blue-900 dark:text-blue-300";
}

function formatSaleDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

const TYPOLOGY_LABELS: Record<TypologyBucket, string> = {
  sfr: "Single-family", sfr_with_adu: "SFR + ADU", duplex: "Duplex",
  triplex: "Triplex", fourplex: "Fourplex", five_plus: "5+ units",
  condo: "Condo", other: "Other",
};
const TYPOLOGY_COLORS: Record<TypologyBucket, string> = {
  sfr: "bg-green-500", sfr_with_adu: "bg-emerald-500", duplex: "bg-blue-500",
  triplex: "bg-indigo-500", fourplex: "bg-violet-500", five_plus: "bg-purple-500",
  condo: "bg-pink-500", other: "bg-gray-400",
};

// ─── Number input helper ──────────────────────────────────────────────────────

function NumInput({
  label,
  value,
  onChange,
  prefix,
  suffix,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  step?: number;
}) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  const commit = () => {
    const n = parseFloat(local.replace(/[^0-9.]/g, ""));
    if (!isNaN(n) && n >= min) onChange(n);
    else setLocal(String(value));
  };
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-700/60 last:border-0">
      <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-[11px] text-gray-400">{prefix}</span>}
        <input
          type="number"
          inputMode="numeric"
          value={local}
          min={min}
          step={step}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="w-24 text-right px-2 py-1 text-xs font-semibold bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        {suffix && <span className="text-[11px] text-gray-400">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── Strategy Rail Pill ───────────────────────────────────────────────────────

function StrategyPill({
  strategy,
  analysis,
  isActive,
  isBest,
  onClick,
}: {
  strategy: Strategy;
  analysis: AnalysisResult | null;
  isActive: boolean;
  isBest: boolean;
  onClick: () => void;
}) {
  const feasible = analysis && analysis.feasibility !== "not_allowed";
  const metric = analysis
    ? analysis.exitType === "rent"
      ? `${analysis.capRate?.toFixed(1) ?? "—"}% cap`
      : analysis.profit > 0
      ? `+${formatPercent(analysis.roi)}`
      : "—"
    : null;

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
        isActive
          ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-sm"
          : feasible
          ? "bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-400"
          : "bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700/50 text-gray-400 dark:text-gray-600"
      }`}
    >
      {isBest && !isActive && (
        <Star size={10} className="text-green-500 fill-green-500 flex-shrink-0" />
      )}
      <span className={`text-base leading-none ${isActive ? "" : feasible ? "" : "opacity-50"}`}>
        {strategy === "townhome" ? "🏘" : strategy === "multifamily" ? "🏢" : ""}
      </span>
      <span className="whitespace-nowrap">{STRATEGIES[strategy].label}</span>
      {metric && (
        <span
          className={`text-[10px] font-bold ${
            isActive
              ? "text-green-400 dark:text-green-500"
              : analysis?.profit && analysis.profit > 0
              ? "text-green-600"
              : "text-gray-400"
          }`}
        >
          {metric}
        </span>
      )}
    </button>
  );
}

// ─── Existing Strategy Detail Card ────────────────────────────────────────────

function ExistingStrategyDetail({
  analysis,
  isBest,
  override,
  onCommitOverride,
  onResetOverride,
  defaultSellPpsf,
  defaultSellSource,
  defaultSellHint,
  redfinUrl,
}: {
  analysis: AnalysisResult;
  isBest: boolean;
  override?: StrategyOverrides;
  onCommitOverride: (field: "buildSqft" | "sellPricePerSqft", v: number | undefined) => void;
  onResetOverride: () => void;
  defaultSellPpsf: number;
  defaultSellSource: "neighborhood" | "wa_fallback";
  defaultSellHint: string;
  redfinUrl: string;
}) {
  const [localBuildSqft, setLocalBuildSqft] = useState(
    String(override?.buildSqft ?? analysis.buildSqft)
  );
  const [localSellPpsf, setLocalSellPpsf] = useState(
    String(override?.sellPricePerSqft ?? defaultSellPpsf)
  );

  const commitBuild = () => {
    const v = Math.round(Number(localBuildSqft));
    onCommitOverride("buildSqft", v > 0 ? v : undefined);
  };
  const commitSell = () => {
    const v = Math.round(Number(localSellPpsf));
    onCommitOverride("sellPricePerSqft", v > 0 ? v : undefined);
  };

  return (
    <div className={`bg-white dark:bg-slate-800 border-2 rounded-2xl overflow-hidden ${
      isBest ? "border-green-500 shadow-lg shadow-green-500/10" : "border-gray-200 dark:border-slate-600"
    }`}>
      <div className="p-5">
        {isBest && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full mb-3">
            <TrendingUp size={10} /> Best Option
          </div>
        )}

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isBest ? "bg-green-100 dark:bg-green-900/40 text-green-600" : "bg-gray-100 dark:bg-slate-700 text-gray-500"
            }`}>
              {strategyIcons[analysis.strategy]}
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                {STRATEGIES[analysis.strategy].label}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {STRATEGIES[analysis.strategy].tagline}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <FeasibilityReasoningModal analysis={analysis} />
            {confidenceChip(analysis.confidence, analysis.confidenceLabel)}
          </div>
        </div>

        {/* Hero metrics */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Profit</p>
            <p className={`text-xl font-bold ${analysis.profit > 0 ? "text-green-600" : "text-red-500"}`}>
              {formatCurrency(analysis.profit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">ROI</p>
            <p className={`text-xl font-bold ${analysis.roi > 15 ? "text-green-600" : analysis.roi > 0 ? "text-amber-600" : "text-red-500"}`}>
              {formatPercent(analysis.roi)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Timeline</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{analysis.timelineMonths}mo</p>
          </div>
        </div>

        {/* Caveats */}
        {analysis.caveats && analysis.caveats.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {analysis.caveats.slice(0, 3).map((c, i) => (
              <div key={i} className={`flex items-start gap-2 text-[11px] leading-relaxed border rounded-lg px-2.5 py-1.5 ${caveatTone(c.severity)}`}>
                {caveatIcon(c.severity)}
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Per-strategy overrides */}
        <div className="p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl space-y-2 mb-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Build</label>
              <input
                type="number" inputMode="numeric"
                value={localBuildSqft}
                onChange={(e) => setLocalBuildSqft(e.target.value)}
                onBlur={commitBuild}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="w-20 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white text-right"
              />
              <span className="text-[10px] text-gray-400">sqft</span>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Sell</label>
              <span className="text-[10px] text-gray-400">$</span>
              <input
                type="number" inputMode="numeric"
                value={localSellPpsf}
                onChange={(e) => setLocalSellPpsf(e.target.value)}
                onBlur={commitSell}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="w-20 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white text-right"
              />
              <span className="text-[10px] text-gray-400">/sqft</span>
              <a href={redfinUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 underline">
                Redfin <ExternalLink size={9} />
              </a>
            </div>
            {(override?.buildSqft || override?.sellPricePerSqft) && (
              <button onClick={() => { onResetOverride(); setLocalBuildSqft(String(analysis.buildSqft)); setLocalSellPpsf(String(defaultSellPpsf)); }}
                className="text-[10px] text-gray-400 hover:text-red-500 underline ml-auto">
                Reset
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 leading-snug">
            Default sell: <span className="font-medium text-gray-600 dark:text-gray-400">${defaultSellPpsf}/sqft</span>{" "}
            <span className={defaultSellSource === "neighborhood" ? "text-emerald-600" : "text-amber-600"}>
              ({defaultSellHint})
            </span>
          </p>
        </div>

        {/* Timeline bar */}
        <div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
            <div className="bg-amber-400 rounded-l-full"
              style={{ width: `${(analysis.permitMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Permit: ${analysis.permitMonths}mo`} />
            <div className="bg-blue-400"
              style={{ width: `${(analysis.buildMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Build: ${analysis.buildMonths}mo`} />
            <div className="bg-green-400 rounded-r-full"
              style={{ width: `${(analysis.sellMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Sell: ${analysis.sellMonths}mo`} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
            <span>Permit ({analysis.permitMonths}mo)</span>
            <span>Build ({analysis.buildMonths}mo)</span>
            <span>Sell ({analysis.sellMonths}mo)</span>
          </div>
        </div>

        {/* Full breakdown */}
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 space-y-2 text-sm">
          {[
            ["Build Area", `${analysis.buildSqft.toLocaleString()} sqft`],
            ["Acquisition", formatCurrency(analysis.acquisitionCost)],
            ["Construction", formatCurrency(analysis.constructionCost)],
            [`Holding (${analysis.timelineMonths}mo)`, formatCurrency(analysis.totalHoldingCost)],
            ["Selling Costs", formatCurrency(analysis.sellingCosts)],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-900 dark:text-white">{val}</span>
            </div>
          ))}
          <div className="flex justify-between text-xs font-bold pt-2 border-t border-gray-100 dark:border-slate-700">
            <span className="text-gray-700 dark:text-gray-300">Total Cost</span>
            <span className="text-gray-900 dark:text-white">{formatCurrency(analysis.totalProjectCost)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Expected Sale</span>
            <span className="font-bold text-green-600">{formatCurrency(analysis.expectedSalePrice)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Annualized ROI</span>
            <span className="font-bold text-gray-900 dark:text-white">{formatPercent(analysis.annualizedRoi)}</span>
          </div>
          <div className="mt-2 p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
            <p className="text-xs text-gray-600 dark:text-gray-300">{analysis.recommendation}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Townhome Detail Card ─────────────────────────────────────────────────────

function TownhomeDetail({
  property,
  inputs,
  onInputChange,
  analysis,
  isBest,
}: {
  property: PropertyData;
  inputs: TownhomeInputs;
  onInputChange: (updates: Partial<TownhomeInputs>) => void;
  analysis: AnalysisResult;
  isBest: boolean;
}) {
  return (
    <div className={`bg-white dark:bg-slate-800 border-2 rounded-2xl overflow-hidden ${
      isBest ? "border-green-500 shadow-lg shadow-green-500/10" : "border-gray-200 dark:border-slate-600"
    }`}>
      <div className="p-5">
        {isBest && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full mb-3">
            <TrendingUp size={10} /> Best Option
          </div>
        )}

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${isBest ? "bg-green-100 dark:bg-green-900/40" : "bg-gray-100 dark:bg-slate-700"}`}>
              🏘
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">Townhome / Row House</h3>
              <p className="text-[11px] text-gray-500">Build {inputs.unitCount} attached units, sell each</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <FeasibilityReasoningModal analysis={analysis} />
          </div>
        </div>

        {/* Hero metrics */}
        <div className="grid grid-cols-4 gap-2 mb-5">
          {[
            { label: "Profit", val: formatCurrency(analysis.profit), color: analysis.profit > 0 ? "text-green-600" : "text-red-500" },
            { label: "ROI", val: formatPercent(analysis.roi), color: analysis.roi > 15 ? "text-green-600" : analysis.roi > 0 ? "text-amber-600" : "text-red-500" },
            { label: "Per Unit", val: formatCurrency(analysis.profitPerUnit ?? 0), color: (analysis.profitPerUnit ?? 0) > 0 ? "text-green-600" : "text-red-500" },
            { label: "Timeline", val: `${analysis.timelineMonths}mo`, color: "text-gray-900 dark:text-white" },
          ].map(({ label, val, color }) => (
            <div key={label}>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{label}</p>
              <p className={`text-base font-bold ${color}`}>{val}</p>
            </div>
          ))}
        </div>

        {/* Inputs */}
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Unit Design</p>
          <NumInput label="Number of units" value={inputs.unitCount} min={2} onChange={(v) => onInputChange({ unitCount: Math.max(2, Math.round(v)) })} />
          <NumInput label="Avg unit size" value={inputs.avgUnitSqft} suffix="sqft" onChange={(v) => onInputChange({ avgUnitSqft: v })} />
          <NumInput label="Sale price / unit" value={inputs.salePricePerUnit} prefix="$" onChange={(v) => onInputChange({ salePricePerUnit: v })} />
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2 mt-3">Extras</p>
          <NumInput label="HOA setup cost" value={inputs.hoaSetupCost} prefix="$" onChange={(v) => onInputChange({ hoaSetupCost: v })} />
          <NumInput label="Shared infra (drive, utilities)" value={inputs.sharedInfraCost} prefix="$" onChange={(v) => onInputChange({ sharedInfraCost: v })} />
        </div>

        {/* Cost breakdown */}
        <div className="space-y-1.5 text-xs mb-4">
          {[
            ["Land (acquisition)", formatCurrency(analysis.acquisitionCost)],
            ["Construction", formatCurrency(analysis.constructionCost)],
            [`Holding (${analysis.timelineMonths}mo)`, formatCurrency(analysis.totalHoldingCost)],
            ["Selling costs", formatCurrency(analysis.sellingCosts)],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between">
              <span className="text-gray-500">{label}</span>
              <span className="font-medium text-gray-900 dark:text-white">{val}</span>
            </div>
          ))}
          <div className="flex justify-between font-bold pt-1.5 border-t border-gray-100 dark:border-slate-700">
            <span className="text-gray-700 dark:text-gray-300">Total Cost</span>
            <span>{formatCurrency(analysis.totalProjectCost)}</span>
          </div>
          <div className="flex justify-between text-green-600 font-bold">
            <span>Total Revenue</span>
            <span>{formatCurrency(analysis.expectedSalePrice)}</span>
          </div>
        </div>

        {/* Timeline bar */}
        <div>
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
            <div className="bg-amber-400 rounded-l-full" style={{ width: `${(analysis.permitMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }} />
            <div className="bg-blue-400" style={{ width: `${(analysis.buildMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }} />
            <div className="bg-green-400 rounded-r-full" style={{ width: `${(analysis.sellMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
            <span>Permit ({analysis.permitMonths}mo)</span>
            <span>Build ({analysis.buildMonths}mo)</span>
            <span>Sell ({analysis.sellMonths}mo)</span>
          </div>
        </div>

        <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
          <p className="text-xs text-gray-600 dark:text-gray-300">{analysis.recommendation}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Multi-Family Detail Card ─────────────────────────────────────────────────

function MultiFamilyDetail({
  property,
  inputs,
  onInputChange,
  analysis,
  isBest,
  rentCompsLoading,
  onFetchRentComps,
  rentCompsSource,
}: {
  property: PropertyData;
  inputs: MultiFamilyInputs;
  onInputChange: (updates: Partial<MultiFamilyInputs>) => void;
  analysis: AnalysisResult;
  isBest: boolean;
  rentCompsLoading: boolean;
  onFetchRentComps: () => void;
  rentCompsSource: "apillow" | "zip" | "national" | null;
}) {
  const totalUnits = inputs.studioCount + inputs.oneBrCount + inputs.twoBrCount;
  const isRent = inputs.exitType === "rent";

  return (
    <div className={`bg-white dark:bg-slate-800 border-2 rounded-2xl overflow-hidden ${
      isBest ? "border-green-500 shadow-lg shadow-green-500/10" : "border-blue-400 dark:border-blue-600"
    }`}>
      <div className="p-5">
        {isBest && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full mb-3">
            <TrendingUp size={10} /> Best Option
          </div>
        )}

        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg bg-blue-50 dark:bg-blue-900/30">🏢</div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">Multi-Family</h3>
              <p className="text-[11px] text-gray-500">{totalUnits} units · {isRent ? "hold & rent" : "condo conversion"}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <FeasibilityReasoningModal analysis={analysis} />
          </div>
        </div>

        {/* Hero metrics — different for rent vs sell */}
        {isRent ? (
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { label: "NOI / yr", val: formatCurrency(analysis.noi ?? 0), color: (analysis.noi ?? 0) > 0 ? "text-blue-600" : "text-red-500" },
              { label: "Cap Rate", val: `${analysis.capRate?.toFixed(1) ?? "—"}%`, color: (analysis.capRate ?? 0) >= 6 ? "text-blue-600" : "text-amber-600" },
              { label: "GRM", val: `${analysis.grm?.toFixed(1) ?? "—"}×`, color: "text-gray-900 dark:text-white" },
              { label: "Cash-on-Cash", val: `${analysis.cashOnCash?.toFixed(1) ?? "—"}%`, color: (analysis.cashOnCash ?? 0) > 8 ? "text-blue-600" : "text-amber-600" },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{label}</p>
                <p className={`text-base font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 mb-5">
            {[
              { label: "Profit", val: formatCurrency(analysis.profit), color: analysis.profit > 0 ? "text-green-600" : "text-red-500" },
              { label: "ROI", val: formatPercent(analysis.roi), color: analysis.roi > 15 ? "text-green-600" : "text-amber-600" },
              { label: "Per Unit", val: formatCurrency(analysis.profitPerUnit ?? 0), color: (analysis.profitPerUnit ?? 0) > 0 ? "text-green-600" : "text-red-500" },
              { label: "Timeline", val: `${analysis.timelineMonths}mo`, color: "text-gray-900 dark:text-white" },
            ].map(({ label, val, color }) => (
              <div key={label}>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{label}</p>
                <p className={`text-base font-bold ${color}`}>{val}</p>
              </div>
            ))}
          </div>
        )}

        {/* Step 1 — Exit type toggle */}
        <div className="mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Step 1 — Exit Strategy</p>
          <div className="grid grid-cols-2 gap-2">
            {(["rent", "sell"] as MFExitType[]).map((et) => (
              <button
                key={et}
                onClick={() => onInputChange({ exitType: et })}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  inputs.exitType === et
                    ? et === "rent"
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-green-500 bg-green-50 dark:bg-green-900/20"
                    : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 opacity-60"
                }`}
              >
                <div className="text-sm font-bold text-gray-900 dark:text-white mb-0.5">
                  {et === "rent" ? "🏠 Hold & Rent" : "💰 Condo Sell"}
                </div>
                <div className="text-[10px] text-gray-500">
                  {et === "rent" ? "NOI · Cap Rate · Cash-on-Cash" : "Profit per unit · Margin · ROI"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 — Unit mix */}
        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Step 2 — Unit Mix</p>
          <NumInput label="Studio units" value={inputs.studioCount} min={0} onChange={(v) => onInputChange({ studioCount: Math.max(0, Math.round(v)) })} />
          <NumInput label="1-BR units" value={inputs.oneBrCount} min={0} onChange={(v) => onInputChange({ oneBrCount: Math.max(0, Math.round(v)) })} />
          <NumInput label="2-BR units" value={inputs.twoBrCount} min={0} onChange={(v) => onInputChange({ twoBrCount: Math.max(0, Math.round(v)) })} />
          <NumInput label="Avg unit size" value={inputs.avgUnitSqft} suffix="sqft" onChange={(v) => onInputChange({ avgUnitSqft: v })} />
          <p className="text-[10px] text-gray-400 mt-2">Total: {totalUnits} units · {(totalUnits * inputs.avgUnitSqft).toLocaleString()} sqft</p>
        </div>

        {/* Step 3 — Rents (rent exit only) or sale price (sell exit) */}
        {isRent ? (
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Step 3 — Monthly Rents</p>
              <div className="flex items-center gap-2">
                {rentCompsSource && (
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                    rentCompsSource === "apillow"
                      ? "text-blue-600 bg-blue-50 dark:bg-blue-900/30"
                      : rentCompsSource === "zip"
                      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30"
                      : "text-gray-500 bg-gray-100 dark:bg-slate-700"
                  }`}>
                    {rentCompsSource === "apillow" ? "Live · APIllow" : rentCompsSource === "zip" ? "ZIP estimate" : "National avg"}
                  </span>
                )}
                <button
                  onClick={onFetchRentComps}
                  disabled={rentCompsLoading}
                  className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-blue-600 transition-colors"
                  title="Refresh rent comps from APIllow"
                >
                  <RefreshCw size={11} className={rentCompsLoading ? "animate-spin" : ""} />
                  {rentCompsLoading ? "Fetching…" : "Refresh"}
                </button>
              </div>
            </div>
            {inputs.studioCount > 0 && (
              <NumInput label="Studio rent / mo" value={inputs.studioRent} prefix="$" onChange={(v) => onInputChange({ studioRent: v })} />
            )}
            <NumInput label="1-BR rent / mo" value={inputs.oneBrRent} prefix="$" onChange={(v) => onInputChange({ oneBrRent: v })} />
            <NumInput label="2-BR rent / mo" value={inputs.twoBrRent} prefix="$" onChange={(v) => onInputChange({ twoBrRent: v })} />
            <NumInput label="Vacancy rate" value={Math.round(inputs.vacancyRate * 100)} suffix="%" min={0} onChange={(v) => onInputChange({ vacancyRate: v / 100 })} />
            <NumInput label="Operating expense ratio" value={Math.round(inputs.operatingExpenseRatio * 100)} suffix="%" min={0} onChange={(v) => onInputChange({ operatingExpenseRatio: v / 100 })} />
          </div>
        ) : (
          <div className="bg-gray-50 dark:bg-slate-700/50 rounded-xl p-4 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Step 3 — Sale Pricing</p>
            <NumInput label="Sale price / unit" value={inputs.salePricePerUnit} prefix="$" onChange={(v) => onInputChange({ salePricePerUnit: v })} />
            <NumInput label="Condo conversion cost / unit" value={inputs.condoConversionCost} prefix="$" onChange={(v) => onInputChange({ condoConversionCost: v })} />
          </div>
        )}

        {/* Results grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {isRent ? (
            <>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                <p className="text-[10px] text-blue-500 font-medium uppercase">Gross Rent / yr</p>
                <p className="text-sm font-bold text-blue-900 dark:text-blue-200">{formatCurrency(analysis.grossRentalIncome ?? 0)}</p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                <p className="text-[10px] text-blue-500 font-medium uppercase">EGI (after vacancy)</p>
                <p className="text-sm font-bold text-blue-900 dark:text-blue-200">{formatCurrency(analysis.effectiveGrossIncome ?? 0)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                <p className="text-[10px] text-green-600 font-medium uppercase">NOI / yr</p>
                <p className="text-sm font-bold text-green-900 dark:text-green-200">{formatCurrency(analysis.noi ?? 0)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 font-medium uppercase">Break-even Occ.</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{analysis.breakEvenOccupancy?.toFixed(1) ?? "—"}%</p>
              </div>
            </>
          ) : (
            <>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                <p className="text-[10px] text-green-600 font-medium uppercase">Total Revenue</p>
                <p className="text-sm font-bold text-green-900 dark:text-green-200">{formatCurrency(analysis.expectedSalePrice)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3">
                <p className="text-[10px] text-green-600 font-medium uppercase">Net Profit</p>
                <p className="text-sm font-bold text-green-900 dark:text-green-200">{formatCurrency(analysis.profit)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 font-medium uppercase">Total Cost</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(analysis.totalProjectCost)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-3">
                <p className="text-[10px] text-gray-500 font-medium uppercase">Cost / Unit</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(analysis.costPerUnit ?? 0)}</p>
              </div>
            </>
          )}
        </div>

        <div className="p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
          <p className="text-xs text-gray-600 dark:text-gray-300">{analysis.recommendation}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Editable Ask Price chip ──────────────────────────────────────────────────

const PRICE_SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  apillow_listing: { label: "Live listing", color: "text-green-600 dark:text-green-400" },
  apillow_zestimate: { label: "Zestimate", color: "text-blue-500 dark:text-blue-400" },
  neighborhood_median: { label: "Comp median", color: "text-amber-600 dark:text-amber-400" },
  appraised: { label: "Assessed", color: "text-amber-600 dark:text-amber-400" },
  estimate: { label: "Estimate", color: "text-gray-400" },
};

function AskPriceChip({
  listingPrice,
  priceSource,
  override,
  onOverride,
}: {
  listingPrice: number;
  priceSource?: string;
  override?: number;
  onOverride: (v: number | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const displayPrice = override ?? listingPrice;
  const isOverridden = override !== undefined && override !== listingPrice;
  const srcKey = priceSource ?? "estimate";
  const srcMeta = PRICE_SOURCE_LABELS[srcKey] ?? PRICE_SOURCE_LABELS.estimate;

  function startEdit() {
    setRaw(String(Math.round(displayPrice / 1000)));
    setEditing(true);
  }

  function commit() {
    const k = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (!isNaN(k) && k > 0) {
      const dollars = Math.round(k * 1000);
      onOverride(dollars === listingPrice ? undefined : dollars);
    }
    setEditing(false);
  }

  return (
    <div
      className={`flex-shrink-0 bg-white dark:bg-slate-800 border rounded-xl px-3 py-2 cursor-pointer group ${
        isOverridden
          ? "border-blue-400 dark:border-blue-500"
          : "border-gray-100 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600"
      }`}
      onClick={() => !editing && startEdit()}
      title="Click to override ask price"
    >
      <div className="flex items-center gap-1">
        <p className="text-[10px] text-gray-400">Ask</p>
        {!editing && (
          <span className={`text-[9px] font-medium ${isOverridden ? "text-blue-500" : srcMeta.color}`}>
            {isOverridden ? "edited" : srcMeta.label}
          </span>
        )}
      </div>
      {editing ? (
        <div className="flex items-center gap-0.5">
          <span className="text-xs text-gray-400">$</span>
          <input
            ref={inputRef}
            type="number"
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
            className="w-16 text-xs font-bold bg-transparent text-gray-900 dark:text-white outline-none"
            placeholder="850"
          />
          <span className="text-xs text-gray-400">K</span>
        </div>
      ) : (
        <p className="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-1">
          ${(displayPrice / 1000).toFixed(0)}K
          <Pencil size={9} className="text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors" />
        </p>
      )}
      {isOverridden && (
        <button
          onClick={(e) => { e.stopPropagation(); onOverride(undefined); }}
          className="text-[9px] text-blue-400 hover:text-blue-600 leading-none mt-0.5"
        >
          reset
        </button>
      )}
    </div>
  );
}

// ─── Accordion wrapper ────────────────────────────────────────────────────────

function Accordion({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{label}</span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100 dark:border-slate-700 pt-4">{children}</div>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const tierLabels: QualityTier[] = ["standard", "premium", "luxury", "ultra_luxury"];

export default function PropertyAnalysis() {
  const router = useRouter();
  const property = useStore((s) => s.currentProperty);
  const settings = useStore((s) => s.settings);
  const saveAnalysis = useStore((s) => s.saveAnalysis);
  const setCurrentAnalyses = useStore((s) => s.setCurrentAnalyses);
  const setRecommendedStrategy = useStore((s) => s.setRecommendedStrategy);

  const [qualityTier, setQualityTier] = useState<QualityTier>(settings.defaultQualityTier);
  const [costPerSqft, setCostPerSqft] = useState(settings.customCostPerSqft[settings.defaultQualityTier]);
  const [financing, setFinancing] = useState<FinancingConfig>({
    type: settings.defaultFinancingType,
    downPaymentPct: settings.defaultDownPaymentPct,
    interestRate: settings.defaultInterestRate,
    loanTermYears: 30,
    points: 0,
  });
  const [listPriceOverride, setListPriceOverride] = useState<number | undefined>(undefined);
  const [strategyOverrides, setStrategyOverrides] = useState<Partial<Record<Strategy, StrategyOverrides>>>({});
  const [aiNarrative, setAiNarrative] = useState<string>("");
  const [showComps, setShowComps] = useState(false);

  // New strategy inputs — seed MF rents from ZIP table immediately so the form
  // is never blank, then override with APIllow data when it loads.
  const [townhomeInputs, setTownhomeInputs] = useState<TownhomeInputs>(DEFAULT_TOWNHOME_INPUTS);
  const [mfInputs, setMfInputs] = useState<MultiFamilyInputs>(() => {
    const rentDefaults = getMarketRentDefaults(property?.zip);
    return { ...DEFAULT_MF_INPUTS, ...rentDefaults };
  });
  const [rentCompsLoading, setRentCompsLoading] = useState(false);
  const [rentCompsSource, setRentCompsSource] = useState<"apillow" | "zip" | "national" | null>(() => {
    const d = getMarketRentDefaults(property?.zip);
    return d.source; // "zip" or "national" — shown immediately, upgraded to "apillow" if fetch succeeds
  });

  // Active strategy (which pill is focused)
  const [activeStrategy, setActiveStrategy] = useState<Strategy>("fresh_build");
  const [hasSetInitialStrategy, setHasSetInitialStrategy] = useState(false);

  const handleTierChange = (tier: QualityTier) => {
    setQualityTier(tier);
    setCostPerSqft(settings.customCostPerSqft[tier]);
  };

  const effectiveProperty: PropertyData | null = useMemo(() => {
    if (!property) return null;
    if (listPriceOverride === undefined || listPriceOverride === property.listingPrice) return property;
    return { ...property, listingPrice: listPriceOverride };
  }, [property, listPriceOverride]);

  // Core 4 strategies
  const { analyses: coreAnalyses, recommended } = useMemo(() => {
    if (!effectiveProperty) return { analyses: [], recommended: "pass" as Strategy };
    return analyzeAllStrategies(effectiveProperty, qualityTier, costPerSqft, financing, strategyOverrides);
  }, [effectiveProperty, qualityTier, costPerSqft, financing, strategyOverrides]);

  // Townhome analysis
  const townhomeAnalysis = useMemo(() => {
    if (!effectiveProperty) return null;
    return calculateTownhomeAnalysis(effectiveProperty, townhomeInputs, qualityTier, costPerSqft, financing);
  }, [effectiveProperty, townhomeInputs, qualityTier, costPerSqft, financing]);

  // Multi-family analysis
  const mfAnalysis = useMemo(() => {
    if (!effectiveProperty) return null;
    return calculateMultiFamilyAnalysis(effectiveProperty, mfInputs, qualityTier, costPerSqft, financing);
  }, [effectiveProperty, mfInputs, qualityTier, costPerSqft, financing]);

  // Combined results keyed by strategy
  const allResults = useMemo<Partial<Record<Strategy, AnalysisResult>>>(() => {
    const map: Partial<Record<Strategy, AnalysisResult>> = {};
    for (const a of coreAnalyses) map[a.strategy] = a;
    if (townhomeAnalysis) map.townhome = townhomeAnalysis;
    if (mfAnalysis) map.multifamily = mfAnalysis;
    return map;
  }, [coreAnalyses, townhomeAnalysis, mfAnalysis]);

  // Set initial active strategy to recommended once computed
  useEffect(() => {
    if (!hasSetInitialStrategy && recommended && recommended !== "pass") {
      setActiveStrategy(recommended);
      setHasSetInitialStrategy(true);
    }
  }, [recommended, hasSetInitialStrategy]);

  // Save to store
  useEffect(() => {
    if (coreAnalyses.length > 0) {
      setCurrentAnalyses(coreAnalyses);
      setRecommendedStrategy(recommended);
      const best = coreAnalyses.find((a) => a.strategy === recommended);
      if (best) saveAnalysis(best);
    }
  }, [coreAnalyses, recommended, setCurrentAnalyses, setRecommendedStrategy, saveAnalysis]);

  // Fetch rent comps from APIllow
  const fetchRentComps = useCallback(async () => {
    if (!effectiveProperty) return;
    setRentCompsLoading(true);
    try {
      const params = new URLSearchParams({
        ...(effectiveProperty.zip ? { zip: effectiveProperty.zip } : {}),
        ...(effectiveProperty.city ? { city: effectiveProperty.city } : {}),
      });
      const res = await fetch(`/api/rent-comps?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.studioRent || data.oneBrRent || data.twoBrRent) {
        setMfInputs((prev) => ({
          ...prev,
          ...(data.studioRent ? { studioRent: data.studioRent } : {}),
          ...(data.oneBrRent ? { oneBrRent: data.oneBrRent } : {}),
          ...(data.twoBrRent ? { twoBrRent: data.twoBrRent } : {}),
        }));
        setRentCompsSource("apillow");
      }
    } catch {
      // silently fail — user can enter manually
    } finally {
      setRentCompsLoading(false);
    }
  }, [effectiveProperty]);

  // Rent comps are pre-seeded from ZIP table; user refreshes manually via APIllow button.

  const updateOverride = (strategy: Strategy, field: keyof StrategyOverrides, value: number | undefined) => {
    setStrategyOverrides((prev) => ({ ...prev, [strategy]: { ...prev[strategy], [field]: value } }));
  };

  const getRedfin = () => {
    if (!property) return "#";
    const city = property.city.toLowerCase().replace(/\s+/g, "-");
    return `https://www.redfin.com/city/${city}-${property.state.toUpperCase()}/filter/sort=lo-days,property-type=house,status=sold-3mo`;
  };

  if (!property) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">No property selected</p>
            <button onClick={() => router.push("/")} className="px-4 py-2 bg-green-600 text-white rounded-lg">
              Go to Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleShare = async () => {
    const best = coreAnalyses.find((a) => a.strategy === recommended);
    if (!best) return;
    const text = `LandMath Analysis: ${property.address}\n\nRecommended: ${STRATEGIES[recommended].label}\nProfit: ${formatCurrency(best.profit)}\nROI: ${formatPercent(best.roi)}\nTimeline: ${best.timelineMonths} months\n\n${best.recommendation}`;
    if (navigator.share) {
      await navigator.share({ title: `LandMath: ${property.address}`, text });
    } else {
      await navigator.clipboard.writeText(text);
      alert("Report copied to clipboard!");
    }
  };

  const activeAnalysis = allResults[activeStrategy] ?? null;
  const isBest = activeStrategy === recommended && (activeAnalysis?.profit ?? 0) > 0;

  // Sell price hint for core strategies
  const getSellInfo = (strategy: Strategy) => {
    if (!effectiveProperty || ["townhome", "multifamily", "pass"].includes(strategy)) return null;
    return getDefaultSellPricePerSqft(effectiveProperty, qualityTier, strategy as Strategy);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Navigation />

      <main className="flex-1 px-4 py-6 pb-28 md:pb-8 max-w-3xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/")} className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg">
              <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-base font-bold text-gray-900 dark:text-white leading-tight">{property.address}</h1>
              <p className="text-xs text-gray-500">{property.city}, {property.state} {property.zip} · {property.county} Co.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DownloadReportButton address={property.address} />
            <button onClick={handleShare} className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50">
              <Share2 size={14} /> Share
            </button>
          </div>
        </div>

        {/* Property stats bar */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-5 pb-1">
          {/* Ask price — editable chip */}
          <AskPriceChip
            listingPrice={property.listingPrice}
            priceSource={property.priceSource}
            override={listPriceOverride}
            onOverride={setListPriceOverride}
          />
          {[
            { label: "Lot", value: `${property.lotSizeSqft.toLocaleString()} sqft` },
            { label: "Zone", value: property.zoningCode },
            { label: "Home", value: `${property.beds}bd/${property.baths}ba` },
            { label: "Built", value: property.yearBuilt.toString() },
          ].map((s) => (
            <div key={s.label} className="flex-shrink-0 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-400">{s.label}</p>
              <p className="text-xs font-bold text-gray-900 dark:text-white">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Non-KC banner */}
        {property.isKingCounty === false && (
          <div className="mb-5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-2xl p-4 flex items-start gap-3">
            <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 dark:text-blue-300 leading-relaxed">
              <strong>Limited data outside King County.</strong> Parcel GIS, typology chart, and assessor roll are KC-only.
              Pricing uses Nominatim + APIllow. Verify zoning with the local assessor before deciding.
            </p>
          </div>
        )}

        {/* ── Controls — Quality tier + Financing ────────────────────────────── */}
        <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-4 mb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 block">Construction Quality</label>
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl">
                {tierLabels.map((t) => (
                  <button key={t} onClick={() => handleTierChange(t)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      qualityTier === t ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}>
                    {QUALITY_TIERS[t].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-gray-500">Cost/sqft:</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                  <input type="number" value={costPerSqft} onChange={(e) => setCostPerSqft(Number(e.target.value))}
                    className="w-20 pl-5 pr-2 py-1 text-xs bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white" />
                </div>
                <span className="text-[11px] text-gray-400">/sqft</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 block">Financing</label>
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl mb-2">
                {(["traditional", "interest_only", "hard_money", "cash"] as const).map((ft) => (
                  <button key={ft} onClick={() => setFinancing({ ...financing, type: ft })}
                    className={`flex-1 px-1 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      financing.type === ft ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}>
                    {ft === "traditional" ? "30yr" : ft === "interest_only" ? "IO" : ft === "hard_money" ? "Hard$" : "Cash"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500">Down:</span>
                  <input type="number" value={financing.downPaymentPct}
                    onChange={(e) => setFinancing({ ...financing, downPaymentPct: Number(e.target.value) })}
                    className="w-14 px-2 py-1 text-xs bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white" />
                  <span className="text-[11px] text-gray-400">%</span>
                </div>
                {financing.type !== "cash" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-500">Rate:</span>
                    <input type="number" step="0.125" value={financing.interestRate}
                      onChange={(e) => setFinancing({ ...financing, interestRate: Number(e.target.value) })}
                      className="w-16 px-2 py-1 text-xs bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white" />
                    <span className="text-[11px] text-gray-400">%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Strategy Rail ──────────────────────────────────────────────────── */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-4 pb-1 -mx-4 px-4">
          {STRATEGY_ORDER.map((s) => (
            <StrategyPill
              key={s}
              strategy={s}
              analysis={allResults[s] ?? null}
              isActive={activeStrategy === s}
              isBest={s === recommended && (allResults[s]?.profit ?? 0) > 0}
              onClick={() => setActiveStrategy(s)}
            />
          ))}
        </div>

        {/* ── Active Strategy Detail ─────────────────────────────────────────── */}
        <div className="mb-5">
          {activeStrategy === "townhome" && townhomeAnalysis ? (
            <TownhomeDetail
              property={effectiveProperty!}
              inputs={townhomeInputs}
              onInputChange={(updates) => setTownhomeInputs((prev) => ({ ...prev, ...updates }))}
              analysis={townhomeAnalysis}
              isBest={isBest}
            />
          ) : activeStrategy === "multifamily" && mfAnalysis ? (
            <MultiFamilyDetail
              property={effectiveProperty!}
              inputs={mfInputs}
              onInputChange={(updates) => setMfInputs((prev) => ({ ...prev, ...updates }))}
              analysis={mfAnalysis}
              isBest={isBest}
              rentCompsLoading={rentCompsLoading}
              onFetchRentComps={fetchRentComps}
              rentCompsSource={rentCompsSource}
            />
          ) : activeAnalysis && activeStrategy !== "pass" ? (
            (() => {
              const sellInfo = getSellInfo(activeStrategy);
              const sourceLabel: Record<string, string> = {
                neighborhood_new: "new-construction comps",
                neighborhood_resale: "existing-home resale comps",
                neighborhood_all: "all nearby comps",
                zip_premium: `ZIP ${sellInfo?.zip ?? "?"} baseline`,
                flat_fallback: "national flat estimate",
              };
              const sellSource: "neighborhood" | "wa_fallback" =
                sellInfo?.source === "flat_fallback" ? "wa_fallback" : "neighborhood";
              const sellHint = sellInfo
                ? sellInfo.source === "flat_fallback"
                  ? sourceLabel.flat_fallback
                  : sellInfo.source === "zip_premium"
                  ? `ZIP ${sellInfo.zip ?? "?"} baseline × ${sellInfo.multiplier.toFixed(2)}×`
                  : `${sellInfo.compCount} ${sourceLabel[sellInfo.source]} @ $${sellInfo.neighborhoodMedianPpsf}/sqft median`
                : "—";
              return (
                <ExistingStrategyDetail
                  key={`${activeStrategy}-${qualityTier}`}
                  analysis={activeAnalysis}
                  isBest={isBest}
                  override={strategyOverrides[activeStrategy]}
                  onCommitOverride={(field, v) => updateOverride(activeStrategy, field, v)}
                  onResetOverride={() =>
                    setStrategyOverrides((prev) => {
                      const next = { ...prev };
                      delete next[activeStrategy];
                      return next;
                    })
                  }
                  defaultSellPpsf={sellInfo?.value ?? 425}
                  defaultSellSource={sellSource}
                  defaultSellHint={sellHint}
                  redfinUrl={getRedfin()}
                />
              );
            })()
          ) : null}
        </div>

        {/* ── Bottom recommendation banner ────────────────────────────────────── */}
        {recommended !== "pass" ? (
          <div className="bg-green-600 text-white rounded-2xl p-5 text-center mb-5">
            <p className="text-xs font-medium opacity-80 mb-1">LandMath Recommendation</p>
            <p className="text-xl font-bold mb-1">{STRATEGIES[recommended].label}</p>
            <p className="text-xs opacity-90 max-w-lg mx-auto">
              {coreAnalyses.find((a) => a.strategy === recommended)?.recommendation}
            </p>
          </div>
        ) : (
          <div className="bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-5 text-center mb-5">
            <XCircle size={28} className="mx-auto text-gray-400 mb-2" />
            <p className="font-bold text-gray-700 dark:text-gray-300">Pass on this property</p>
            <p className="text-xs text-gray-500 mt-1">The math doesn&apos;t work for any strategy at these numbers.</p>
          </div>
        )}

        {/* ── Context sections — accordions ─────────────────────────────────── */}
        <div className="space-y-3">

          {/* Neighborhood Context */}
          {property.neighborhood && (
            <Accordion label="🏘 Neighborhood Context">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Home size (recent sales)</p>
                  {property.neighborhood.medianHomeSqft ? (
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500 text-xs">Median</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{property.neighborhood.medianHomeSqft.toLocaleString()} sqft</span>
                      </div>
                      <div className="flex gap-3 text-xs text-gray-500">
                        <span>P25 {property.neighborhood.p25HomeSqft?.toLocaleString()} sqft</span>
                        <span>P75 {property.neighborhood.p75HomeSqft?.toLocaleString()} sqft</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">Living sqft not available for recent comps.</p>
                  )}
                </div>
                {property.isKingCounty !== false && property.neighborhood.typology.total > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Structure types nearby</p>
                    <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
                      {(Object.keys(property.neighborhood.typology.counts) as TypologyBucket[])
                        .filter((b) => property.neighborhood!.typology.counts[b] > 0)
                        .map((b) => (
                          <div key={b} className={TYPOLOGY_COLORS[b]}
                            style={{ width: `${property.neighborhood!.typology.shares[b] * 100}%` }}
                            title={`${TYPOLOGY_LABELS[b]}: ${(property.neighborhood!.typology.shares[b] * 100).toFixed(1)}%`} />
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {(Object.keys(property.neighborhood.typology.counts) as TypologyBucket[])
                        .filter((b) => property.neighborhood!.typology.counts[b] > 0)
                        .sort((a, b) => property.neighborhood!.typology.counts[b] - property.neighborhood!.typology.counts[a])
                        .map((b) => (
                          <span key={b} className="inline-flex items-center gap-1 text-[10px] text-gray-500">
                            <span className={`w-2 h-2 rounded-full ${TYPOLOGY_COLORS[b]}`} />
                            {TYPOLOGY_LABELS[b]} ({property.neighborhood!.typology.counts[b]})
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </Accordion>
          )}

          {/* Comparable sales */}
          {property.neighborhood && property.neighborhood.sales.length > 0 && (
            <Accordion label={`📋 Comparable Sales (${property.neighborhood.sales.length})`}>
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100 dark:border-slate-700">
                      <th className="py-2 pr-3 font-medium">Address</th>
                      <th className="py-2 pr-3 font-medium">Sold</th>
                      <th className="py-2 pr-3 font-medium text-right">Price</th>
                      <th className="py-2 pr-3 font-medium text-right">Sqft</th>
                      <th className="py-2 pr-3 font-medium text-right">$/sqft</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.neighborhood.sales.map((c) => (
                      <tr key={c.pin + c.saleDate} className="border-b border-gray-50 dark:border-slate-700/50 last:border-0">
                        <td className="py-2 pr-3">
                          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1">
                            {c.address} <ExternalLink size={9} />
                          </a>
                        </td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-gray-400">{formatSaleDate(c.saleDate)}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(c.salePrice)}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{c.sqftLiving ? c.sqftLiving.toLocaleString() : "—"}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{c.pricePerSqft ? `$${c.pricePerSqft}` : "—"}</td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white ${TYPOLOGY_COLORS[c.typology]}`}>
                            {TYPOLOGY_LABELS[c.typology]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Accordion>
          )}

          {/* AI Narrator */}
          {coreAnalyses.length > 0 && (
            <Accordion label="🤖 AI Deal Narrator">
              <DealNarrator
                analysis={coreAnalyses.find((a) => a.strategy === recommended) ?? coreAnalyses[0]}
                onNarrativeReady={(text) => setAiNarrative(text)}
              />
            </Accordion>
          )}

          {/* Permit Radar */}
          {property.lat && property.lng && (
            <Accordion label="🚧 Permit Radar">
              <PermitRadar lat={property.lat} lng={property.lng} address={property.address} city={property.city} />
            </Accordion>
          )}

        </div>

        {/* Hidden LenderReport for PDF */}
        {coreAnalyses.length > 0 && (() => {
          const bestAnalysis = coreAnalyses.find((a) => a.strategy === recommended) ?? coreAnalyses[0];
          return (
            <div style={{ position: "absolute", left: "-9999px", top: 0, pointerEvents: "none", zIndex: -1 }}>
              <LenderReport analysis={bestAnalysis} aiNarrative={aiNarrative || undefined} />
            </div>
          );
        })()}
      </main>
    </div>
  );
}
