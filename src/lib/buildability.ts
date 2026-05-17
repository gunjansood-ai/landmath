/**
 * Buildability + Neighborhood Guardrails
 *
 * Implements §5 of ARCHITECT_MODE_PLAN.md:
 *   - Typology bucketing (PREUSE_DESC → SFR / Duplex / Triplex / ... )
 *   - Strategy → target-typology mapping
 *   - Typology fit grading (common / present / rare / absent)
 *   - Size guardrail (median × 1.175, outlier pullback)
 *   - Rate-of-change override (HB 1337 ADU surge + multi-unit trend)
 *   - 0–100 confidence scoring + caveats
 *
 * All inputs are kept generic so this module can run on King County data today
 * and on any future county adapter without changes.
 */

import { Strategy } from "@/store/useStore";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TypologyBucket =
  | "sfr"
  | "sfr_with_adu"
  | "duplex"
  | "triplex"
  | "fourplex"
  | "five_plus"
  | "condo"
  | "other";

export type TypologyFit = "common" | "present" | "rare" | "absent";

export interface Comp {
  pin: string;
  address: string;
  salePrice: number;
  saleDate: string;        // ISO or yyyy-mm-dd
  principalUse: string;    // raw PREUSE_DESC for transparency
  typology: TypologyBucket;
  sqftLiving?: number;     // populated when assessor lookup succeeds
  yearBuilt?: number;      // populated when assessor lookup succeeds
  isNewConstructionAtSale?: boolean; // true when yearBuilt ≥ saleYear - 5
  lotSizeSqft?: number;
  distanceM?: number;      // distance from subject parcel
  pricePerSqft?: number;
  sourceUrl: string;       // KC Assessor / county detail page — drill-in link
  parcelViewerUrl?: string;
}

export interface ParcelSample {
  pin: string;
  address: string | null;
  presentUse: string | null;
  typology: TypologyBucket;
  lotSizeSqft?: number;
  sourceUrl: string;
}

export interface TypologyDistribution {
  total: number;
  counts: Record<TypologyBucket, number>;
  shares: Record<TypologyBucket, number>;
}

export interface NeighborhoodData {
  radiusM: number;             // resolved adaptive radius (400 / 800 / 1609 m)
  parcelCount: number;
  parcels: ParcelSample[];     // sampled parcels (capped for payload size)
  sales: Comp[];               // cited recent sales
  typology: TypologyDistribution;
  recentMultiUnitCount: number; // non-SFR + ADU sales/permits in last 24mo
  medianHomeSqft: number | null;
  p25HomeSqft: number | null;
  p75HomeSqft: number | null;
  medianLotSqft: number | null;
  isSparse: boolean;            // true when even 1.0 mi yields < 20 parcels
  sourceCity: string | null;
}

export type CaveatSeverity = "info" | "warning" | "block";

export interface Caveat {
  severity: CaveatSeverity;
  text: string;
}

export interface SizeGuardrail {
  medianSqft: number | null;
  p25Sqft: number | null;
  p75Sqft: number | null;
  targetSqft: number;
  isOutlier: boolean;
  nearTargetCount: number;
  safeMaxSqft: number;
}

export interface NeighborhoodGuardrails {
  strategy: Strategy;
  targetTypology: TypologyBucket;
  typologyFit: TypologyFit;
  typologyShare: number;
  trendBumpApplied: boolean;
  size: SizeGuardrail;
  caveats: Caveat[];
  confidenceCapAt40: boolean;    // "absent" forces overall confidence ≤ 40
}

export interface ConfidenceInputs {
  zoningKnown: boolean;          // do we have a city-specific rule?
  zoningRecentlyVerified: boolean; // verified within 90 days?
  lotSizeFromGis: boolean;       // authoritative lot data?
  compsCount: number;            // # of recent sales in radius
  compsAreRecent: boolean;       // any < 12 months old?
  guardrails: NeighborhoodGuardrails;
}

export interface ConfidenceResult {
  score: number;                 // 0–100
  label: "High" | "Moderate" | "Low" | "Speculative";
  components: {
    zoning: number;
    lot: number;
    comps: number;
    strategyFit: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const FIT_THRESHOLDS = {
  common: 0.20,   // ≥ 1 in 5 neighbors
  present: 0.05,  // some neighbors
  rare: 0.01,     // at least one neighbor
} as const;

export const FIT_PENALTY: Record<TypologyFit, number> = {
  common: 0,
  present: -5,
  rare: -12,
  absent: 0, // handled separately by capAt40
};

// Adaptive radius probe order (meters)
export const ADAPTIVE_RADII_M = [400, 800, 1609] as const;
export const MIN_PARCELS_FOR_TYPOLOGY = 20;
export const TREND_LOOKBACK_MONTHS = 24;
export const TREND_TRIGGER_COUNT = 3;

// ─────────────────────────────────────────────────────────────────────────────
// PREUSE_DESC → typology bucket
// ─────────────────────────────────────────────────────────────────────────────

// Order matters: check more specific patterns BEFORE generic "single family".
const PREUSE_PATTERNS: Array<[TypologyBucket, RegExp[]]> = [
  ["sfr_with_adu", [/accessory\s*dwelling/i, /\bADU\b/i, /\bDADU\b/i, /with\s+adu/i]],
  ["five_plus",    [/apartment/i, /5\s*-\s*9/i, /10\s*-\s*\d+/i, /\d{2,}\s*units?/i, /multi[-\s]*family/i, /\bmfr\b/i]],
  ["fourplex",     [/four[-\s]*plex/i, /4[-\s]*plex/i, /quadplex/i, /4\s*units?/i]],
  ["triplex",      [/triplex/i, /three[-\s]*unit/i, /3\s*units?/i]],
  ["duplex",       [/duplex/i, /two[-\s]*unit/i, /2\s*units?/i]],
  ["condo",        [/condo/i, /condominium/i]],
  ["sfr",          [/single\s*family/i, /\bSFR\b/i, /residence/i, /residential/i]],
];

export function bucketParcelByPreuse(
  presentUse: string | null | undefined
): TypologyBucket {
  if (!presentUse) return "other";
  for (const [bucket, patterns] of PREUSE_PATTERNS) {
    if (patterns.some((re) => re.test(presentUse))) return bucket;
  }
  return "other";
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy → target typology
// ─────────────────────────────────────────────────────────────────────────────

export function mapStrategyToTypology(strategy: Strategy): TypologyBucket {
  switch (strategy) {
    case "fresh_build": return "sfr";
    case "split_build": return "sfr";          // each resulting lot is an SFR
    case "main_adu":    return "sfr_with_adu"; // 1 ADU; see HB 1337 floor below
    case "flip_fix":    return "sfr";          // preserves current form
    case "pass":
    default:            return "sfr";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Typology distribution
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_BUCKETS: Record<TypologyBucket, number> = {
  sfr: 0, sfr_with_adu: 0, duplex: 0, triplex: 0,
  fourplex: 0, five_plus: 0, condo: 0, other: 0,
};

export function computeTypologyDistribution(
  parcels: Array<{ typology: TypologyBucket }>
): TypologyDistribution {
  const counts = { ...EMPTY_BUCKETS };
  for (const p of parcels) counts[p.typology] = (counts[p.typology] ?? 0) + 1;
  const total = parcels.length;
  const shares = { ...EMPTY_BUCKETS };
  if (total > 0) {
    for (const k of Object.keys(counts) as TypologyBucket[]) {
      shares[k] = counts[k] / total;
    }
  }
  return { total, counts, shares };
}

// ─────────────────────────────────────────────────────────────────────────────
// Typology fit grading
// ─────────────────────────────────────────────────────────────────────────────

export interface FitResult {
  fit: TypologyFit;
  share: number;
  count: number;
  trendBumpApplied: boolean;
}

export function gradeTypologyFit(
  distribution: TypologyDistribution,
  target: TypologyBucket,
  trendCount: number,
  is1AduStrategy: boolean = false
): FitResult {
  const share = distribution.shares[target] ?? 0;
  const count = distribution.counts[target] ?? 0;

  let fit: TypologyFit;
  if (share >= FIT_THRESHOLDS.common) fit = "common";
  else if (share >= FIT_THRESHOLDS.present) fit = "present";
  else if (share >= FIT_THRESHOLDS.rare || count >= 1) fit = "rare";
  else fit = "absent";

  // HB 1337 floor: 1-ADU is functionally allowed statewide → floor at "present"
  if (is1AduStrategy && target === "sfr_with_adu") {
    if (fit === "absent" || fit === "rare") fit = "present";
  }

  // Trend bump applies to all non-SFR typologies including ADU
  let trendBumpApplied = false;
  if (trendCount >= TREND_TRIGGER_COUNT && target !== "sfr") {
    trendBumpApplied = true;
    if (fit === "absent") fit = "rare";
    else if (fit === "rare") fit = "present";
    else if (fit === "present") fit = "common";
  }

  return { fit, share, count, trendBumpApplied };
}

// ─────────────────────────────────────────────────────────────────────────────
// Size guardrail
// ─────────────────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function computeSizeGuardrail(
  compSqfts: number[],
  maxBuildableByZoning: number
): SizeGuardrail {
  const valid = compSqfts.filter((s) => s > 200); // discard nonsense rows
  if (valid.length === 0) {
    return {
      medianSqft: null, p25Sqft: null, p75Sqft: null,
      targetSqft: maxBuildableByZoning,
      isOutlier: false,
      nearTargetCount: 0,
      safeMaxSqft: maxBuildableByZoning,
    };
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  const target = Math.round(median * 1.175);

  const within15pct = (s: number) =>
    target > 0 ? Math.abs(s - target) / target <= 0.15 : false;
  const nearTargetCount = valid.filter(within15pct).length;
  const isOutlier = nearTargetCount < 3;

  const safeMaxSqft = isOutlier
    ? Math.min(target, Math.round(p75 * 1.10), maxBuildableByZoning)
    : Math.min(target, maxBuildableByZoning);

  return {
    medianSqft: median,
    p25Sqft: p25,
    p75Sqft: p75,
    targetSqft: target,
    isOutlier,
    nearTargetCount,
    safeMaxSqft: Math.max(0, safeMaxSqft),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Caveat generation
// ─────────────────────────────────────────────────────────────────────────────

function formatTypologyLabel(t: TypologyBucket): string {
  switch (t) {
    case "sfr": return "single-family home";
    case "sfr_with_adu": return "home with ADU";
    case "duplex": return "duplex";
    case "triplex": return "triplex";
    case "fourplex": return "fourplex";
    case "five_plus": return "small apartment building";
    case "condo": return "condo";
    default: return "structure";
  }
}

function buildCaveats(
  fit: FitResult,
  size: SizeGuardrail,
  target: TypologyBucket,
  isSparse: boolean
): Caveat[] {
  const caveats: Caveat[] = [];
  const label = formatTypologyLabel(target);
  const pct = (fit.share * 100).toFixed(0);

  if (isSparse) {
    caveats.push({
      severity: "warning",
      text:
        "Insufficient neighborhood data — fewer than 20 residential parcels even at 1.0 mi. " +
        "Typology and size signals are weak; treat this analysis as directional.",
    });
  }

  switch (fit.fit) {
    case "common":
      // No caveat unless trend bump tells a story
      if (fit.trendBumpApplied) {
        caveats.push({
          severity: "info",
          text: `Neighborhood is gaining ${label}s — recent permit activity boosts the ${label} option from baseline.`,
        });
      }
      break;
    case "present":
      caveats.push({
        severity: "info",
        text: `${label[0].toUpperCase() + label.slice(1)} is less common but established here (${pct}% of nearby parcels).`,
      });
      break;
    case "rare":
      caveats.push({
        severity: "warning",
        text:
          `Few ${label}s nearby — you'd be the 2nd or 3rd. ` +
          `Resale pool narrower than typical SFR; expect longer DOM and investor-tilted buyers.`,
      });
      break;
    case "absent":
      caveats.push({
        severity: "block",
        text:
          `You would be the only ${label} in this neighborhood. State law may permit it, ` +
          `but resale buyers will be investors, not families. Treat as a rental hold, not a flip.`,
      });
      break;
  }

  if (fit.trendBumpApplied && fit.fit !== "common") {
    caveats.push({
      severity: "info",
      text:
        "Trend signal: 3+ non-SFR or ADU projects nearby in last 24 months. " +
        "Form is gaining precedent — you're early but not alone.",
    });
  }

  if (size.medianSqft && size.isOutlier) {
    caveats.push({
      severity: "warning",
      text:
        `Few neighbors near the target build size (${size.targetSqft.toLocaleString()} sqft). ` +
        `Recommended build pulled back to ${size.safeMaxSqft.toLocaleString()} sqft to avoid being an outlier at resale.`,
    });
  }

  return caveats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level: build the full guardrails for a strategy
// ─────────────────────────────────────────────────────────────────────────────

export interface ComputeGuardrailsInput {
  strategy: Strategy;
  neighborhood: NeighborhoodData;
  maxBuildableByZoning: number;
}

export function computeNeighborhoodGuardrails({
  strategy,
  neighborhood,
  maxBuildableByZoning,
}: ComputeGuardrailsInput): NeighborhoodGuardrails {
  const targetTypology = mapStrategyToTypology(strategy);
  const is1AduStrategy = strategy === "main_adu";

  const fit = gradeTypologyFit(
    neighborhood.typology,
    targetTypology,
    neighborhood.recentMultiUnitCount,
    is1AduStrategy
  );

  // Size guardrail uses living sqft of recent sales when available.
  const compSqfts = neighborhood.sales
    .map((s) => s.sqftLiving ?? 0)
    .filter((v) => v > 0);
  const size = computeSizeGuardrail(compSqfts, maxBuildableByZoning);

  const caveats = buildCaveats(fit, size, targetTypology, neighborhood.isSparse);

  return {
    strategy,
    targetTypology,
    typologyFit: fit.fit,
    typologyShare: fit.share,
    trendBumpApplied: fit.trendBumpApplied,
    size,
    caveats,
    confidenceCapAt40: fit.fit === "absent",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence scoring (§6 in the plan)
// ─────────────────────────────────────────────────────────────────────────────

export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  // Zoning axis: 40 pts
  let zoning = 0;
  if (inputs.zoningKnown) zoning += 28;
  if (inputs.zoningRecentlyVerified) zoning += 12;

  // Lot axis: 20 pts
  const lot = inputs.lotSizeFromGis ? 20 : 10;

  // Comps axis: 20 pts (proportional to sample density + recency)
  let comps = 0;
  if (inputs.compsCount >= 8) comps = 20;
  else if (inputs.compsCount >= 5) comps = 15;
  else if (inputs.compsCount >= 3) comps = 10;
  else if (inputs.compsCount >= 1) comps = 5;
  if (!inputs.compsAreRecent) comps = Math.max(0, comps - 5);
  if (inputs.guardrails.size.isOutlier) comps = Math.max(0, comps - 3);

  // Strategy fit axis: 20 pts (penalty per §5c)
  let strategyFit = 20;
  strategyFit += FIT_PENALTY[inputs.guardrails.typologyFit] ?? 0;
  strategyFit = Math.max(0, strategyFit);

  const raw = zoning + lot + comps + strategyFit;
  const score = inputs.guardrails.confidenceCapAt40
    ? Math.min(40, raw)
    : Math.min(100, raw);

  let label: ConfidenceResult["label"] = "Speculative";
  if (score >= 85) label = "High";
  else if (score >= 65) label = "Moderate";
  else if (score >= 40) label = "Low";

  return {
    score,
    label,
    components: { zoning, lot, comps, strategyFit },
  };
}
