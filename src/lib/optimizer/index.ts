/**
 * Development Scenario Optimizer
 * ──────────────────────────────
 * Answers one question: "What is the MOST PROFITABLE legal thing I can do
 * with this land?" — by enumerating every development combination the zoning
 * envelope + WA state law allows (lot splits × building forms × unit counts ×
 * ADUs × exit strategies), pricing each one with the same calibrated cost
 * model as calculations.ts, and ranking them by risk-adjusted profit.
 *
 * Differences from the fixed 6-strategy list in calculations.ts:
 *   - Considers 2/3/4-lot short plats (not just 2), where min-lot math allows.
 *   - Considers ADU/DADU stacking on every lot of a split (HB 1337).
 *   - Considers 2/4/6-unit middle housing per lot (HB 1110 tiers + each
 *     city's ADOPTED ordinance from the registry, which may exceed the floor).
 *   - Considers three exits where they make sense: SELL, HOLD (rent, with
 *     cash-out refi = BRRRR mechanics), for every physical configuration.
 *   - Every scenario carries a confidence score; the headline recommendation
 *     is the highest risk-adjusted profit at MEDIUM-or-better confidence.
 *
 * All zoning verdicts cite the registry rule (municipal code section) and/or
 * the state statute that makes the configuration legal.
 */

import type { PropertyData, QualityTier, FinancingConfig } from "@/store/useStore";
import {
  lookupZoning,
  allowsTownhomes,
  allowsMultifamily,
  type ZoningRule,
} from "@/lib/zoning/registry";
import { applyStateLaws, type StateLawAdjustedRule } from "@/lib/zoning/wa-state-laws";
import {
  QUALITY_TIERS,
  calculateMonthlyPayment,
  getDefaultSellPricePerSqft,
  getMarketRentDefaults,
  estimateDistrictMinLotSqft,
  getSellMonths,
} from "@/lib/calculations";
import { computeDrawSchedule } from "@/lib/draw-schedule";
import {
  hazardFeasibilityFloor,
  combineFeasibility,
  hazardConfidencePenalty,
} from "@/lib/hazards/kc-gis";
import { computeNeighborhoodGuardrails } from "@/lib/buildability";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScenarioForm =
  | "sfr"            // detached single-family (per lot)
  | "sfr_adu"        // SFR + 1..2 ADUs per lot
  | "plex"           // 2-6 attached/stacked units on one lot (middle housing)
  | "townhome"       // rowhouse run, unit-lot subdivision exit
  | "multifamily"    // stacked apartments at zone density
  | "flip"           // renovate existing structure
  | "keep_dadu";     // keep existing house, add DADUs

export type ScenarioExit = "sell" | "hold";

export interface Citation { label: string; url: string }

export interface DevelopmentEnvelope {
  rule: ZoningRule | null;
  stateLaw: StateLawAdjustedRule;
  minLotSqft: number | null;
  maxLots: number;
  /** Max units on a single lot after HB 1110 / adopted ordinances. */
  maxUnitsPerLot: number;
  /** Whole-parcel unit cap from density (du/acre) zones; null = not density-governed. */
  maxUnitsByDensity: number | null;
  maxAdusPerLot: number;
  unitLotSubdivision: boolean;
  citations: Citation[];
  /** Buildable sqft cap per lot from coverage/height envelope (null = unknown). */
  perLotBuildableCap: (perLotSqft: number) => number;
}

export interface ScenarioFinancials {
  revenue: number;
  acquisitionCost: number;
  constructionCost: number;
  holdingCost: number;
  sellingCosts: number;
  totalProjectCost: number;
  /** Peak cash tied up — sizes the bankroll ("Cash needed" in the UI). */
  totalCashInvested: number;
  /** Weighted-average cash deployed over the project life (draw schedule). ROI denominator. */
  avgCashDeployed: number;
  profit: number;             // sell: net profit. hold: development equity created.
  roi: number;                // % on avg cash deployed (matches calculations.ts convention)
  annualizedRoi: number;
  timelineMonths: number;
  // hold-exit extras
  noi?: number;
  capRate?: number;
  stabilizedValue?: number;
  refiLoan?: number;
  cashLeftInDeal?: number;    // after cash-out refi (BRRRR)
  annualCashFlow?: number;
  cashOnCash?: number;        // % on cash left in deal (capped at 999)
  monthlyGrossRent?: number;
}

export interface ScenarioResult {
  id: string;
  label: string;
  shortLabel: string;
  form: ScenarioForm;
  exit: ScenarioExit;
  lots: number;
  unitsPerLot: number;
  adusPerLot: number;
  totalUnits: number;
  totalBuildSqft: number;
  feasibility: "permitted" | "conditional";
  confidence: number;             // 0–100
  confidenceLabel: "High" | "Medium" | "Low";
  score: number;                  // risk-adjusted ranking metric
  financials: ScenarioFinancials;
  why: string[];                  // plain-english reasoning bullets
  citations: Citation[];
  notes: string[];                // caveats / verification flags
}

export interface OptimizerReport {
  best: ScenarioResult | null;    // top scenario at Medium+ confidence
  scenarios: ScenarioResult[];    // Medium+ confidence, ranked
  longShots: ScenarioResult[];    // Low confidence, ranked (shown collapsed)
  envelopeSummary: {
    zoningCode: string;
    city: string;
    codeSection: string | null;
    minLotSqft: number | null;
    maxLots: number;
    maxUnitsPerLot: number;
    maxAdusPerLot: number;
    registryHit: boolean;
    verified: "verified" | "secondary" | "unverified" | null;
  };
  citations: Citation[];
}

// ─── Calibration constants (aligned with calculations.ts) ───────────────────

const FORM_COST_MULT: Record<string, number> = {
  sfr: 1.0,
  adu: 1.08,        // small detached structures cost slightly more per sqft
  plex: 0.88,       // shared walls/foundation, still townhouse-grade
  townhome: 0.82,   // matches calculateTownhomeAnalysis
  multifamily: 0.75, // matches calculateMultiFamilyAnalysis
};

const FORM_PRICE_MULT: Record<string, number> = {
  sfr: 1.0,
  adu: 0.85,        // ADU sqft sells at a discount to main-house sqft
  plex: 0.85,       // stacked condo/flat discount vs detached
  townhome: 0.90,   // matches calculateTownhomeAnalysis
  multifamily: 0.80, // condo exit discount
};

const BUILD_RATE_SQFT_PER_MONTH: Record<string, number> = {
  sfr: 400, adu: 350, plex: 450, townhome: 500, multifamily: 700,
};

const UNIT_SQFT = { adu: 1000, plex: 1050, townhome: 1400, mf: 800 };

/** Small-residential cap rates for stabilized value (KC 2026 ballpark). */
const CAP_RATE = { sfr: 5.8, plex: 5.6, townhome: 5.6, multifamily: 5.4 };

const SELL_COST_PCT = 0.078; // 5% commission + 1.8% WA REET + 1% concessions

// ─── Envelope ────────────────────────────────────────────────────────────────

export function computeEnvelope(property: PropertyData): DevelopmentEnvelope {
  const rule = lookupZoning({
    state: property.state, city: property.city, code: property.zoningCode,
  });
  const stateLaw = applyStateLaws({
    city: property.city,
    state: property.state,
    baseRule: rule,
    // KC parcels our GIS resolves are effectively all inside the UGA when the
    // zone is urban residential. Rural RA zones are excluded below anyway.
    inUrbanGrowthArea: property.isKingCounty !== false,
    nearMajorTransit: false, // conservative: we don't have the transit signal yet
  });

  const minLotSqft =
    rule?.minLotSqft ??
    estimateDistrictMinLotSqft(property.zoningCode, property.city, property.state) ??
    null;

  const lot = property.lotSizeSqft || 0;
  const canPlat = rule ? rule.allowsShortPlat : true;
  const maxLots =
    canPlat && minLotSqft && minLotSqft > 0
      ? Math.max(1, Math.min(4, Math.floor(lot / minLotSqft)))
      : 1;

  const maxUnitsByDensity = rule?.maxDuPerAcre
    ? Math.max(1, Math.floor((lot / 43560) * rule.maxDuPerAcre))
    : null;

  // Per-lot unit ceiling: state-law overlay (2/4/6) or, for true MF zones,
  // whatever density supports on the whole parcel.
  const maxUnitsPerLot = Math.min(
    stateLaw.effectiveMaxUnitsPerLot >= 99
      ? Math.max(4, maxUnitsByDensity ?? 4)
      : stateLaw.effectiveMaxUnitsPerLot,
    24,
  );

  const isRural = rule?.kind === "rural";
  const maxAdusPerLot = isRural ? 1 : (stateLaw.adu?.maxAduPerLot ?? 0);

  const citations: Citation[] = [];
  if (rule) citations.push({ label: rule.codeSection, url: rule.codeUrl });
  citations.push(...stateLaw.citations);

  const env = rule?.envelope;
  const perLotBuildableCap = (perLotSqft: number): number => {
    const coveragePct = env?.maxLotCoveragePct ?? env?.maxImperviousPct ?? 40;
    const footprint = perLotSqft * (coveragePct / 100);
    const stories = env?.maxHeightFt ? Math.min(3, Math.max(1.5, env.maxHeightFt / 11)) : 2.5;
    const byCoverage = footprint * stories;
    const byFar = env?.maxFAR ? perLotSqft * env.maxFAR : Infinity;
    return Math.round(Math.min(byCoverage, byFar));
  };

  return {
    rule, stateLaw, minLotSqft, maxLots, maxUnitsPerLot, maxUnitsByDensity,
    maxAdusPerLot,
    unitLotSubdivision: stateLaw.unitLot?.available ?? false,
    citations, perLotBuildableCap,
  };
}

// ─── Scenario enumeration ────────────────────────────────────────────────────

interface RawScenario {
  form: ScenarioForm;
  exit: ScenarioExit;
  lots: number;
  unitsPerLot: number;
  adusPerLot: number;
  zoningVerdict: "permitted" | "conditional";
  legal: Citation[];
  legalWhy: string;
  notes: string[];
}

function splitVerdict(
  lot: number, minLot: number, lots: number,
): "permitted" | "conditional" | "not_allowed" {
  if (lot >= minLot * lots * 1.10) return "permitted";
  if (lot >= minLot * lots) return "conditional";
  return "not_allowed";
}

function enumerateScenarios(
  property: PropertyData,
  env: DevelopmentEnvelope,
): RawScenario[] {
  const out: RawScenario[] = [];
  const lot = property.lotSizeSqft || 0;
  const rule = env.rule;
  const mh = env.stateLaw.middleHousing;
  const adoptedUnits = rule?.middleHousingUnitsPerLot ?? 0;
  const exits: ScenarioExit[] = ["sell", "hold"];

  const ruleCite: Citation[] = rule ? [{ label: rule.codeSection, url: rule.codeUrl }] : [];
  const mhCite: Citation[] = mh ? [{ label: mh.statute ?? "HB 1110", url: mh.codeUrl }] : [];
  const aduCite: Citation[] = env.stateLaw.adu
    ? [{ label: "HB 1337 (RCW 36.70A.681) — 2 ADUs by right", url: env.stateLaw.adu.codeUrl }]
    : [];
  const ulCite: Citation[] = env.stateLaw.unitLot
    ? [{ label: "SB 5258 unit-lot subdivision", url: env.stateLaw.unitLot.codeUrl }]
    : [];

  // How many lots can we plausibly plat? (feasibility computed per count)
  const lotCounts: Array<{ lots: number; verdict: "permitted" | "conditional" }> = [{ lots: 1, verdict: "permitted" }];
  if (env.minLotSqft && rule?.allowsShortPlat !== false) {
    for (let n = 2; n <= env.maxLots; n++) {
      const v = splitVerdict(lot, env.minLotSqft, n);
      if (v !== "not_allowed") lotCounts.push({ lots: n, verdict: v });
    }
  } else if (!env.minLotSqft && lot >= 15000 && rule?.allowsShortPlat !== false) {
    lotCounts.push({ lots: 2, verdict: "conditional" });
  }

  for (const { lots, verdict } of lotCounts) {
    const perLot = lot / lots;
    const splitWhy = lots > 1
      ? `Short plat into ${lots} lots of ~${Math.round(perLot).toLocaleString()} sqft each (min lot ${env.minLotSqft?.toLocaleString()} sqft${rule ? `, ${rule.codeSection}` : ""}).`
      : "";

    // 1) SFR per lot
    for (const exit of exits) {
      out.push({
        form: "sfr", exit, lots, unitsPerLot: 1, adusPerLot: 0,
        zoningVerdict: verdict, legal: ruleCite,
        legalWhy: splitWhy || `Detached single-family home is permitted outright${rule ? ` (${rule.codeSection})` : ""}.`,
        notes: [],
      });
    }

    // 2) SFR + ADUs per lot (HB 1337) — needs reasonable per-lot area
    if (env.maxAdusPerLot > 0 && perLot >= 4000) {
      const aduVerdict = perLot >= 5000 ? verdict : worst(verdict, "conditional");
      for (const aduCount of env.maxAdusPerLot >= 2 ? [1, 2] : [1]) {
        for (const exit of exits) {
          out.push({
            form: "sfr_adu", exit, lots, unitsPerLot: 1, adusPerLot: aduCount,
            zoningVerdict: aduVerdict, legal: [...ruleCite, ...aduCite],
            legalWhy: `${splitWhy ? splitWhy + " " : ""}HB 1337 requires ${property.city || "the city"} to allow ${aduCount} ADU${aduCount > 1 ? "s" : ""} (up to 1,000 sqft each) on every residential lot in a UGA — no owner-occupancy requirement, and ADUs can be sold as condos.`,
            notes: exit === "sell"
              ? ["Sell revenue assumes ADUs are condo-ized and sold separately (HB 1337 permits this) or captured in a premium package sale — validate ADU resale demand with an agent."]
              : [],
          });
        }
      }
    }

    // 3) Middle-housing plex per lot (duplex → sixplex)
    const plexCounts = [2, 3, 4, 6].filter((u) => u <= env.maxUnitsPerLot);
    for (const u of plexCounts) {
      // Verdict: adopted local ordinance ≥ u → permitted; base zone kind allows → permitted;
      // otherwise state-law floor → conditional (city process still applies).
      const byRight =
        (rule?.kind === "duplex" && u <= 2) ||
        (rule?.kind === "multifamily") ||
        adoptedUnits >= u;
      const v = byRight ? verdict : mh && mh.maxUnitsPerLot >= u ? worst(verdict, "conditional") : null;
      if (!v) continue;
      // Physical sanity: need ~1,500 sqft of lot per unit at least
      if (perLot / u < 1200) continue;
      for (const exit of exits) {
        out.push({
          form: "plex", exit, lots, unitsPerLot: u, adusPerLot: 0,
          zoningVerdict: v,
          legal: byRight ? [...ruleCite] : [...ruleCite, ...mhCite],
          legalWhy: `${splitWhy ? splitWhy + " " : ""}${byRight
            ? adoptedUnits >= u
              ? `${property.city} has ADOPTED middle-housing rules allowing ${adoptedUnits} units/lot${rule ? ` (${rule.codeSection})` : ""}.`
              : `Zone permits ${u} units on this lot by right${rule ? ` (${rule.codeSection})` : ""}.`
            : `${mh?.statute} requires ${property.city} to allow ${mh?.maxUnitsPerLot} units per residential lot — ${u}-plex qualifies as middle housing.`}`,
          notes: byRight ? [] : ["City middle-housing implementation details (design review, parking) may add conditions — verify with the planning counter."],
        });
      }
    }

    if (lots > 1) continue; // townhome rows / MF / flip / keep only modeled on the parent lot

    // 4) Townhome row with unit-lot subdivision (fee-simple sale)
    const thAllowed = allowsTownhomes(rule) || (mh && mh.maxUnitsPerLot >= 2);
    if (thAllowed) {
      const thMax = Math.min(
        env.maxUnitsPerLot >= 4 ? env.maxUnitsPerLot : 0,
        env.maxUnitsByDensity ?? 12,
        Math.floor(lot / 1600), // ~1,600 sqft of land per TH unit incl. access
        10,
      );
      for (const u of [4, 6, 8, 10].filter((n) => n <= thMax)) {
        const byRight = allowsTownhomes(rule) && (env.maxUnitsByDensity == null || u <= env.maxUnitsByDensity) && (adoptedUnits >= u || allowsMultifamily(rule) || rule?.kind === "sf_attached");
        for (const exit of exits) {
          out.push({
            form: "townhome", exit, lots: 1, unitsPerLot: u, adusPerLot: 0,
            zoningVerdict: byRight ? "permitted" : "conditional",
            legal: [...ruleCite, ...(byRight ? [] : mhCite), ...ulCite],
            legalWhy: `${u} attached rowhouses${env.unitLotSubdivision ? ", each sellable fee-simple on its own unit lot (SB 5258 — parent-lot minimums don't apply to unit lots)" : ""}. ${byRight ? `Attached housing is permitted in this zone${rule ? ` (${rule.codeSection})` : ""}.` : `${mh?.statute} pre-empts the single-family limit here.`}`,
            notes: [],
          });
        }
      }
    }

    // 5) Stacked multifamily at zone density
    if (allowsMultifamily(rule) && env.maxUnitsByDensity && env.maxUnitsByDensity >= 4) {
      const u = Math.min(env.maxUnitsByDensity, 24);
      for (const exit of exits) {
        out.push({
          form: "multifamily", exit, lots: 1, unitsPerLot: u, adusPerLot: 0,
          zoningVerdict: "permitted", legal: ruleCite,
          legalWhy: `Zone allows stacked multifamily at ${rule?.maxDuPerAcre} du/acre → up to ${u} units on this ${(lot / 43560).toFixed(2)}-acre parcel (${rule?.codeSection}).`,
          notes: u >= 10 ? ["10+ unit projects trigger more design review and longer lease-up — modeled conservatively."] : [],
        });
      }
    }

    // 6) Flip existing structure (sell only — modeled as renovate & resell)
    if ((property.currentSqft ?? 0) >= 800 && (property.yearBuilt ?? 0) > 0) {
      out.push({
        form: "flip", exit: "sell", lots: 1, unitsPerLot: 1, adusPerLot: 0,
        zoningVerdict: "permitted", legal: [],
        legalWhy: "Renovating the existing structure needs no zoning change.",
        notes: [],
      });
    }

    // 7) Keep existing house + add DADUs (cheapest construction path)
    if ((property.currentSqft ?? 0) >= 1000 && env.maxAdusPerLot > 0 && lot >= 5000) {
      const aduCount = env.maxAdusPerLot >= 2 ? 2 : 1;
      for (const exit of exits) {
        out.push({
          form: "keep_dadu", exit, lots: 1, unitsPerLot: 1, adusPerLot: aduCount,
          zoningVerdict: "permitted", legal: aduCite,
          legalWhy: `Keep the existing ${property.currentSqft?.toLocaleString()} sqft house and add ${aduCount} DADU${aduCount > 1 ? "s" : ""} (HB 1337 right) — no demo, no plat, fastest permit path.`,
          notes: [],
        });
      }
    }
  }

  // Dedupe
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.form}|${s.exit}|${s.lots}|${s.unitsPerLot}|${s.adusPerLot}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function worst(
  a: "permitted" | "conditional",
  b: "permitted" | "conditional",
): "permitted" | "conditional" {
  return a === "conditional" || b === "conditional" ? "conditional" : "permitted";
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

const FORM_LABEL: Record<ScenarioForm, string> = {
  sfr: "New SFR",
  sfr_adu: "SFR + ADU",
  plex: "Middle housing",
  townhome: "Townhomes",
  multifamily: "Apartments",
  flip: "Fix & flip",
  keep_dadu: "Keep house + DADU",
};

function buildLabel(s: RawScenario): { label: string; shortLabel: string } {
  const parts: string[] = [];
  if (s.lots > 1) parts.push(`Split into ${s.lots} lots`);
  switch (s.form) {
    case "sfr": parts.push(s.lots > 1 ? "new SFR on each" : "Tear down → new SFR"); break;
    case "sfr_adu": parts.push(`${s.lots > 1 ? "SFR" : "New SFR"} + ${s.adusPerLot} ADU${s.adusPerLot > 1 ? "s" : ""}${s.lots > 1 ? " on each" : ""}`); break;
    case "plex": parts.push(`${s.unitsPerLot}-unit middle housing${s.lots > 1 ? " on each" : ""}`); break;
    case "townhome": parts.push(`${s.unitsPerLot} townhomes (fee-simple)`); break;
    case "multifamily": parts.push(`${s.unitsPerLot}-unit apartment building`); break;
    case "flip": parts.push("Renovate existing house"); break;
    case "keep_dadu": parts.push(`Keep house, add ${s.adusPerLot} DADU${s.adusPerLot > 1 ? "s" : ""}`); break;
  }
  parts.push(s.exit === "sell" ? "sell" : "hold & rent (refi)");
  const label = parts.join(" · ");
  const totalUnits = s.lots * (s.unitsPerLot + s.adusPerLot);
  const shortLabel = `${FORM_LABEL[s.form]}${totalUnits > 1 ? ` ×${totalUnits}` : ""}`;
  return { label, shortLabel };
}

export function evaluateScenario(
  property: PropertyData,
  env: DevelopmentEnvelope,
  raw: RawScenario,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
): ScenarioResult | null {
  const lot = property.lotSizeSqft || 0;
  const perLot = lot / raw.lots;
  const isFlip = raw.form === "flip";
  const keepHouse = raw.form === "keep_dadu";

  // ── Program: units & sqft ──────────────────────────────────────────────────
  const perLotCap = env.perLotBuildableCap(perLot);
  let mainSqftPerLot = 0;
  const aduSqftPerLot = raw.adusPerLot * UNIT_SQFT.adu;
  let unitSqft = 0;

  switch (raw.form) {
    case "sfr": {
      // PARITY with the legacy engine (getMaxBuildableSqft "fresh_build"):
      // size by FAR 0.5 on the lot — NO flat square-footage cap. The old
      // arbitrary 3,400 sqft cap shrank a 12,466 sqft Bellevue lot to a
      // 3,400 sqft house and flipped a $1.3M teardown win into a fake loss
      // (regression found at 10728 NE 26th St).
      let cap = Math.min(perLot * 0.5, perLotCap);
      // Same neighborhood guardrail the legacy engine applies: don't model a
      // house materially bigger than what the surrounding comps support.
      if (property.neighborhood) {
        const g = computeNeighborhoodGuardrails({
          strategy: "fresh_build",
          neighborhood: property.neighborhood,
          maxBuildableByZoning: cap,
        });
        if (g.size.medianSqft) cap = g.size.safeMaxSqft;
      }
      mainSqftPerLot = cap;
      if (mainSqftPerLot < 1400) return null; // lot too small to pencil a new house
      break;
    }
    case "sfr_adu": {
      // PARITY with legacy "main_adu": main house at 70% of FAR budget,
      // capped at 3,500 sqft (house-with-ADU product sells mid-market, not
      // as a mega-home), ADUs at 1,000 sqft each on top.
      let cap = Math.min(perLot * 0.5 * 0.7, 3500, Math.max(0, perLotCap - aduSqftPerLot));
      if (property.neighborhood) {
        const g = computeNeighborhoodGuardrails({
          strategy: "main_adu",
          neighborhood: property.neighborhood,
          maxBuildableByZoning: cap,
        });
        if (g.size.medianSqft) cap = Math.min(cap, g.size.safeMaxSqft);
      }
      mainSqftPerLot = cap;
      if (mainSqftPerLot < 1400) return null;
      break;
    }
    case "plex": {
      unitSqft = UNIT_SQFT.plex;
      let total = raw.unitsPerLot * unitSqft;
      if (total > perLotCap) {
        unitSqft = Math.floor(perLotCap / raw.unitsPerLot);
        if (unitSqft < 750) return null;
        total = raw.unitsPerLot * unitSqft;
      }
      mainSqftPerLot = total;
      break;
    }
    case "townhome": {
      unitSqft = UNIT_SQFT.townhome;
      let total = raw.unitsPerLot * unitSqft;
      if (total > perLotCap) {
        unitSqft = Math.floor(perLotCap / raw.unitsPerLot);
        if (unitSqft < 950) return null;
        total = raw.unitsPerLot * unitSqft;
      }
      mainSqftPerLot = total;
      break;
    }
    case "multifamily": {
      unitSqft = UNIT_SQFT.mf;
      let total = raw.unitsPerLot * unitSqft;
      if (total > perLotCap * 1.2) { // MF gets a bit more envelope benefit (stacked)
        unitSqft = Math.floor((perLotCap * 1.2) / raw.unitsPerLot);
        if (unitSqft < 600) return null;
        total = raw.unitsPerLot * unitSqft;
      }
      mainSqftPerLot = total;
      break;
    }
    case "flip": {
      mainSqftPerLot = property.currentSqft || 0;
      break;
    }
    case "keep_dadu": {
      mainSqftPerLot = 0; // no new main-house construction
      break;
    }
  }

  const totalUnits = raw.lots * (raw.unitsPerLot + raw.adusPerLot);
  const totalBuildSqft = raw.lots * (mainSqftPerLot + aduSqftPerLot);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const ppsfInfo = getDefaultSellPricePerSqft(property, tier, isFlip ? "flip_fix" : "fresh_build");
  const ppsf = ppsfInfo.value;

  // ── Construction cost ─────────────────────────────────────────────────────
  const costMultKey = raw.form === "sfr" || raw.form === "sfr_adu" ? "sfr" : raw.form === "keep_dadu" ? "adu" : raw.form === "plex" ? "plex" : raw.form;
  const formCost = Math.round(costPerSqft * (FORM_COST_MULT[costMultKey] ?? 1));
  const aduCost = Math.round(costPerSqft * FORM_COST_MULT.adu);

  let hardCost: number;
  if (isFlip) {
    // Aligned with the flip renovation model's magnitude: ~$90/sqft premium reno
    hardCost = mainSqftPerLot * Math.min(costPerSqft * 0.38, 120);
  } else {
    hardCost =
      raw.lots * mainSqftPerLot * formCost +
      raw.lots * aduSqftPerLot * aduCost;
  }

  const demo = isFlip || keepHouse || (property.currentSqft ?? 0) === 0 ? 0 : 20000;
  const platCost = raw.lots > 1 ? 45000 + (raw.lots - 2) * 30000 + (raw.lots - 1) * 25000 : 0; // survey/eng + utility stubs per new lot
  const unitLotSubCost = raw.form === "townhome" ? (env.unitLotSubdivision ? 25000 : 18000 + 25000) : 0; // plat or HOA setup
  const permitFees = isFlip ? 5000 : 20000 + totalUnits * 3000 + (raw.lots > 1 ? 15000 : 0);
  const architect = isFlip ? 0 : hardCost * (raw.form === "multifamily" ? 0.06 : 0.05);
  const contingency = hardCost * 0.12;
  const landscaping = isFlip ? 0 : 15000 + totalUnits * 3000;
  const commonArea = raw.form === "multifamily" ? totalUnits * 8000 : 0;
  const constructionCost = Math.round(
    hardCost + demo + platCost + unitLotSubCost + permitFees + architect + contingency + landscaping + commonArea,
  );

  const purchase = property.listingPrice || 0;
  if (purchase <= 0) return null;

  // ── Revenue (computed before timeline: sell-phase length depends on price) ─
  // Sale-comp revenue is computed for BOTH exits (hold uses it as an
  // appraisal sanity bound on the income value).
  let revenue = 0;
  {
    switch (raw.form) {
      case "sfr":
        revenue = raw.lots * mainSqftPerLot * ppsf;
        break;
      case "sfr_adu":
        revenue = raw.lots * (mainSqftPerLot * ppsf + aduSqftPerLot * ppsf * FORM_PRICE_MULT.adu);
        break;
      case "plex":
        revenue = raw.lots * mainSqftPerLot * ppsf * FORM_PRICE_MULT.plex;
        break;
      case "townhome":
        revenue = mainSqftPerLot * ppsf * FORM_PRICE_MULT.townhome;
        break;
      case "multifamily":
        revenue = mainSqftPerLot * ppsf * FORM_PRICE_MULT.multifamily;
        break;
      case "flip":
        revenue = mainSqftPerLot * ppsf; // flip ppsf already discounted by strategy
        break;
      case "keep_dadu":
        revenue = purchase * 1.02 + aduSqftPerLot * ppsf * 0.80;
        break;
    }
  }
  revenue = Math.round(revenue);

  // ── Timeline ──────────────────────────────────────────────────────────────
  const buildRate = BUILD_RATE_SQFT_PER_MONTH[costMultKey] ?? 400;
  const tierTime = QUALITY_TIERS[tier].timeMultiplier;
  const permitMonths =
    isFlip ? 2 :
    keepHouse ? 4 :
    raw.form === "multifamily" ? 10 :
    raw.form === "townhome" || raw.form === "plex" ? 8 :
    raw.lots > 1 ? 10 : 6;
  const buildMonths = Math.max(2, Math.ceil((totalBuildSqft / buildRate) * tierTime * (raw.lots > 1 ? 1.15 : 1)));
  // Sell-phase length: same days-on-market curve as calculations.ts
  // (getSellMonths — price-aware, so a $2M+ unit carries 4 months), applied to
  // PER-UNIT price, floored by the multi-unit absorption rule (more units take
  // longer to clear even when each is cheap).
  const perUnitPrice = revenue / Math.max(1, totalUnits);
  const sellMonths =
    raw.exit === "hold"
      ? 2
      : Math.max(
          Math.ceil(getSellMonths(tier, perUnitPrice)),
          totalUnits > 4 ? 4 : totalUnits > 1 ? 3 : 2,
        );
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // ── Acquisition + holding + construction financing ────────────────────────
  const closing = purchase * 0.025;
  const isAllCash = financing.type === "cash";
  const downPct = isAllCash ? 100 : financing.downPaymentPct;
  const downPayment = purchase * (downPct / 100);
  const acqLoan = purchase - downPayment;
  const acqPoints = acqLoan > 0 && financing.points > 0 ? acqLoan * (financing.points / 100) : 0;
  const isIO = financing.type === "interest_only" || financing.type === "hard_money";
  const acqMonthly = isAllCash ? 0 : calculateMonthlyPayment(acqLoan, financing.interestRate, financing.loanTermYears, isIO);

  const ltc = Math.min(0.9, Math.max(0, financing.constructionLtcPct ?? 0.8));
  const cRate = financing.constructionRate ?? 10;
  const cPoints = financing.constructionPoints ?? 2;
  const constructionLoan = constructionCost * ltc;

  // Same S-curve draw schedule as calculations.ts: interest accrues on the
  // DRAWN balance only (AIA G702 curve), not on the full loan from day one.
  const draw = computeDrawSchedule({
    constructionCost,
    permitMonths,
    buildMonths,
    sellMonths,
    constructionLtcPct: ltc,
    constructionRate: cRate,
    constructionPoints: cPoints,
    upfrontEquity: downPayment + closing + acqPoints,
    acquisitionLoanBalance: acqLoan,
    acquisitionMonthlyPayment: acqMonthly,
  });

  const monthlyFixed =
    (property.annualPropertyTax || purchase * 0.0092) / 12 +
    (purchase * 0.004) / 12 +
    (property.hoaMonthly || 0) +
    300;
  const holdingCost = Math.round(
    (acqMonthly + monthlyFixed) * timelineMonths +
    draw.totalConstructionInterest +
    draw.originationFees,
  );

  const acquisitionCost = Math.round(purchase + closing + acqPoints);
  // Peak cash = the most ever tied up (sizes the bankroll; shown as "Cash needed").
  const totalCashInvested = Math.round(
    downPayment + closing + acqPoints + constructionCost * (1 - ltc) + holdingCost,
  );
  // ROI denominator = weighted-average cash deployed over the project life
  // (same convention as calculations.ts — capital ramps in via the draw
  // schedule, so average tied-up cash is well below peak).
  const avgCashDeployed =
    draw.weightedAvgCashDeployed > 0 ? draw.weightedAvgCashDeployed : totalCashInvested;

  const notes = [...raw.notes];
  const why: string[] = [raw.legalWhy];

  // ── Exit math ─────────────────────────────────────────────────────────────
  let fin: ScenarioFinancials;
  if (raw.exit === "sell") {
    const sellingCosts = Math.round(revenue * SELL_COST_PCT + 5000);
    const totalProjectCost = acquisitionCost + constructionCost + holdingCost + sellingCosts;
    const profit = Math.round(revenue - totalProjectCost);
    const roi = avgCashDeployed > 0 ? (profit / avgCashDeployed) * 100 : 0;
    fin = {
      revenue, acquisitionCost, constructionCost, holdingCost, sellingCosts,
      totalProjectCost, totalCashInvested, avgCashDeployed,
      profit, roi: round1(roi),
      annualizedRoi: round1(timelineMonths > 0 ? roi * (12 / timelineMonths) : 0),
      timelineMonths,
    };
    why.push(
      `${totalUnits > 1 ? `${totalUnits} sellable units` : "Single sale"} at ~$${Math.round(revenue / Math.max(totalUnits, 1)).toLocaleString()} each (comps: ${ppsfSourceLabel(ppsfInfo.source)} $${ppsf}/sqft).`,
    );
  } else {
    // HOLD: stabilize, refi (BRRRR mechanics), keep the cash flow.
    const rents = getMarketRentDefaults(property.zip);
    const monthlyGrossRent = Math.round(estimateMonthlyRent(raw, rents, mainSqftPerLot, aduSqftPerLot, unitSqft));
    const egi = monthlyGrossRent * 12 * 0.95;
    const opexRatio = raw.form === "multifamily" ? 0.35 : 0.30;
    const noi = Math.round(egi * (1 - opexRatio));
    const capKey = raw.form === "multifamily" ? "multifamily" : raw.form === "townhome" ? "townhome" : raw.form === "plex" ? "plex" : "sfr";
    const capRate = CAP_RATE[capKey];
    // Value the asset at the LOWER of income value and 95% of sale-comp value —
    // lenders appraise small resi off comps, not just cap rates.
    const incomeValue = noi / (capRate / 100);
    const stabilizedValue = Math.round(Math.min(incomeValue, revenue * 0.95) || incomeValue);
    const totalProjectCost = acquisitionCost + constructionCost + holdingCost;
    const refiLoan = Math.round(stabilizedValue * 0.72);
    const debtAtCompletion = acqLoan + constructionLoan;
    const cashOut = Math.max(0, refiLoan - debtAtCompletion - refiLoan * 0.015);
    const cashLeftInDeal = Math.max(0, totalCashInvested - cashOut);
    const annualDebtService = calculateMonthlyPayment(refiLoan, financing.interestRate + 0.4, 30) * 12;
    const annualCashFlow = Math.round(noi - annualDebtService);
    const cashOnCash = cashLeftInDeal > 500
      ? Math.min(999, round1((annualCashFlow / cashLeftInDeal) * 100))
      : annualCashFlow > 0 ? 999 : 0;
    const equityCreated = Math.round(stabilizedValue - totalProjectCost);
    const roi = avgCashDeployed > 0 ? (equityCreated / avgCashDeployed) * 100 : 0;
    fin = {
      revenue: stabilizedValue, acquisitionCost, constructionCost, holdingCost,
      sellingCosts: 0, totalProjectCost, totalCashInvested, avgCashDeployed,
      profit: equityCreated, roi: round1(roi),
      annualizedRoi: round1(timelineMonths > 0 ? roi * (12 / timelineMonths) : 0),
      timelineMonths,
      noi, capRate, stabilizedValue, refiLoan, cashLeftInDeal, annualCashFlow,
      cashOnCash, monthlyGrossRent,
    };
    why.push(
      `Rents ~$${monthlyGrossRent.toLocaleString()}/mo gross → NOI $${noi.toLocaleString()} → value $${stabilizedValue.toLocaleString()} at ${capRate}% cap. 72% refi returns $${Math.round(cashOut).toLocaleString()} of your cash${cashLeftInDeal <= 500 ? " (nearly all of it — BRRRR complete)" : ""}.`,
    );
    if (annualCashFlow < 0) {
      notes.push("Negative leverage at current rates — the refi'd asset does not cash-flow. Hold exit only makes sense if rates drop or rents outperform.");
    }
    if (rents.source === "national") {
      notes.push("Rent estimate uses the national fallback (no ZIP data) — verify local rents before trusting the hold math.");
    }
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  let confidence = ({
    sfr: 80, sfr_adu: 75, flip: 74, keep_dadu: 72,
    townhome: 64, plex: 62, multifamily: 55,
  } as Record<ScenarioForm, number>)[raw.form];

  // ADU market-evidence rule: HB 1337 makes ADUs LEGAL everywhere in the UGA,
  // but legality ≠ market. If not a single comp in the radius is an
  // SFR-with-ADU, the resale premium is unproven there — penalize hard so
  // ADU plays only surface as the headline when actual sales back them up.
  if (raw.adusPerLot > 0) {
    const nb = property.neighborhood;
    const aduSaleComps = nb?.sales.filter((s) => s.typology === "sfr_with_adu").length ?? 0;
    const aduTypologyCount = nb?.typology?.counts?.sfr_with_adu ?? 0;
    const aduEvidence = Math.max(aduSaleComps, aduTypologyCount);
    if (aduEvidence === 0) {
      // Selling an unproven product is riskier than renting it.
      confidence -= raw.exit === "sell" ? 16 : 8;
      notes.push(
        nb
          ? "No SFR-with-ADU sales or structures found in the comp radius — the ADU resale premium is UNPROVEN in this pocket. Modeled anyway (HB 1337 makes it legal), but verify demand with an agent before betting on it."
          : "No neighborhood data available to confirm ADU demand — treat the ADU premium as unproven.",
      );
    } else if (aduEvidence < 3) {
      confidence -= raw.exit === "sell" ? 8 : 4;
      notes.push(`Thin ADU precedent nearby (${aduEvidence} example${aduEvidence > 1 ? "s" : ""} in the comp radius) — some market risk on the ADU premium.`);
    } else {
      why.push(`ADU demand is proven here: ${aduEvidence} SFR-with-ADU examples in the comp radius.`);
    }
  }

  const feasibility = combineFeasibility(raw.zoningVerdict, hazardFeasibilityFloor(property.hazards ?? null));
  if (feasibility === "not_allowed") return null; // hazard floor kills it
  if (feasibility === "conditional") confidence -= 12;
  if (!env.rule) { confidence -= 25; notes.push(`Zoning code "${property.zoningCode}" not in the ${property.city} registry — feasibility uses generic parsing. Verify with the city.`); }
  else if (env.rule.verified === "unverified") { confidence -= 18; notes.push("Zoning data for this district is UNVERIFIED against current code text — confirm before offering."); }
  else if (env.rule.verified === "secondary") { confidence -= 5; }
  if (ppsfInfo.source === "zip_premium") confidence -= 8;
  if (ppsfInfo.source === "flat_fallback") { confidence -= 15; notes.push("Sale $/sqft uses a flat fallback (no local comps) — pull comps before trusting revenue."); }
  if (raw.lots >= 3) confidence -= 8;
  if (totalUnits >= 8) confidence -= 6;
  if (raw.exit === "hold") confidence -= 4;
  if (property.isKingCounty === false) confidence -= 10;
  confidence -= hazardConfidencePenalty(property.hazards ?? null);
  confidence = Math.max(5, Math.min(95, Math.round(confidence)));

  const confidenceLabel: ScenarioResult["confidenceLabel"] =
    confidence >= 68 ? "High" : confidence >= 48 ? "Medium" : "Low";

  // ── Score: risk-adjusted profit, small bonus for speed ────────────────────
  const holdBonus = raw.exit === "hold" && (fin.annualCashFlow ?? 0) > 0 ? (fin.annualCashFlow ?? 0) * 2 : 0;
  const score =
    (fin.profit + holdBonus) * (0.45 + 0.55 * (confidence / 100)) *
    (1 + Math.min(0.15, (fin.annualizedRoi || 0) / 400));

  const { label, shortLabel } = buildLabel(raw);
  return {
    id: `${raw.form}-${raw.lots}x${raw.unitsPerLot}+${raw.adusPerLot}-${raw.exit}`,
    label, shortLabel,
    form: raw.form, exit: raw.exit,
    lots: raw.lots, unitsPerLot: raw.unitsPerLot, adusPerLot: raw.adusPerLot,
    totalUnits, totalBuildSqft: Math.round(totalBuildSqft),
    feasibility, confidence, confidenceLabel,
    score: Math.round(score),
    financials: fin,
    why, citations: dedupeCitations([...raw.legal, ...env.stateLaw.citations]),
    notes,
  };
}

function estimateMonthlyRent(
  raw: RawScenario,
  rents: { studioRent: number; oneBrRent: number; twoBrRent: number },
  mainSqftPerLot: number,
  aduSqftPerLot: number,
  unitSqft: number,
): number {
  const houseRent = rents.twoBrRent * 1.55; // SFH premium over 2BR apartment
  const aduRent = rents.oneBrRent * 1.05;
  const aduCount = raw.adusPerLot;
  switch (raw.form) {
    case "sfr": return raw.lots * houseRent;
    case "sfr_adu": return raw.lots * (houseRent + aduCount * aduRent);
    case "keep_dadu": return houseRent * 0.9 + aduCount * aduRent; // older main house
    case "plex": return raw.lots * raw.unitsPerLot * (unitSqft >= 1000 ? rents.twoBrRent : rents.oneBrRent) * 0.98;
    case "townhome": return raw.unitsPerLot * rents.twoBrRent * 1.15;
    case "multifamily": {
      const u = raw.unitsPerLot;
      return u * (0.25 * rents.studioRent + 0.5 * rents.oneBrRent + 0.25 * rents.twoBrRent);
    }
    case "flip": return rents.twoBrRent * 1.4;
  }
}

function ppsfSourceLabel(source: string): string {
  switch (source) {
    case "neighborhood_new": return "new-construction comps";
    case "neighborhood_resale": return "resale comps";
    case "neighborhood_all": return "neighborhood comps";
    case "zip_premium": return "ZIP-level table";
    default: return "flat fallback";
  }
}

function dedupeCitations(cites: Citation[]): Citation[] {
  const seen = new Set<string>();
  return cites.filter((c) => {
    if (seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function optimizeProperty(
  property: PropertyData,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
): OptimizerReport {
  const env = computeEnvelope(property);
  const raws = enumerateScenarios(property, env);
  const evaluated = raws
    .map((r) => evaluateScenario(property, env, r, tier, costPerSqft, financing))
    .filter((r): r is ScenarioResult => r !== null)
    .sort((a, b) => b.score - a.score);

  const confident = evaluated.filter((s) => s.confidenceLabel !== "Low");
  const longShots = evaluated.filter((s) => s.confidenceLabel === "Low").slice(0, 6);

  // Best = highest score among Medium+ confidence with positive economics;
  // fall back to best positive scenario overall.
  const best =
    confident.find((s) => s.financials.profit > 0) ??
    evaluated.find((s) => s.financials.profit > 0) ??
    null;

  return {
    best,
    scenarios: confident.slice(0, 12),
    longShots,
    envelopeSummary: {
      zoningCode: property.zoningCode,
      city: property.city,
      codeSection: env.rule?.codeSection ?? null,
      minLotSqft: env.minLotSqft,
      maxLots: env.maxLots,
      maxUnitsPerLot: env.maxUnitsPerLot,
      maxAdusPerLot: env.maxAdusPerLot,
      registryHit: env.rule !== null,
      verified: env.rule?.verified ?? (env.rule ? "secondary" : null),
    },
    citations: env.citations,
  };
}
