"use client";

import { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore, Strategy, QualityTier, FinancingConfig, PropertyData, AnalysisResult } from "@/store/useStore";
import {
  analyzeAllStrategies,
  formatCurrency,
  formatPercent,
  STRATEGIES,
  QUALITY_TIERS,
  getDefaultSellPricePerSqft,
  StrategyOverrides,
} from "@/lib/calculations";
import type { TypologyBucket } from "@/lib/buildability";

const strategyIcons: Record<Strategy, React.ReactNode> = {
  fresh_build: <Building2 size={22} />,
  split_build: <Scissors size={22} />,
  main_adu: <Home size={22} />,
  flip_fix: <Wrench size={22} />,
  pass: <XCircle size={22} />,
};

const feasibilityBadge = (f: string) => {
  switch (f) {
    case "permitted":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
          <CheckCircle2 size={12} /> Permitted
        </span>
      );
    case "conditional":
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
          <AlertTriangle size={12} /> Conditional
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
          <Ban size={12} /> Not Allowed
        </span>
      );
  }
};

const tierLabels: QualityTier[] = ["standard", "premium", "luxury", "ultra_luxury"];

// ── Architect-mode display helpers ──────────────────────────────────────────

const TYPOLOGY_LABELS: Record<TypologyBucket, string> = {
  sfr: "Single-family",
  sfr_with_adu: "SFR + ADU",
  duplex: "Duplex",
  triplex: "Triplex",
  fourplex: "Fourplex",
  five_plus: "5+ units",
  condo: "Condo",
  other: "Other",
};

const TYPOLOGY_COLORS: Record<TypologyBucket, string> = {
  sfr: "bg-green-500",
  sfr_with_adu: "bg-emerald-500",
  duplex: "bg-blue-500",
  triplex: "bg-indigo-500",
  fourplex: "bg-violet-500",
  five_plus: "bg-purple-500",
  condo: "bg-pink-500",
  other: "bg-gray-400",
};

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
      className={`inline-flex items-center gap-1 text-xs font-medium border ${tone} px-2 py-0.5 rounded-full`}
      title={`Confidence score: ${score}/100`}
    >
      <ShieldCheck size={11} /> {label ?? "—"} · {score}
    </span>
  );
}

function caveatIcon(sev: "info" | "warning" | "block") {
  if (sev === "block") return <AlertOctagon size={13} className="text-red-500 flex-shrink-0 mt-0.5" />;
  if (sev === "warning") return <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />;
  return <Info size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />;
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

// ─────────────────────────────────────────────────────────────────────────────
// ListPriceInput — editable list price with local state, commit on blur/Enter.
// ─────────────────────────────────────────────────────────────────────────────

interface ListPriceInputProps {
  defaultValue: number;
  originalValue: number;
  onCommit: (value: number) => void;
  hasOverride: boolean;
  onReset: () => void;
}

function ListPriceInput({
  defaultValue,
  originalValue,
  onCommit,
  hasOverride,
  onReset,
}: ListPriceInputProps) {
  // Derived-state-with-previous-value pattern (React 19 idiom): re-sync
  // local input when parent's defaultValue prop changes (e.g., on Reset)
  // without triggering an effect-driven cascade.
  const [local, setLocal] = useState<string>(String(defaultValue));
  const [prevDefault, setPrevDefault] = useState<number>(defaultValue);
  if (prevDefault !== defaultValue) {
    setPrevDefault(defaultValue);
    setLocal(String(defaultValue));
  }

  const commit = () => {
    const v = Math.round(Number(local.replace(/[^0-9.]/g, "")));
    if (v > 0) onCommit(v);
    else setLocal(String(originalValue));
  };

  return (
    <div className="flex items-center gap-1 mt-0.5">
      <span className="text-sm font-semibold text-gray-900 dark:text-white">$</span>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className="w-full max-w-[100px] px-1 py-0.5 text-sm font-semibold bg-transparent border-b border-dashed border-gray-300 dark:border-slate-600 text-gray-900 dark:text-white focus:outline-none focus:border-green-500"
      />
      {hasOverride && (
        <button
          onClick={onReset}
          className="text-[10px] text-gray-400 hover:text-red-500 underline ml-1 whitespace-nowrap"
          title={`Reset to auto-detected ${formatCurrency(originalValue)}`}
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyCard — extracted with local input state so typing doesn't churn
// the parent analysis tree on every keystroke (mobile focus fix).
// ─────────────────────────────────────────────────────────────────────────────

interface StrategyCardProps {
  analysis: AnalysisResult;
  isBest: boolean;
  override: StrategyOverrides | undefined;
  onCommitOverride: (field: "buildSqft" | "sellPricePerSqft", v: number | undefined) => void;
  onResetOverride: () => void;
  defaultSellPpsf: number;
  defaultSellSource: "neighborhood" | "wa_fallback";
  defaultSellHint: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  redfinUrl: string;
}

function StrategyCard({
  analysis,
  isBest,
  override,
  onCommitOverride,
  onResetOverride,
  defaultSellPpsf,
  defaultSellSource,
  defaultSellHint,
  expanded,
  onToggleExpanded,
  redfinUrl,
}: StrategyCardProps) {
  // Local input strings — committed only on blur/Enter so the parent
  // analysis doesn't recompute (and remount the input) on every keystroke.
  // The parent uses `key={`${strategy}-${qualityTier}`}` to remount this
  // card when tier changes, so we don't need an effect to re-sync defaults.
  const [localBuildSqft, setLocalBuildSqft] = useState<string>(
    String(override?.buildSqft ?? analysis.buildSqft)
  );
  const [localSellPpsf, setLocalSellPpsf] = useState<string>(
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

  const isMuted = !analysis.isTopRecommendation;

  return (
    <div
      className={`bg-white dark:bg-slate-800 border-2 rounded-2xl overflow-hidden transition-all ${
        isBest
          ? "border-green-500 shadow-lg shadow-green-500/10"
          : analysis.isTopRecommendation
          ? "border-gray-200 dark:border-slate-600"
          : "border-gray-100 dark:border-slate-700 opacity-95"
      }`}
    >
      <div className="p-5">
        {isBest && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full mb-3">
            <TrendingUp size={10} /> Best Option
          </div>
        )}
        {!isBest && analysis.isTopRecommendation && (
          <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 text-[10px] font-semibold uppercase tracking-wider rounded-full mb-3">
            Top Pick
          </div>
        )}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
              isBest
                ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                : isMuted
                ? "bg-gray-50 dark:bg-slate-700/50 text-gray-400"
                : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
            }`}>
              {strategyIcons[analysis.strategy]}
            </div>
            <div>
              <h3 className={`font-bold ${isMuted ? "text-gray-700 dark:text-gray-300" : "text-gray-900 dark:text-white"}`}>
                {STRATEGIES[analysis.strategy].label}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {STRATEGIES[analysis.strategy].tagline}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            {feasibilityBadge(analysis.feasibility)}
            {confidenceChip(analysis.confidence, analysis.confidenceLabel)}
          </div>
        </div>

        {analysis.caveats && analysis.caveats.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {analysis.caveats.slice(0, 3).map((c, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 text-[11px] leading-relaxed border rounded-lg px-2.5 py-1.5 ${caveatTone(c.severity)}`}
              >
                {caveatIcon(c.severity)}
                <span>{c.text}</span>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Profit</p>
            <p className={`text-lg font-bold ${analysis.profit > 0 ? "text-green-600" : "text-red-500"}`}>
              {formatCurrency(analysis.profit)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">ROI</p>
            <p className={`text-lg font-bold ${analysis.roi > 15 ? "text-green-600" : analysis.roi > 0 ? "text-amber-600" : "text-red-500"}`}>
              {formatPercent(analysis.roi)}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Timeline</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {analysis.timelineMonths}mo
            </p>
          </div>
        </div>

        {/* Per-strategy overrides — local-state inputs, commit on blur/Enter */}
        <div className="mt-4 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-xl space-y-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium whitespace-nowrap">Build</label>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={localBuildSqft}
                onChange={(e) => setLocalBuildSqft(e.target.value)}
                onBlur={commitBuild}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="w-20 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white text-right"
              />
              <span className="text-[10px] text-gray-400">sqft</span>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] uppercase tracking-wider text-gray-400 font-medium whitespace-nowrap">Sell</label>
              <span className="text-[10px] text-gray-400">$</span>
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={localSellPpsf}
                onChange={(e) => setLocalSellPpsf(e.target.value)}
                onBlur={commitSell}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="w-20 px-2 py-1 text-xs bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white text-right"
              />
              <span className="text-[10px] text-gray-400">/sqft</span>
              <a
                href={redfinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-700 underline whitespace-nowrap"
              >
                Redfin <ExternalLink size={9} />
              </a>
            </div>
            {(override?.buildSqft || override?.sellPricePerSqft) && (
              <button
                onClick={() => {
                  onResetOverride();
                  setLocalBuildSqft(String(analysis.buildSqft));
                  setLocalSellPpsf(String(defaultSellPpsf));
                }}
                className="text-[10px] text-gray-400 hover:text-red-500 underline ml-auto"
              >
                Reset
              </button>
            )}
          </div>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-snug">
            Default sell price: <span className="font-medium text-gray-600 dark:text-gray-400">${defaultSellPpsf}/sqft</span>{" "}
            <span className={defaultSellSource === "neighborhood" ? "text-emerald-600" : "text-amber-600"}>
              ({defaultSellHint})
            </span>
          </p>
        </div>

        {/* Timeline bar */}
        <div className="mt-4">
          <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
            <div
              className="bg-amber-400 rounded-l-full"
              style={{ width: `${(analysis.permitMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Permit: ${analysis.permitMonths}mo`}
            />
            <div
              className="bg-blue-400"
              style={{ width: `${(analysis.buildMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Build: ${analysis.buildMonths}mo`}
            />
            <div
              className="bg-green-400 rounded-r-full"
              style={{ width: `${(analysis.sellMonths / Math.max(1, analysis.timelineMonths)) * 100}%` }}
              title={`Sell: ${analysis.sellMonths}mo`}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
            <span>Permit ({analysis.permitMonths}mo)</span>
            <span>Build ({analysis.buildMonths}mo)</span>
            <span>Sell ({analysis.sellMonths}mo)</span>
          </div>
        </div>

        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-1 mt-4 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? "Less detail" : "Full breakdown"}
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100 dark:border-slate-700 pt-4">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Build Area</span>
              <span className="font-medium text-gray-900 dark:text-white">{analysis.buildSqft.toLocaleString()} sqft</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Acquisition</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(analysis.acquisitionCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Construction</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(analysis.constructionCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Holding ({analysis.timelineMonths}mo × {formatCurrency(analysis.holdingCostMonthly)}/mo)</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(analysis.totalHoldingCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Selling Costs</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(analysis.sellingCosts)}</span>
            </div>
            <div className="border-t border-gray-100 dark:border-slate-700 pt-2 flex justify-between font-bold">
              <span className="text-gray-700 dark:text-gray-300">Total Project Cost</span>
              <span className="text-gray-900 dark:text-white">{formatCurrency(analysis.totalProjectCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Expected Sale Price</span>
              <span className="font-bold text-green-600">{formatCurrency(analysis.expectedSalePrice)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Annualized ROI</span>
              <span className="font-bold text-gray-900 dark:text-white">{formatPercent(analysis.annualizedRoi)}</span>
            </div>
            <div className="mt-3 p-3 bg-gray-50 dark:bg-slate-700 rounded-xl">
              <p className="text-xs text-gray-600 dark:text-gray-300">{analysis.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PropertyAnalysis() {
  const router = useRouter();
  const property = useStore((s) => s.currentProperty);
  const settings = useStore((s) => s.settings);
  const saveAnalysis = useStore((s) => s.saveAnalysis);
  const setCurrentAnalyses = useStore((s) => s.setCurrentAnalyses);
  const setRecommendedStrategy = useStore((s) => s.setRecommendedStrategy);

  const [qualityTier, setQualityTier] = useState<QualityTier>(settings.defaultQualityTier);
  const [costPerSqft, setCostPerSqft] = useState(settings.customCostPerSqft[settings.defaultQualityTier]);
  const [expandedStrategy, setExpandedStrategy] = useState<Strategy | null>(null);
  const [financing, setFinancing] = useState<FinancingConfig>({
    type: settings.defaultFinancingType,
    downPaymentPct: settings.defaultDownPaymentPct,
    interestRate: settings.defaultInterestRate,
    loanTermYears: 30,
    points: 0,
  });

  // List price override — the auto-pulled estimate is often wrong; let user edit.
  // `undefined` means "use property.listingPrice"; a number means "use this instead".
  const [listPriceOverride, setListPriceOverride] = useState<number | undefined>(undefined);

  // Per-strategy overrides for build sqft and sell price/sqft
  const [strategyOverrides, setStrategyOverrides] = useState<
    Partial<Record<Strategy, StrategyOverrides>>
  >({});

  const updateOverride = (strategy: Strategy, field: keyof StrategyOverrides, value: number | undefined) => {
    setStrategyOverrides((prev) => ({
      ...prev,
      [strategy]: {
        ...prev[strategy],
        [field]: value,
      },
    }));
  };

  // Build Redfin search URL for nearby sold comps
  const getRedfin = () => {
    if (!property) return "#";
    const city = property.city.toLowerCase().replace(/\s+/g, "-");
    const state = property.state.toUpperCase();
    // Redfin sold listings search — pre-filtered to the city
    return `https://www.redfin.com/city/${city}-${state}/filter/sort=lo-days,property-type=house,status=sold-3mo`;
  };

  // Update cost when tier changes
  const handleTierChange = (tier: QualityTier) => {
    setQualityTier(tier);
    setCostPerSqft(settings.customCostPerSqft[tier]);
  };

  // Effective property = stored property with optional list-price override applied.
  const effectiveProperty: PropertyData | null = useMemo(() => {
    if (!property) return null;
    if (listPriceOverride === undefined || listPriceOverride === property.listingPrice) {
      return property;
    }
    return { ...property, listingPrice: listPriceOverride };
  }, [property, listPriceOverride]);

  // Run analysis
  const { analyses, recommended } = useMemo(() => {
    if (!effectiveProperty) {
      return { analyses: [], recommended: "pass" as Strategy };
    }
    return analyzeAllStrategies(effectiveProperty, qualityTier, costPerSqft, financing, strategyOverrides);
  }, [effectiveProperty, qualityTier, costPerSqft, financing, strategyOverrides]);

  const [showComps, setShowComps] = useState(true);

  // Save to store
  useEffect(() => {
    if (analyses.length > 0) {
      setCurrentAnalyses(analyses);
      setRecommendedStrategy(recommended);
      // Auto-save the recommended one
      const best = analyses.find((a) => a.strategy === recommended);
      if (best) saveAnalysis(best);
    }
  }, [analyses, recommended, setCurrentAnalyses, setRecommendedStrategy, saveAnalysis]);

  if (!property) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500 mb-4">No property selected</p>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-green-600 text-white rounded-lg"
            >
              Go to Search
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleShare = async () => {
    const best = analyses.find((a) => a.strategy === recommended);
    if (!best) return;

    const text = `LandMath Analysis: ${property.address}\n\nRecommended: ${STRATEGIES[recommended].label}\nProfit: ${formatCurrency(best.profit)}\nROI: ${formatPercent(best.roi)}\nTimeline: ${best.timelineMonths} months\n\n${best.recommendation}`;

    if (navigator.share) {
      await navigator.share({ title: `LandMath: ${property.address}`, text });
    } else {
      await navigator.clipboard.writeText(text);
      alert("Report copied to clipboard!");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Navigation />

      <main className="flex-1 px-4 py-6 pb-24 md:pb-8 max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="p-2 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                {property.address}
              </h1>
              <p className="text-sm text-gray-500">
                {property.city}, {property.state} {property.zip} | {property.county} County
              </p>
            </div>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
          >
            <Share2 size={16} />
            Share
          </button>
        </div>

        {/* Property Stats Bar — list price is editable */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {/* Editable list price */}
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">List Price</p>
            <ListPriceInput
              defaultValue={listPriceOverride ?? property.listingPrice}
              originalValue={property.listingPrice}
              onCommit={(v) => setListPriceOverride(v === property.listingPrice ? undefined : v)}
              hasOverride={listPriceOverride !== undefined && listPriceOverride !== property.listingPrice}
              onReset={() => setListPriceOverride(undefined)}
            />
          </div>
          {[
            { label: "Lot Size", value: `${property.lotSizeSqft.toLocaleString()} sqft` },
            { label: "Zoning", value: property.zoningCode },
            { label: "Current", value: `${property.beds}bd/${property.baths}ba · ${property.currentSqft.toLocaleString()} sqft` },
            { label: "Year Built", value: property.yearBuilt.toString() },
          ].map((stat) => (
            <div
              key={stat.label}
              className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-3"
            >
              <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Neighborhood Context — typology + size guardrail (architect-mode §5) */}
        {property.neighborhood && (
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Neighborhood Context
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {property.neighborhood.parcelCount} residential parcels within{" "}
                  {(property.neighborhood.radiusM / 1609).toFixed(2)} mi
                  {property.neighborhood.recentMultiUnitCount >= 3 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <TrendingUp size={11} /> {property.neighborhood.recentMultiUnitCount} non-SFR/ADU sales last 24mo
                    </span>
                  )}
                </p>
                {property.neighborhood.compDiagnostic && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-mono">
                    Comps: {property.neighborhood.compDiagnostic.apiillowReturned} returned ·{" "}
                    {property.neighborhood.compDiagnostic.compsWithSqft} with sqft ·{" "}
                    {property.neighborhood.compDiagnostic.newConstructionComps} new construction ·{" "}
                    source: {property.neighborhood.compDiagnostic.source}
                    {property.neighborhood.compDiagnostic.apiillowStatus !== "ok" && (
                      <span className="ml-2 text-red-500">
                        ⚠ APIllow: {property.neighborhood.compDiagnostic.apiillowStatus}
                        {property.neighborhood.compDiagnostic.apiillowHttpStatus
                          ? ` (${property.neighborhood.compDiagnostic.apiillowHttpStatus})`
                          : ""}
                      </span>
                    )}
                  </p>
                )}
              </div>
              {property.neighborhood.isSparse && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                  <AlertTriangle size={11} /> Sparse sample
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Size stats */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Home size (recent sales)</p>
                {property.neighborhood.medianHomeSqft ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500">Median</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {property.neighborhood.medianHomeSqft.toLocaleString()} sqft
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>P25 {property.neighborhood.p25HomeSqft?.toLocaleString()} sqft</span>
                      <span>P75 {property.neighborhood.p75HomeSqft?.toLocaleString()} sqft</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                      Target build size (median × 1.175):{" "}
                      <span className="font-medium text-gray-900 dark:text-white">
                        {Math.round(property.neighborhood.medianHomeSqft * 1.175).toLocaleString()} sqft
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    Living sqft not available for recent comps — size guardrail using zoning max only.
                  </p>
                )}
              </div>

              {/* Typology distribution — KC only (requires GIS parcel layer) */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-400 font-medium mb-2">Structure types nearby</p>
                {property.isKingCounty === false ? (
                  <p className="text-xs text-gray-400 italic">
                    Parcel typology chart is only available for King County, WA.
                  </p>
                ) : property.neighborhood.typology.total > 0 ? (
                  <>
                    <div className="flex h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
                      {(Object.keys(property.neighborhood.typology.counts) as TypologyBucket[])
                        .filter((b) => property.neighborhood!.typology.counts[b] > 0)
                        .map((b) => {
                          const share = property.neighborhood!.typology.shares[b];
                          return (
                            <div
                              key={b}
                              className={TYPOLOGY_COLORS[b]}
                              style={{ width: `${share * 100}%` }}
                              title={`${TYPOLOGY_LABELS[b]}: ${(share * 100).toFixed(1)}% (${property.neighborhood!.typology.counts[b]} parcels)`}
                            />
                          );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {(Object.keys(property.neighborhood.typology.counts) as TypologyBucket[])
                        .filter((b) => property.neighborhood!.typology.counts[b] > 0)
                        .sort((a, b) =>
                          property.neighborhood!.typology.counts[b] - property.neighborhood!.typology.counts[a]
                        )
                        .map((b) => (
                          <span key={b} className="inline-flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
                            <span className={`w-2 h-2 rounded-full ${TYPOLOGY_COLORS[b]}`} />
                            {TYPOLOGY_LABELS[b]} ({property.neighborhood!.typology.counts[b]})
                          </span>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-gray-400 italic">No nearby parcel data.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Controls: Quality Tier + Financing */}
        <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Quality Tier */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                Construction Quality
              </label>
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl">
                {tierLabels.map((t) => (
                  <button
                    key={t}
                    onClick={() => handleTierChange(t)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      qualityTier === t
                        ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {QUALITY_TIERS[t].label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <span className="text-xs text-gray-500">Cost/sqft:</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">$</span>
                  <input
                    type="number"
                    value={costPerSqft}
                    onChange={(e) => setCostPerSqft(Number(e.target.value))}
                    className="w-24 pl-5 pr-2 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
                  />
                </div>
                <span className="text-xs text-gray-400">/sqft</span>
              </div>
            </div>

            {/* Financing */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 block">
                Financing
              </label>
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl mb-3">
                {(["traditional", "interest_only", "hard_money", "cash"] as const).map((ft) => (
                  <button
                    key={ft}
                    onClick={() => setFinancing({ ...financing, type: ft })}
                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-all ${
                      financing.type === ft
                        ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {ft === "traditional" ? "30yr" : ft === "interest_only" ? "IO" : ft === "hard_money" ? "Hard $" : "Cash"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Down:</span>
                  <input
                    type="number"
                    value={financing.downPaymentPct}
                    onChange={(e) => setFinancing({ ...financing, downPaymentPct: Number(e.target.value) })}
                    className="w-16 px-2 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
                  />
                  <span className="text-xs text-gray-400">%</span>
                </div>
                {financing.type !== "cash" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Rate:</span>
                    <input
                      type="number"
                      step="0.125"
                      value={financing.interestRate}
                      onChange={(e) => setFinancing({ ...financing, interestRate: Number(e.target.value) })}
                      className="w-20 px-2 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
                    />
                    <span className="text-xs text-gray-400">%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Non-KC data coverage banner */}
        {property.isKingCounty === false && (
          <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
                  Limited data outside King County
                </p>
                <p className="text-xs text-blue-800 dark:text-blue-300 mt-1 leading-relaxed">
                  Deep parcel GIS data (zoning history, assessor roll, typology chart) is only available for King County, WA.
                  Property details are sourced from Nominatim + APIllow (Zillow data). Comp-based pricing still works,
                  but verify zoning and lot size with the local assessor before making decisions.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* APIllow key warning — surfaces only when API key is missing or dead */}
        {property.neighborhood?.compDiagnostic?.apiillowStatus === "http_error" &&
          property.neighborhood.compDiagnostic.apiillowHttpStatus === 401 && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <AlertOctagon size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                    APIllow API key invalid — comp data unavailable
                  </p>
                  <p className="text-xs text-red-800 dark:text-red-300 mt-1 leading-relaxed">
                    Sale $/sqft is falling back to ZIP-level baseline (or WA flat default if your ZIP isn&apos;t in the table).
                    These are reasonable estimates but not as accurate as live neighborhood comps.
                    To restore comp-based pricing, get a key at{" "}
                    <a
                      href="https://apillow.co/#signup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium hover:text-red-900"
                    >
                      apillow.co
                    </a>
                    {" "}and update <code className="px-1 py-0.5 bg-red-100 dark:bg-red-900/40 rounded">APILLOW_API_KEY</code> on Vercel.
                  </p>
                </div>
              </div>
            </div>
          )}

        {/* Strategy Cards — all four in fixed enum order, all editable.
            Top-2 by current score get visual emphasis; "Best Option" badge on rank-1. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {analyses.map((analysis) => {
            const isBest = analysis.strategy === recommended && analysis.profit > 0;
            const sellInfo = effectiveProperty
              ? getDefaultSellPricePerSqft(effectiveProperty, qualityTier, analysis.strategy)
              : {
                  value: 425,
                  source: "flat_fallback" as const,
                  multiplier: 1,
                  neighborhoodMedianPpsf: undefined,
                  compCount: undefined,
                  strategy: analysis.strategy,
                };
            const sourceLabel: Record<typeof sellInfo.source, string> = {
              neighborhood_new: "new-construction comps",
              neighborhood_resale: "existing-home resale comps",
              neighborhood_all: "all nearby comps",
              zip_premium: "ZIP-level $/sqft table",
              flat_fallback: "national flat estimate — no usable comps",
            };
            let sellHint: string;
            if (sellInfo.source === "flat_fallback") {
              sellHint = sourceLabel.flat_fallback;
            } else if (sellInfo.source === "zip_premium") {
              sellHint = `ZIP ${sellInfo.zip ?? "?"} baseline × ${sellInfo.multiplier.toFixed(2)}× ${qualityTier.replace("_", "-")} — no neighborhood comps available`;
            } else {
              sellHint = `${sellInfo.compCount} ${sourceLabel[sellInfo.source]} @ $${sellInfo.neighborhoodMedianPpsf}/sqft median${
                sellInfo.multiplier !== 1.0
                  ? ` × ${sellInfo.multiplier.toFixed(2)}× ${qualityTier.replace("_", "-")}`
                  : " (used directly — these ARE new-build comp prices)"
              }`;
            }
            const sellSource: "neighborhood" | "wa_fallback" =
              sellInfo.source === "flat_fallback" ? "wa_fallback" : "neighborhood";

            return (
              <StrategyCard
                key={`${analysis.strategy}-${qualityTier}`}
                analysis={analysis}
                isBest={isBest}
                override={strategyOverrides[analysis.strategy]}
                onCommitOverride={(field, v) => updateOverride(analysis.strategy, field, v)}
                onResetOverride={() =>
                  setStrategyOverrides((prev) => {
                    const next = { ...prev };
                    delete next[analysis.strategy];
                    return next;
                  })
                }
                defaultSellPpsf={sellInfo.value}
                defaultSellSource={sellSource}
                defaultSellHint={sellHint}
                expanded={expandedStrategy === analysis.strategy}
                onToggleExpanded={() =>
                  setExpandedStrategy(
                    expandedStrategy === analysis.strategy ? null : analysis.strategy
                  )
                }
                redfinUrl={getRedfin()}
              />
            );
          })}
        </div>

        {/* Bottom recommendation banner */}
        {recommended !== "pass" && (
          <div className="bg-green-600 text-white rounded-2xl p-6 text-center">
            <p className="text-sm font-medium opacity-80 mb-1">LandMath Recommendation</p>
            <p className="text-2xl font-bold mb-2">
              {STRATEGIES[recommended].label}
            </p>
            <p className="text-sm opacity-90 max-w-lg mx-auto">
              {analyses.find((a) => a.strategy === recommended)?.recommendation}
            </p>
          </div>
        )}

        {recommended === "pass" && (
          <div className="bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl p-6 text-center">
            <XCircle size={32} className="mx-auto text-gray-400 mb-2" />
            <p className="text-lg font-bold text-gray-700 dark:text-gray-300">Pass on this property</p>
            <p className="text-sm text-gray-500 mt-1">The math doesn&apos;t work for any strategy at these numbers.</p>
          </div>
        )}

        {/* Cited comps — every comp that fed the analysis, with drill-in links */}
        {property.neighborhood && property.neighborhood.sales.length > 0 && (
          <div className="mt-6 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Comparable Sales — Sources
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {property.neighborhood.sales.length} recent sales within 1.5 mi. These are the comps the engine used
                  {property.isKingCounty !== false && " — click any address to verify on the King County Assessor"}.
                </p>
              </div>
              <button
                onClick={() => setShowComps(!showComps)}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 inline-flex items-center gap-1"
              >
                {showComps ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showComps ? "Hide" : "Show"}
              </button>
            </div>

            {showComps && (
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
                      <th className="py-2 pr-3 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.neighborhood.sales.map((c) => (
                      <tr
                        key={c.pin + c.saleDate}
                        className="border-b border-gray-50 dark:border-slate-700/50 last:border-0"
                      >
                        <td className="py-2 pr-3">
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                          >
                            {c.address}
                            <ExternalLink size={10} />
                          </a>
                          <p className="text-[10px] text-gray-400 mt-0.5">PIN {c.pin}</p>
                        </td>
                        <td className="py-2 pr-3 text-gray-600 dark:text-gray-400">{formatSaleDate(c.saleDate)}</td>
                        <td className="py-2 pr-3 text-right font-medium text-gray-900 dark:text-white">
                          {formatCurrency(c.salePrice)}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-600 dark:text-gray-400">
                          {c.sqftLiving ? c.sqftLiving.toLocaleString() : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-gray-600 dark:text-gray-400">
                          {c.pricePerSqft ? `$${c.pricePerSqft}` : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white ${TYPOLOGY_COLORS[c.typology]}`}>
                            {TYPOLOGY_LABELS[c.typology]}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <a
                              href={c.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-gray-500 hover:text-blue-600 underline"
                            >
                              Assessor
                            </a>
                            {c.parcelViewerUrl && (
                              <a
                                href={c.parcelViewerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-gray-500 hover:text-blue-600 underline"
                              >
                                Map
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-3">
                  {property.isKingCounty !== false
                    ? "Source: King County PropertyInfo / KC Assessor eRealProperty. Sales filtered to PRICE > $100,000."
                    : "Source: APIllow (Zillow data). Sales filtered to PRICE > $100,000 within 1.5 mi radius."}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
