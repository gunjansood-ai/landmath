"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
  DollarSign,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore, Strategy, QualityTier, FinancingConfig } from "@/store/useStore";
import {
  analyzeAllStrategies,
  formatCurrency,
  formatPercent,
  STRATEGIES,
  QUALITY_TIERS,
  DEFAULT_COST_PER_SQFT,
  calculateMonthlyPayment,
} from "@/lib/calculations";

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

  // Update cost when tier changes
  const handleTierChange = (tier: QualityTier) => {
    setQualityTier(tier);
    setCostPerSqft(settings.customCostPerSqft[tier]);
  };

  // Run analysis
  const { analyses, recommended } = useMemo(() => {
    if (!property) return { analyses: [], recommended: "pass" as Strategy };
    return analyzeAllStrategies(property, qualityTier, costPerSqft, financing);
  }, [property, qualityTier, costPerSqft, financing]);

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

        {/* Property Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: "List Price", value: formatCurrency(property.listingPrice) },
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

        {/* Strategy Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {analyses.map((analysis) => {
            const isRecommended = analysis.strategy === recommended;
            const isExpanded = expandedStrategy === analysis.strategy;

            return (
              <div
                key={analysis.strategy}
                className={`bg-white dark:bg-slate-800 border-2 rounded-2xl overflow-hidden transition-all ${
                  isRecommended
                    ? "border-green-500 shadow-lg shadow-green-500/10"
                    : "border-gray-100 dark:border-slate-700"
                }`}
              >
                {/* Card Header */}
                <div className="p-5">
                  {isRecommended && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full mb-3">
                      <TrendingUp size={10} /> Best Option
                    </div>
                  )}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                        isRecommended
                          ? "bg-green-100 dark:bg-green-900/40 text-green-600"
                          : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
                      }`}>
                        {strategyIcons[analysis.strategy]}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 dark:text-white">
                          {STRATEGIES[analysis.strategy].label}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {STRATEGIES[analysis.strategy].tagline}
                        </p>
                      </div>
                    </div>
                    {feasibilityBadge(analysis.feasibility)}
                  </div>

                  {/* Key metrics */}
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

                  {/* Timeline bar */}
                  <div className="mt-4">
                    <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-slate-700">
                      <div
                        className="bg-amber-400 rounded-l-full"
                        style={{ width: `${(analysis.permitMonths / analysis.timelineMonths) * 100}%` }}
                        title={`Permit: ${analysis.permitMonths}mo`}
                      />
                      <div
                        className="bg-blue-400"
                        style={{ width: `${(analysis.buildMonths / analysis.timelineMonths) * 100}%` }}
                        title={`Build: ${analysis.buildMonths}mo`}
                      />
                      <div
                        className="bg-green-400 rounded-r-full"
                        style={{ width: `${(analysis.sellMonths / analysis.timelineMonths) * 100}%` }}
                        title={`Sell: ${analysis.sellMonths}mo`}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                      <span>Permit ({analysis.permitMonths}mo)</span>
                      <span>Build ({analysis.buildMonths}mo)</span>
                      <span>Sell ({analysis.sellMonths}mo)</span>
                    </div>
                  </div>

                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedStrategy(isExpanded ? null : analysis.strategy)}
                    className="flex items-center gap-1 mt-4 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? "Less detail" : "Full breakdown"}
                  </button>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
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
      </main>
    </div>
  );
}
