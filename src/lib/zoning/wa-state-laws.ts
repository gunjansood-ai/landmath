/**
 * Washington State law overlays that pre-empt local zoning.
 *
 * Three statutes drive most of the changes investors care about:
 *
 *   HB 1110 (2023) — "Middle Housing Act"
 *     Forces every city ≥25,000 population to allow at least duplexes on
 *     every residential lot that allows a SFR. Tier 1 cities (≥75k pop or
 *     within the UGA of a Tier 1 city) must allow 4 units per lot, 6 units
 *     within 0.25 mile of a major transit stop. Implementation: cities
 *     must comply by ~mid-2025 for Tier 1, mid-2026 for Tier 2.
 *
 *   HB 1337 (2023) — Statewide ADU rights
 *     All WA cities in Urban Growth Areas must allow at least 2 ADUs per
 *     residential lot. No owner-occupancy requirement. Max size floor at
 *     1,000 sqft (cities may allow larger). No parking minimum within
 *     0.5 mile of major transit.
 *
 *   SB 5258 (2023) — Unit lot subdivisions
 *     Cities must allow unit-lot subdivisions of attached housing
 *     (townhomes / rowhomes) without applying parent-lot zoning to the
 *     individual unit lots. This means a townhome row can be sold fee-
 *     simple even if each unit-lot is below the district min lot size.
 *
 * These overrides take precedence over the local registry table. The
 * functions here compute "effective" feasibility and density given the
 * city + zoning + state law context.
 */

import type { ZoningRule, ZoningKind } from "./registry";

// ─── KC City tiering for HB 1110 ─────────────────────────────────────────────
// Source: WA Dept. of Commerce HB 1110 city list, last updated 2024.
// https://deptofcommerce.app.box.com/v/middle-housing-cities

/** Cities ≥75,000 pop or within the UGA of a Tier 1 city.
 *  Must allow 4 units per residential lot (6 near transit). */
const HB1110_TIER1_KC = new Set([
  "SEATTLE",
  "BELLEVUE",
  "KENT",
  "RENTON",
  "FEDERAL WAY",
  "AUBURN",
  "REDMOND",
  "KIRKLAND",
  "BURIEN",
  "SAMMAMISH",
  "SHORELINE",
  "BOTHELL",
]);

/** Cities 25,000–75,000 pop. Must allow 2 units per residential lot. */
const HB1110_TIER2_KC = new Set([
  "MERCER ISLAND",
  "SEATAC",
  "TUKWILA",
  "DES MOINES",
  "ISSAQUAH",
  "MAPLE VALLEY",
  "KENMORE",
  "COVINGTON",
  "WOODINVILLE",
]);

// Cities below 25k or unincorporated KC: HB 1110 does not apply.
// (Newcastle, Snoqualmie, North Bend, Carnation, Duvall, Pacific, Algona,
//  Black Diamond, Skykomish, Beaux Arts, Hunts Point, Yarrow Point, Medina,
//  Clyde Hill, and all unincorporated parcels.)

// ─── HB 1110 effect ──────────────────────────────────────────────────────────

export interface MiddleHousingOverlay {
  /** Statute that applies (or null if none). */
  statute: "HB 1110 (Tier 1)" | "HB 1110 (Tier 2)" | null;
  /** Maximum units the lot can legally hold under the overlay. */
  maxUnitsPerLot: number;
  /** True if the lot is within 0.25 mi of a major transit stop (caller decides). */
  transitProximity: boolean;
  /** Plain-English explanation, ready to render in reasoning. */
  explanation: string;
  /** Citation link to the state law. */
  codeUrl: string;
}

/**
 * Compute the HB 1110 middle-housing overlay for a city. Returns null when
 * the city is below the 25k pop threshold or the rule kind is not SF.
 *
 * @param city — case-insensitive city name
 * @param state — must be WA for the overlay to apply
 * @param baseRule — the local zoning rule (we only modify SF / sf_attached districts)
 * @param nearMajorTransit — true if subject lot is within 0.25 mi of a major
 *   transit stop. Caller is responsible for this signal (we don't yet pull it).
 */
export function getMiddleHousingOverlay(
  city: string | null | undefined,
  state: string | null | undefined,
  baseRule: ZoningRule | null,
  nearMajorTransit: boolean = false,
): MiddleHousingOverlay | null {
  if ((state ?? "").toUpperCase() !== "WA") return null;
  if (!baseRule) return null;
  // HB 1110 only modifies residential SF / SF-attached districts. Multifamily,
  // mixed-use, commercial, and rural districts aren't pre-empted.
  if (baseRule.kind !== "sf" && baseRule.kind !== "sf_attached") return null;

  const c = (city ?? "").trim().toUpperCase();
  const codeUrl =
    "https://app.leg.wa.gov/RCW/default.aspx?cite=36.70A.635"; // RCW 36.70A.635 (codified HB 1110)

  if (HB1110_TIER1_KC.has(c)) {
    const maxUnits = nearMajorTransit ? 6 : 4;
    return {
      statute: "HB 1110 (Tier 1)",
      maxUnitsPerLot: maxUnits,
      transitProximity: nearMajorTransit,
      explanation:
        `${city} is a Tier 1 city under WA HB 1110 — every residential lot must allow at least ${maxUnits} ` +
        `housing units (${nearMajorTransit ? "near major transit" : "base allowance"}), regardless of the local single-family zoning. ` +
        `This pre-empts ${baseRule.codeSection}.`,
      codeUrl,
    };
  }
  if (HB1110_TIER2_KC.has(c)) {
    return {
      statute: "HB 1110 (Tier 2)",
      maxUnitsPerLot: 2,
      transitProximity: nearMajorTransit,
      explanation:
        `${city} is a Tier 2 city under WA HB 1110 — every residential lot must allow at least 2 units ` +
        `(duplex), regardless of the local single-family zoning. This pre-empts ${baseRule.codeSection}.`,
      codeUrl,
    };
  }
  return null;
}

// ─── HB 1337 ADU rights ─────────────────────────────────────────────────────

export interface AduOverlay {
  /** True when HB 1337 forces ADU allowance regardless of local zoning. */
  statewide: boolean;
  /** Max ADUs per lot under state law (cities may allow more). */
  maxAduPerLot: number;
  /** Floor for max-ADU-size that the city must allow. */
  maxAduSizeFloorSqft: number;
  /** True if lot is within 0.5 mile of major transit → no parking minimum. */
  parkingWaivedNearTransit: boolean;
  explanation: string;
  codeUrl: string;
}

export function getAduOverlay(
  city: string | null | undefined,
  state: string | null | undefined,
  inUrbanGrowthArea: boolean,
  nearMajorTransit: boolean = false,
): AduOverlay | null {
  if ((state ?? "").toUpperCase() !== "WA") return null;
  if (!inUrbanGrowthArea) return null;
  return {
    statewide: true,
    maxAduPerLot: 2,
    maxAduSizeFloorSqft: 1000,
    parkingWaivedNearTransit: nearMajorTransit,
    explanation:
      `WA HB 1337 (2023) requires ${city || "every city"} in a UGA to allow up to 2 ADUs per residential lot, ` +
      `up to 1,000 sqft each, with no owner-occupancy requirement` +
      (nearMajorTransit ? " and no parking minimum (within 0.5 mi of major transit)." : "."),
    codeUrl:
      "https://app.leg.wa.gov/RCW/default.aspx?cite=36.70A.681",
  };
}

// ─── SB 5258 unit-lot subdivision ───────────────────────────────────────────

export interface UnitLotOverlay {
  /** True when SB 5258 forces unit-lot subdivision allowance. */
  available: boolean;
  /** Plain-English summary. */
  explanation: string;
  codeUrl: string;
}

export function getUnitLotOverlay(
  state: string | null | undefined,
  baseRule: ZoningRule | null,
): UnitLotOverlay | null {
  if ((state ?? "").toUpperCase() !== "WA") return null;
  if (!baseRule) return null;
  // Only applies to attached housing forms.
  const eligible: ZoningKind[] = ["sf_attached", "duplex", "multifamily", "mixed_use"];
  if (!eligible.includes(baseRule.kind)) return null;
  return {
    available: true,
    explanation:
      "WA SB 5258 (2023) requires the city to allow unit-lot subdivisions of attached housing (townhomes / rowhomes) " +
      "without applying the parent-lot min lot size or density caps to the individual unit lots. " +
      "Practical effect: each townhome unit can be sold fee-simple even on a footprint smaller than the base zone minimum.",
    codeUrl:
      "https://lawfilesext.leg.wa.gov/biennium/2023-24/Pdf/Bills/Session%20Laws/House/1245-S2.SL.pdf",
  };
}

// ─── Combined view: state-law-adjusted feasibility ──────────────────────────

export interface StateLawAdjustedRule {
  baseRule: ZoningRule | null;
  middleHousing: MiddleHousingOverlay | null;
  adu: AduOverlay | null;
  unitLot: UnitLotOverlay | null;
  /** Effective max units per lot after applying all overlays. */
  effectiveMaxUnitsPerLot: number;
  /** Effective kind after overlays — SF zones become duplex/multifamily under HB 1110. */
  effectiveKind: ZoningKind | "unknown";
  /** Citations to surface in the UI. */
  citations: Array<{ label: string; url: string }>;
}

export function applyStateLaws(input: {
  city?: string | null;
  state?: string | null;
  baseRule: ZoningRule | null;
  inUrbanGrowthArea: boolean;
  nearMajorTransit?: boolean;
}): StateLawAdjustedRule {
  const { city, state, baseRule, inUrbanGrowthArea, nearMajorTransit = false } = input;
  const middleHousing = getMiddleHousingOverlay(city, state, baseRule, nearMajorTransit);
  const adu = getAduOverlay(city, state, inUrbanGrowthArea, nearMajorTransit);
  const unitLot = getUnitLotOverlay(state, baseRule);

  // Effective units: max of base rule's implied units and HB 1110 minimum.
  const baseUnits = baseRule?.kind === "multifamily" ? 99 : baseRule?.kind === "duplex" ? 2 : 1;
  const overlayUnits = middleHousing?.maxUnitsPerLot ?? 0;
  const effectiveMaxUnitsPerLot = Math.max(baseUnits, overlayUnits);

  let effectiveKind: ZoningKind | "unknown" = baseRule?.kind ?? "unknown";
  if (middleHousing) {
    // Tier 1 = 4+ units → effectively multifamily for planning purposes.
    // Tier 2 = 2 units → duplex.
    effectiveKind = middleHousing.maxUnitsPerLot >= 4 ? "multifamily" : "duplex";
  }

  const citations: Array<{ label: string; url: string }> = [];
  if (middleHousing) citations.push({ label: middleHousing.statute!, url: middleHousing.codeUrl });
  if (adu) citations.push({ label: "HB 1337 ADU", url: adu.codeUrl });
  if (unitLot) citations.push({ label: "SB 5258 Unit-Lot", url: unitLot.codeUrl });

  return {
    baseRule, middleHousing, adu, unitLot,
    effectiveMaxUnitsPerLot, effectiveKind, citations,
  };
}
