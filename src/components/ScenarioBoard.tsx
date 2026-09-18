"use client";

/**
 * ScenarioBoard — verdict-first display of the development scenario optimizer.
 *
 * Mobile-first: the first thing on screen is ONE answer ("best play"), with a
 * ranked list of alternatives behind progressive disclosure. Every scenario
 * shows its legal basis (municipal code + state statute citations) and a
 * confidence grade; low-confidence ideas are tucked into a collapsed section.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Trophy, ChevronDown, ChevronUp, Scale, TrendingUp, Clock,
  AlertTriangle, ExternalLink, Layers, Home, Building2, Hammer,
  CircleDollarSign, KeyRound, SlidersHorizontal, HelpCircle,
} from "lucide-react";
import type { PropertyData, QualityTier, FinancingConfig } from "@/store/useStore";
import { formatCurrency, getDefaultSellPricePerSqft } from "@/lib/calculations";
import {
  optimizeProperty,
  type OptimizerOverrides,
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

/** Small "?" that reveals a how-is-this-calculated tooltip on hover (desktop)
 *  or tap (mobile). stopPropagation so tapping it doesn't collapse the card. */
function Hint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="How this is calculated"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="ml-1 text-gray-300 dark:text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
      >
        <HelpCircle size={11} />
      </button>
      {open && (
        <span className="absolute left-0 bottom-full mb-1.5 z-30 w-64 p-2.5 rounded-lg bg-gray-900 dark:bg-black text-gray-100 text-[10px] leading-relaxed shadow-xl pointer-events-none whitespace-normal">
          {text}
        </span>
      )}
    </span>
  );
}

function Row({ label, value, bold, hint }: { label: string; value: string; bold?: boolean; hint?: string }) {
  return (
    <div className="flex justify-between items-start py-1">
      <span className={`text-xs flex items-center ${bold ? "font-bold text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
        {label}
        {hint && <Hint text={hint} />}
      </span>
      <span className={`text-xs text-right ${bold ? "font-bold text-gray-900 dark:text-white" : "font-medium text-gray-700 dark:text-gray-300"}`}>{value}</span>
    </div>
  );
}

function ScenarioDetail({ s }: { s: ScenarioResult }) {
  const f = s.financials;
  const avgCash = f.avgCashDeployed ?? f.totalCashInvested;
  const blendedPpsf = s.totalBuildSqft > 0 ? Math.round(f.revenue / s.totalBuildSqft) : 0;

  // How-is-this-calculated hints, with this scenario's actual numbers.
  const hints = {
    revenue:
      s.exit === "hold"
        ? `Stabilized value for the refi appraisal: the LOWER of income value (NOI ÷ cap rate) and 95% of what the units would sell for — lenders appraise small residential off comps, not just cap rates.`
        : s.form === "keep_dadu"
        ? `Existing house at ~2% over today's ask + DADUs at 80% of the sale $/sqft. The house isn't rebuilt, so it doesn't reprice at new-construction $/sqft.`
        : `${s.totalBuildSqft.toLocaleString()} sqft × ~$${blendedPpsf.toLocaleString()}/sqft blended. Main-house sqft sells at full $/sqft (comps or your pin); ADU sqft at 85%, plex 85%, townhome 90%, apartment condo-exit 80%.`,
    acquisition: `Purchase price + ~2.5% closing costs (title, escrow, inspection) + any loan origination points.`,
    construction: `Hard cost (build sqft × build cost $/sqft) + demo $20k (if tearing down) + permits ($20k + $3k per unit) + architect/engineering 5% of hard cost + contingency 12% + landscaping ($15k + $3k per unit)${s.lots > 1 ? " + short-plat survey/engineering/utility stubs" : ""}${s.form === "townhome" ? " + unit-lot subdivision" : ""}.`,
    holding: `Every month for ${f.timelineMonths} months: acquisition mortgage payment + property tax + insurance (0.4%/yr) + $300 utilities. Plus construction-loan interest charged only on the DRAWN balance (S-curve draw schedule, default 80% LTC) and loan origination points.`,
    selling: `7.8% of sale price — 5% agent commission + 1.8% WA excise tax (REET) + 1% seller concessions — plus $5k staging. Here: 7.8% × ${formatCurrency(f.revenue)} + $5,000.`,
    peakCash: `The most cash tied up at once: down payment + closing costs + your equity share of construction (the ~20% the construction loan doesn't cover) + all holding costs.`,
    avgCash: `Month-by-month average of cash actually tied up, per the draw schedule — capital ramps in as the build progresses, so the average (${formatCurrency(avgCash)}) sits well below peak (${formatCurrency(f.totalCashInvested)}). This is the ROI denominator.`,
    profit:
      s.exit === "hold"
        ? `Stabilized value − total project cost (acquisition + construction + holding). This is equity created, realized via the refi, not a cash sale.`
        : `${formatCurrency(f.revenue)} sale − ${formatCurrency(f.totalProjectCost)} all-in cost (acquisition + construction + holding + selling).`,
    roi: `${formatCurrency(f.profit)} profit ÷ ${formatCurrency(avgCash)} avg cash deployed. Uses average (not peak) cash, since that's what was actually tied up over the project's life.`,
    annualized: `ROI × 12 ÷ ${f.timelineMonths} months — what the same return equals per year, for comparing deals with different timelines.`,
    grossRent: `ZIP-level market rents applied to the unit mix (main house, ADUs, or per-unit for plex/MF).`,
    noi: `Gross rent × 12, less 5% vacancy, less ${s.form === "multifamily" ? "35%" : "30%"} operating expenses (tax, insurance, maintenance, management). Cap rate is the market yield for this asset type.`,
    refi: `Cash-out refinance at 72% of stabilized value once leased (BRRRR). Proceeds first pay off the acquisition + construction loans; the rest returns your cash.`,
    cashLeft: `Cash you put in, minus what the refi returned. Smaller is better — $0 means infinite cash-on-cash.`,
    cashFlow: `NOI − annual debt service on the refi loan (30-yr at ~0.4% above your rate). CoC = cash flow ÷ cash left in deal.`,
  };

  return (
    <div className="px-4 pb-4 border-t border-gray-100 dark:border-slate-700/60">
      <div className="pt-3 space-y-0.5">
        <Row label={s.exit === "hold" ? "Stabilized value" : "Sale revenue"} value={formatCurrency(f.revenue)} hint={hints.revenue} />
        <Row label="Acquisition (incl. closing)" value={formatCurrency(f.acquisitionCost)} hint={hints.acquisition} />
        <Row label="Construction (all-in)" value={formatCurrency(f.constructionCost)} hint={hints.construction} />
        <Row label="Holding + loan costs" value={formatCurrency(f.holdingCost)} hint={hints.holding} />
        {s.exit === "sell" && <Row label="Selling costs" value={formatCurrency(f.sellingCosts)} hint={hints.selling} />}
        <Row label="Cash required (peak)" value={formatCurrency(f.totalCashInvested)} hint={hints.peakCash} />
        <Row label="Avg cash deployed (ROI basis)" value={formatCurrency(avgCash)} hint={hints.avgCash} />
        <Row
          label={s.exit === "hold" ? "Equity created" : "Net profit"}
          value={formatCurrency(f.profit)}
          bold
          hint={hints.profit}
        />
        <Row label="ROI (on avg cash)" value={`${f.roi}%`} hint={hints.roi} />
        <Row label="Annualized ROI" value={`${f.annualizedRoi}%`} hint={hints.annualized} />
        {s.exit === "hold" && (
          <>
            <Row label="Gross rent" value={`${formatCurrency(f.monthlyGrossRent ?? 0)}/mo`} hint={hints.grossRent} />
            <Row label="NOI / cap rate" value={`${formatCurrency(f.noi ?? 0)} @ ${f.capRate}%`} hint={hints.noi} />
            <Row label="Refi loan (72% LTV)" value={formatCurrency(f.refiLoan ?? 0)} hint={hints.refi} />
            <Row label="Cash left in deal after refi" value={formatCurrency(f.cashLeftInDeal ?? 0)} hint={hints.cashLeft} />
            <Row
              label="Annual cash flow / CoC"
              value={`${formatCurrency(f.annualCashFlow ?? 0)}${(f.cashOnCash ?? 0) > 0 && (f.cashOnCash ?? 0) < 999 ? ` (${f.cashOnCash}%)` : (f.cashOnCash ?? 0) >= 999 ? " (∞ — no cash left in)" : ""}`}
              hint={hints.cashFlow}
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
              {s.exit === "hold" ? `equity · ${((f.cashOnCash ?? 0) >= 999) ? "∞" : `${f.cashOnCash ?? 0}%`} CoC` : `${f.roi}% ROI · ${f.annualizedRoi}%/yr`}
            </p>
          </div>
          {open ? <ChevronUp size={16} className="text-gray-300 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-300 flex-shrink-0" />}
        </div>
      </button>
      {open && <ScenarioDetail s={s} />}
    </div>
  );
}

/** Compact numeric field for the quick-tweak bar. Commits on blur/Enter. */
function TweakField({
  label, unit, value, placeholder, onCommit, width = "w-full",
}: {
  label: string;
  unit?: string;
  value: number | undefined;
  placeholder?: string;
  onCommit: (v: number | undefined) => void;
  width?: string;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");
  // Keep in sync when parent resets the value (e.g. tier change updates cost/sqft).
  useEffect(() => { setText(value != null ? String(value) : ""); }, [value]);
  const commit = () => {
    const v = parseFloat(text);
    onCommit(Number.isFinite(v) && v > 0 ? v : undefined);
  };
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500 font-semibold block mb-0.5">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          className={`${width} text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-300 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500`}
        />
        {unit && <span className="text-[10px] text-gray-400 flex-shrink-0">{unit}</span>}
      </div>
    </label>
  );
}

export default function ScenarioBoard({
  property, tier, costPerSqft, financing,
  onCostPerSqftChange, onFinancingChange, onBestChange, onOverridesChange,
}: {
  property: PropertyData;
  tier: QualityTier;
  costPerSqft: number;
  financing: FinancingConfig;
  onCostPerSqftChange?: (v: number) => void;
  onFinancingChange?: (f: FinancingConfig) => void;
  onBestChange?: (best: ScenarioResult | null) => void;
  /** Fires when the user pins/unpins quick-tweak overrides, so the page can
   *  keep the legacy engine (workbench, share, lender report) in sync. */
  onOverridesChange?: (o: OptimizerOverrides) => void;
}) {
  const [exitFilter, setExitFilter] = useState<"all" | ScenarioExit>("all");
  const [showLongShots, setShowLongShots] = useState(false);
  const [showAllScenarios, setShowAllScenarios] = useState(false);
  const [bestOpen, setBestOpen] = useState(true); // winner arrives expanded
  const [tweaksOpen, setTweaksOpen] = useState(true); // prominent, open by default
  // User-pinned assumptions (quick-tweak bar)
  const [sellPpsfOverride, setSellPpsfOverride] = useState<number | undefined>(undefined);
  const [buildSqftOverride, setBuildSqftOverride] = useState<number | undefined>(undefined);
  const [timelineOverride, setTimelineOverride] = useState<number | undefined>(undefined);

  const defaultPpsf = useMemo(
    () => getDefaultSellPricePerSqft(property, tier, "fresh_build").value,
    [property, tier],
  );

  const overrides: OptimizerOverrides = useMemo(
    () => ({
      sellPricePerSqft: sellPpsfOverride,
      sfrBuildSqft: buildSqftOverride,
      timelineMonths: timelineOverride,
    }),
    [sellPpsfOverride, buildSqftOverride, timelineOverride],
  );

  const report = useMemo(
    () => optimizeProperty(property, tier, costPerSqft, financing, overrides),
    [property, tier, costPerSqft, financing, overrides],
  );

  // Surface the current best play to the page (AI narrator, share, etc.)
  useEffect(() => { onBestChange?.(report.best); }, [report.best, onBestChange]);
  useEffect(() => { onOverridesChange?.(overrides); }, [overrides, onOverridesChange]);

  const filtered = useMemo(
    () => report.scenarios.filter((s) => exitFilter === "all" || s.exit === exitFilter),
    [report.scenarios, exitFilter],
  );

  const { best } = report;
  const env = report.envelopeSummary;

  // The winner is expanded up top — the ranked list shows the OTHER top 3,
  // with the rest behind a "show all" toggle.
  const others = useMemo(
    () => filtered.filter((s) => s.id !== best?.id),
    [filtered, best],
  );
  const visibleOthers = showAllScenarios ? others : others.slice(0, 3);
  const hiddenCount = others.length - 3;
  const tweaksActive = sellPpsfOverride != null || buildSqftOverride != null || timelineOverride != null;

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

      {/* ── Quick tweaks — the numbers investors argue about most ──────────
          Prominent, directly under the verdict: change an assumption and the
          verdict above + every scenario below re-price instantly. */}
      <div className="mt-3 rounded-2xl overflow-hidden border-2 border-emerald-200 dark:border-emerald-800/60 bg-white dark:bg-slate-800 shadow-sm">
        <button
          onClick={() => setTweaksOpen(!tweaksOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 text-sm font-bold text-emerald-800 dark:text-emerald-300"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal size={15} />
            Quick tweaks
            <span className="font-medium text-emerald-600/80 dark:text-emerald-400/80 text-xs hidden sm:inline">
              — sqft, price, timeline, financing
            </span>
            {tweaksActive && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold">
                pinned
              </span>
            )}
          </span>
          {tweaksOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
        {tweaksOpen && (
          <div className="p-3.5">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <TweakField
                label="Build sqft"
                unit="sqft"
                value={buildSqftOverride}
                placeholder={best ? String(best.totalBuildSqft) : "auto"}
                onCommit={setBuildSqftOverride}
              />
              <TweakField
                label="Sell price"
                unit="$/sqft"
                value={sellPpsfOverride}
                placeholder={String(defaultPpsf)}
                onCommit={setSellPpsfOverride}
              />
              <TweakField
                label="Build cost"
                unit="$/sqft"
                value={costPerSqft}
                onCommit={(v) => v != null && onCostPerSqftChange?.(v)}
              />
              <TweakField
                label="Total timeline"
                unit="mo"
                value={timelineOverride}
                placeholder={best ? String(best.financials.timelineMonths) : "auto"}
                onCommit={setTimelineOverride}
              />
              <TweakField
                label="Down payment"
                unit="%"
                value={financing.downPaymentPct}
                onCommit={(v) => v != null && onFinancingChange?.({ ...financing, downPaymentPct: Math.min(100, v) })}
              />
              <TweakField
                label="Constr. loan"
                unit="%/yr"
                value={financing.constructionRate ?? 10}
                onCommit={(v) => v != null && onFinancingChange?.({ ...financing, constructionRate: v })}
              />
            </div>
            <div className="flex items-center justify-between mt-2.5">
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Build sqft & sell price apply to SFR scenarios (capped by zoning); timeline pins every scenario&apos;s total (phases scale). Blank = auto. The verdict re-prices live.
              </p>
              {tweaksActive && (
                <button
                  onClick={() => { setSellPpsfOverride(undefined); setBuildSqftOverride(undefined); setTimelineOverride(undefined); }}
                  className="text-[10px] font-semibold text-emerald-600 hover:underline flex-shrink-0 ml-3"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        )}
      </div>

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

      {/* ── Runner-up scenarios: next 3 best, rest behind "show all" ─────── */}
      {others.length > 0 && (
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 px-1 mb-2">
          Next best plays
        </p>
      )}
      <div className="space-y-2">
        {visibleOthers.map((s, i) => (
          <ScenarioCard key={s.id} s={s} rank={i + 2} />
        ))}
        {filtered.length === 0 && report.scenarios.length > 0 && (
          <p className="text-xs text-gray-400 text-center py-3">No {exitFilter === "hold" ? "hold" : "sell"} scenarios at medium+ confidence.</p>
        )}
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAllScenarios(!showAllScenarios)}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700/40"
        >
          {showAllScenarios ? (
            <>Show top 3 only <ChevronUp size={14} /></>
          ) : (
            <>Show {hiddenCount} more scenario{hiddenCount > 1 ? "s" : ""} <ChevronDown size={14} /></>
          )}
        </button>
      )}

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
