/**
 * Carfax-style property investment report aggregator.
 *
 * Pulls everything we know about a parcel into one shape that the report
 * page can render top-to-bottom. Designed to be cached and embedded as
 * static JSON or written to a database row.
 *
 * Sections produced:
 *   1. Identity (address, PIN, lot, structure)
 *   2. Zoning verdict (district + state-law overlay)
 *   3. Hazard profile (severity bucket + ranked caveats)
 *   4. Sale + permit history (last sale, investor signal)
 *   5. Market context (neighborhood typology, median sqft, median sale)
 *   6. Strategy scores (6 strategies × feasibility / profit / confidence)
 *   7. Sensitivity (profit range + breakeven)
 *   8. Recommendation (top pick with reasoning)
 */

import type { PropertyData, AnalysisResult, FinancingConfig, QualityTier, Strategy } from "@/store/useStore";
import { calculateAnalysis, STRATEGIES, DEFAULT_COST_PER_SQFT, getFeasibilityReasoning } from "@/lib/calculations";
import { lookupZoning } from "@/lib/zoning/registry";
import { applyStateLaws } from "@/lib/zoning/wa-state-laws";
import { historyBadge } from "@/lib/history/kc-history";

export interface ReportRecommendation {
  topStrategy: Strategy | null;
  topStrategyLabel: string;
  reasoning: string[];
  /** Strategies to AVOID and why. */
  redFlags: Array<{ strategy: Strategy; label: string; why: string }>;
}

export interface CarfaxReport {
  generatedAt: string;
  property: PropertyData;
  identity: {
    address: string;
    city: string;
    state: string;
    zip: string;
    pin: string | null;
    lotSqft: number;
    yearBuilt: number | null;
    currentSqft: number | null;
    propertyType: string | null;
    currentUse: string | null;
    appraisedTotal: number | null;
  };
  zoning: {
    code: string;
    citySection: string | null;
    minLotSqft: number | null;
    maxDuPerAcre: number | null;
    kind: string | null;
    allowsShortPlat: boolean | null;
    cityCodeUrl: string | null;
    stateLawCitations: Array<{ label: string; url: string }>;
    effectiveMaxUnits: number;
    note: string | null;
  };
  hazards: {
    severityScore: number;
    severityLabel: string;
    topCaveats: Array<{ severity: string; text: string; sourceUrl: string }>;
    failureCount: number;
  } | null;
  history: {
    lastSaleDate: string | null;
    lastSalePrice: number | null;
    lastBuyerName: string | null;
    lastBuyerLooksInvestor: boolean;
    badge: string | null;
    drillInUrl: string | null;
    recentSaleCount: number;
  } | null;
  market: {
    neighborhoodCount: number;
    medianHomeSqft: number | null;
    medianLotSqft: number | null;
    typologyCommonest: string | null;
    typologyShare: number | null;
    recentSaleCount: number;
  };
  strategies: Array<{
    strategy: Strategy;
    label: string;
    feasibility: "permitted" | "conditional" | "not_allowed";
    projectedProfit: number;
    roi: number;
    annualizedRoi: number;
    timelineMonths: number;
    confidenceScore: number | null;
    confidenceLabel: string | null;
    profitRange: { min: number; median: number; max: number } | null;
    breakevenSalePct: number | null; // 0..1, fraction of baseline
    bearProfit: number | null;
    bullProfit: number | null;
    summary: string | null;
    feasibilityReason: string;
  }>;
  recommendation: ReportRecommendation;
}

/**
 * Build the complete Carfax report from a fully-hydrated property and a
 * baseline financing config.
 */
export function buildCarfaxReport(args: {
  property: PropertyData;
  financing: FinancingConfig;
  tier: QualityTier;
  costPerSqft?: number;
}): CarfaxReport {
  const { property, financing, tier } = args;
  const costPerSqft = args.costPerSqft ?? DEFAULT_COST_PER_SQFT[tier];

  // 1. Identity
  const identity = {
    address: property.address,
    city: property.city,
    state: property.state,
    zip: property.zip,
    pin: property.history?.pin ?? null,
    lotSqft: property.lotSizeSqft,
    yearBuilt: property.yearBuilt || null,
    currentSqft: property.currentSqft || null,
    propertyType: (property.neighborhood?.sourceCity ? "Residential" : null) as string | null,
    currentUse: null,
    appraisedTotal: property.taxAssessedValue || null,
  };

  // 2. Zoning
  const rule = lookupZoning({ state: property.state, city: property.city, code: property.zoningCode });
  const overlay = applyStateLaws({
    city: property.city, state: property.state, baseRule: rule, inUrbanGrowthArea: true,
  });
  const zoning: CarfaxReport["zoning"] = {
    code: property.zoningCode || "Unknown",
    citySection: rule?.codeSection ?? null,
    minLotSqft: rule?.minLotSqft ?? null,
    maxDuPerAcre: rule?.maxDuPerAcre ?? null,
    kind: rule?.kind ?? null,
    allowsShortPlat: rule?.allowsShortPlat ?? null,
    cityCodeUrl: rule?.codeUrl ?? null,
    stateLawCitations: overlay.citations,
    effectiveMaxUnits: overlay.effectiveMaxUnitsPerLot,
    note: rule?.note ?? null,
  };

  // 3. Hazards
  const hazardCaveats = (property.hazards?.caveats ?? [])
    .slice()
    .sort((a, b) => {
      const rank: Record<string, number> = { block: 0, warning: 1, info: 2 };
      return rank[a.severity] - rank[b.severity];
    })
    .slice(0, 5);
  const hazards = property.hazards
    ? {
        severityScore: property.hazards.severityScore,
        severityLabel: property.hazards.severityLabel,
        topCaveats: hazardCaveats,
        failureCount: property.hazards.failures.length,
      }
    : null;

  // 4. History
  const history = property.history
    ? {
        lastSaleDate: property.history.lastSale?.saleDate ?? null,
        lastSalePrice: property.history.lastSale?.salePrice ?? null,
        lastBuyerName: property.history.lastSale?.buyerName ?? null,
        lastBuyerLooksInvestor: property.history.lastBuyerLooksInvestor,
        badge: historyBadge(property.history),
        drillInUrl: property.history.links?.[0]?.url ?? null,
        recentSaleCount: property.history.recentSales.length,
      }
    : null;

  // 5. Market context
  const nb = property.neighborhood;
  let typologyCommonest: string | null = null;
  let typologyShare: number | null = null;
  if (nb?.typology?.shares) {
    let top = -1;
    for (const [k, v] of Object.entries(nb.typology.shares)) {
      if (typeof v === "number" && v > top) {
        top = v;
        typologyCommonest = k;
        typologyShare = v;
      }
    }
  }
  const market: CarfaxReport["market"] = {
    neighborhoodCount: nb?.parcelCount ?? 0,
    medianHomeSqft: nb?.medianHomeSqft ?? null,
    medianLotSqft: nb?.medianLotSqft ?? null,
    typologyCommonest,
    typologyShare,
    recentSaleCount: nb?.sales.length ?? 0,
  };

  // 6. Strategy scores — run all 6
  const allStrategies: Strategy[] = ["fresh_build", "split_build", "main_adu", "flip_fix", "townhome", "multifamily"];
  const strategies = allStrategies.map((s) => {
    let res: AnalysisResult | null = null;
    try {
      res = calculateAnalysis(property, s, tier, costPerSqft, financing);
    } catch {
      res = null;
    }
    const reasoning = res
      ? getFeasibilityReasoning(property, s, res.feasibility)
      : null;
    return {
      strategy: s,
      label: STRATEGIES[s]?.label ?? s,
      feasibility: res?.feasibility ?? "not_allowed",
      projectedProfit: res?.profit ?? 0,
      roi: res?.roi ?? 0,
      annualizedRoi: res?.annualizedRoi ?? 0,
      timelineMonths: res?.timelineMonths ?? 0,
      confidenceScore: res?.confidence ?? null,
      confidenceLabel: res?.confidenceLabel ?? null,
      profitRange: res?.sensitivity?.profitRange ?? null,
      breakevenSalePct: res?.sensitivity?.breakevenSaleMultiplier ?? null,
      bearProfit: res?.sensitivity?.bear.profit ?? null,
      bullProfit: res?.sensitivity?.bull.profit ?? null,
      summary: res?.sensitivity?.summary ?? null,
      feasibilityReason: reasoning?.summary ?? "",
    };
  });

  // 7. Recommendation: highest projected profit among feasible (permitted)
  // strategies with confidence ≥ 50. Conditional strategies count at 70% of
  // their profit. Not-allowed strategies are excluded.
  const scored = strategies
    .filter((s) => s.feasibility !== "not_allowed")
    .map((s) => {
      const conf = s.confidenceScore ?? 50;
      const feasMultiplier = s.feasibility === "permitted" ? 1.0 : 0.7;
      const score = s.projectedProfit * feasMultiplier * (conf / 100);
      return { ...s, _score: score };
    })
    .sort((a, b) => b._score - a._score);
  const top = scored[0];
  const redFlags = strategies
    .filter((s) => s.feasibility === "not_allowed")
    .map((s) => ({
      strategy: s.strategy,
      label: s.label,
      why: s.feasibilityReason,
    }));

  const reasoning: string[] = [];
  if (top) {
    reasoning.push(
      `${top.label} projects $${Math.round(top.projectedProfit / 1000)}k profit ` +
      `(${top.roi.toFixed(0)}% ROI, ${top.timelineMonths}-month timeline)${top.confidenceLabel ? ` at ${top.confidenceLabel} confidence` : ""}.`,
    );
    if (top.profitRange) {
      reasoning.push(
        `Stress-tested profit range: $${Math.round(top.profitRange.min / 1000)}k → $${Math.round(top.profitRange.max / 1000)}k. ` +
        `${top.bearProfit !== null && top.bearProfit > 0 ? "Survives the bear case." : "Bear case turns negative."}`,
      );
    }
    if (hazards && hazards.severityLabel !== "clear") {
      reasoning.push(
        `Hazard profile: ${hazards.severityLabel} (${hazards.severityScore}/100). ` +
        `Review the ${hazards.topCaveats.length} flagged items before committing capital.`,
      );
    }
    if (overlay.middleHousing) {
      reasoning.push(
        `WA ${overlay.middleHousing.statute} unlocks up to ${overlay.middleHousing.maxUnitsPerLot} units per lot here ` +
        `regardless of the base single-family zoning — this expands beyond the headline strategy.`,
      );
    }
  } else {
    reasoning.push(
      `No strategy scored above the feasibility threshold. ` +
      `Likely causes: hazard floors blocking redevelopment, zoning kind mismatch, or lot too small.`,
    );
  }

  const recommendation: ReportRecommendation = {
    topStrategy: top?.strategy ?? null,
    topStrategyLabel: top?.label ?? "Pass",
    reasoning,
    redFlags,
  };

  return {
    generatedAt: new Date().toISOString(),
    property,
    identity,
    zoning,
    hazards,
    history,
    market,
    strategies,
    recommendation,
  };
}
