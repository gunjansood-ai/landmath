/**
 * Jurisdiction-aware zoning registry.
 *
 * Authoritative minimum-lot, density, and use rules for known cities,
 * keyed by (state, city, zoningCode). When a lookup hits, it overrides
 * the generic regex-based parser in calculations.ts. The result includes
 * a citation back to the actual municipal code section so feasibility
 * reasoning can show its work instead of pattern-matching on the code name.
 *
 * Adding a new city is intentionally cheap: drop a table here and the
 * existing call sites in calculations.ts pick it up via lookupZoning().
 *
 * Why this exists:
 *   The previous fallback parsed codes like "R-3" as "3 dwelling units per
 *   acre" → 14,520 sqft min lot. That's wrong for Bellevue, where "SR-3"
 *   means "Suburban Residential, 8,500 sqft min lot" per LUC 20.20.012.
 *   Worse, regex-based use-class detection matched Bellevue "SR-3" as if it
 *   were a generic "R-3" multi-family district, producing nonsense townhome
 *   and multifamily feasibility verdicts on single-family-only lots.
 */

export type ZoningKind =
  | "sf"           // single-family detached only — no attached or stacked forms
  | "sf_attached"  // SF + small attached (cottage / townhouse on shared lots)
  | "duplex"       // up to 2 units per lot
  | "multifamily"  // 3+ unit stacked buildings allowed
  | "mixed_use"    // commercial + residential
  | "commercial"
  | "rural";

/** Dimensional development envelope for a zone, where researched. */
export interface ZoningEnvelope {
  /** Max building lot coverage, percent of lot area. */
  maxLotCoveragePct?: number;
  /** Max impervious surface, percent (some codes use this instead of coverage). */
  maxImperviousPct?: number;
  /** Max floor-area ratio where the code uses FAR (rare in KC SF zones; Mercer Island does). */
  maxFAR?: number;
  /** Max structure height in feet. */
  maxHeightFt?: number;
}

export interface ZoningRule {
  /** Minimum lot size required to create a new lot in this district (sqft). */
  minLotSqft: number | null;
  /** Maximum dwelling units per acre when density (not min-lot) is the governing metric. */
  maxDuPerAcre: number | null;
  /** Highest-intensity residential form permitted by-right. */
  kind: ZoningKind;
  /** Per the controlling code: can a SF lot be subdivided in this district? */
  allowsShortPlat: boolean;
  /** Human-readable citation, e.g. "Bellevue LUC 20.20.012, Chart 20.20.010". */
  codeSection: string;
  /** Direct link to the code section. */
  codeUrl: string;
  /** Optional plain-English note shown to the user. */
  note?: string;
  /** Coverage / FAR / height limits where researched (drives buildable-sqft caps). */
  envelope?: ZoningEnvelope;
  /** Units per lot under the city's ADOPTED HB 1110 middle-housing ordinance
   *  (differs from the state-law floor when the city adopted more, e.g.
   *  Des Moines 4 units or 24 du/ac). When unset, callers fall back to the
   *  state-law tier floor in wa-state-laws.ts. */
  middleHousingUnitsPerLot?: number;
  /** Data provenance. "verified" = read from current official code text (Jul 2026 pass),
   *  "secondary" = official text via mirror/machine extraction (spot-check),
   *  "unverified" = best estimate. Unset = original pre-2026 research (treat as secondary). */
  verified?: "verified" | "secondary" | "unverified";
}

type CityCode = string; // normalized upper-case zoning code (e.g. "SR-3", "LR1")

// ─── Bellevue, WA ────────────────────────────────────────────────────────────
// Source: Bellevue Land Use Code Chart 20.20.010 (Residential Dimensions row
// "Minimum Lot Area, Thousands of Sq. Ft.") and LUC 20.20.012 "Minimum lot area".
// https://bellevue.municipal.codes/LUC/20.20.010
// https://bellevue.municipal.codes/LUC/20.20.012
const BELLEVUE_WA: Record<CityCode, ZoningRule> = {
  "LL-1": {
    minLotSqft: 35000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Large Lot 1",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "LL-2": {
    minLotSqft: 20000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Large Lot 2",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "SR-1": {
    minLotSqft: 13500, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Suburban Residential 1",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "SR-2": {
    minLotSqft: 10000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Suburban Residential 2",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "SR-3": {
    minLotSqft: 8500, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Suburban Residential 3",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
    middleHousingUnitsPerLot: 4,
    verified: "verified",
    note: "A 2-lot short plat requires ≥17,000 sqft (2 × 8,500). Post-2025 Middle Housing LUCA, middle housing (up to 4 units/lot, more near transit or with affordability) is permitted per LUC 20.20.538 — detached-only is no longer accurate.",
  },
  "SR-4": {
    minLotSqft: 7200, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Suburban Residential 4",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "LDR-1": {
    minLotSqft: 4700, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Low Density Residential 1",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  // LDR-2/LDR-3/MDR-1/MDR-2 are density-governed (no per-unit min lot in chart):
  "LDR-2": {
    minLotSqft: null, maxDuPerAcre: 10, kind: "duplex", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Low Density Residential 2",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "LDR-3": {
    minLotSqft: null, maxDuPerAcre: 15, kind: "duplex", allowsShortPlat: true,
    codeSection: "Bellevue LUC 20.20.010 Chart · Low Density Residential 3",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "MDR-1": {
    minLotSqft: null, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Bellevue LUC 20.20.010 Chart · Medium Density Residential 1",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
  "MDR-2": {
    minLotSqft: null, maxDuPerAcre: 30, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Bellevue LUC 20.20.010 Chart · Medium Density Residential 2",
    codeUrl: "https://bellevue.municipal.codes/LUC/20.20.010",
  },
};

// ─── Seattle, WA (stubs for the most common residential codes) ──────────────
// Source: Seattle SMC Title 23. Per-zone min lot sizes are baked into the
// code name (SF 5000 = 5,000 sqft, SF 7200 = 7,200 sqft, etc.).
const SEATTLE_WA: Record<CityCode, ZoningRule> = {
  "SF 5000": { minLotSqft: 5000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Single-Family 5000",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "SF 7200": { minLotSqft: 7200, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Single-Family 7200",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "SF 9600": { minLotSqft: 9600, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Single-Family 9600",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "NR1": { minLotSqft: 9600, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 1 (+ interim HB 1110 ord., May 2025)",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 4, verified: "verified",
    note: "Interim HB 1110 ordinance (approved May 27, 2025): at least 4 units/lot in all NR zones; 6 near major transit or when 2 units are affordable." },
  "NR2": { minLotSqft: 7200, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 2 (+ interim HB 1110 ord., May 2025)",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 4, verified: "verified",
    note: "Interim HB 1110 ordinance: at least 4 units/lot; 6 near major transit / with affordability." },
  "NR3": { minLotSqft: 5000, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 3 (+ interim HB 1110 ord., May 2025)",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 4, verified: "verified",
    note: "Interim HB 1110 ordinance: at least 4 units/lot; 6 near major transit / with affordability." },
  "RSL": { minLotSqft: 2500, maxDuPerAcre: 17, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.43 · Residential Small Lot",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "LR1": { minLotSqft: null, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: false,
    codeSection: "Seattle SMC 23.45 · Lowrise 1",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "LR2": { minLotSqft: null, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Seattle SMC 23.45 · Lowrise 2",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "LR3": { minLotSqft: null, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Seattle SMC 23.45 · Lowrise 3",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "MR": { minLotSqft: null, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Seattle SMC 23.45 · Midrise",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "HR": { minLotSqft: null, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Seattle SMC 23.45 · Highrise",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
};

// ─── Kirkland, WA — KZC ──────────────────────────────────────────────────────
// Source: KZC Ch. 15.30 (RS / RSA) and Ch. 20 / 25 (RM).
// https://kirkland.municipal.codes/KZC/15.30
const KIRKLAND_WA: Record<CityCode, ZoningRule> = {
  "RS 7.2": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 7.2", codeUrl: "https://kirkland.municipal.codes/KZC/15.30" },
  "RS 8.5": { minLotSqft: 8500, maxDuPerAcre: 5, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 8.5", codeUrl: "https://kirkland.municipal.codes/KZC/15.30" },
  "RS 12.5": { minLotSqft: 12500, maxDuPerAcre: 3.5, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 12.5", codeUrl: "https://kirkland.municipal.codes/KZC/15.30" },
  "RSA 8": { minLotSqft: 3800, maxDuPerAcre: 10, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RSA 8", codeUrl: "https://kirkland.municipal.codes/KZC/15.30" },
  // Added Jul 2026 (KZC 15.30 full table — machine-extracted from official host):
  "RS 35": { minLotSqft: 35000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 35", codeUrl: "https://kirkland.municipal.codes/KZC/15.30",
    envelope: { maxLotCoveragePct: 50, maxHeightFt: 25 }, verified: "secondary" },
  "RS 6.3": { minLotSqft: 6300, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 6.3", codeUrl: "https://kirkland.municipal.codes/KZC/15.30",
    envelope: { maxLotCoveragePct: 50, maxHeightFt: 25 }, verified: "secondary" },
  "RS 5.0": { minLotSqft: 5000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RS 5.0", codeUrl: "https://kirkland.municipal.codes/KZC/15.30",
    envelope: { maxLotCoveragePct: 50, maxHeightFt: 25 }, verified: "secondary" },
  "RSA 4": { minLotSqft: 7600, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RSA 4", codeUrl: "https://kirkland.municipal.codes/KZC/15.30",
    envelope: { maxLotCoveragePct: 60, maxHeightFt: 30 }, verified: "secondary" },
  "RSA 6": { minLotSqft: 5100, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kirkland KZC 15.30 · RSA 6", codeUrl: "https://kirkland.municipal.codes/KZC/15.30",
    envelope: { maxLotCoveragePct: 60, maxHeightFt: 30 }, verified: "secondary" },
  "RM 5.0": { minLotSqft: 5000, maxDuPerAcre: 8.7, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kirkland KZC 20.30 · RM 5.0", codeUrl: "https://kirkland.municipal.codes/KZC/20.30" },
  "RM 3.6": { minLotSqft: 3600, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kirkland KZC 20.30 · RM 3.6", codeUrl: "https://kirkland.municipal.codes/KZC/20.30" },
  "RM 2.4": { minLotSqft: 2400, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kirkland KZC 25 · RM 2.4", codeUrl: "https://kirkland.municipal.codes/KZC/25" },
  "RM 1.8": { minLotSqft: 1800, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kirkland KZC 25 · RM 1.8", codeUrl: "https://kirkland.municipal.codes/KZC/25" },
};

// ─── Redmond, WA — RZC ───────────────────────────────────────────────────────
// Source: RZC 21.08 (residential districts).
// https://redmond.municipal.codes/RZC/21.08
const REDMOND_WA: Record<CityCode, ZoningRule> = {
  "RA-5": { minLotSqft: 43560, maxDuPerAcre: 1, kind: "rural", allowsShortPlat: true,
    codeSection: "Redmond RZC 21.08.050 · Rural Acre", codeUrl: "https://redmond.municipal.codes/RZC/21.08.050" },
  "R-1": { minLotSqft: 36000, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Redmond RZC 21.08.060 · R-1", codeUrl: "https://redmond.municipal.codes/RZC/21.08.060" },
  "R-4": { minLotSqft: 8000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Redmond RZC 21.08.060 · R-4", codeUrl: "https://redmond.municipal.codes/RZC/21.08.060" },
  "R-6": { minLotSqft: 6000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Redmond RZC 21.08.090 · R-6", codeUrl: "https://redmond.municipal.codes/RZC/21.08.090" },
  "R-8": { minLotSqft: 4500, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Redmond RZC 21.08.100 · R-8", codeUrl: "https://redmond.municipal.codes/RZC/21.08.100" },
  "R-12": { minLotSqft: 3500, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Redmond RZC 21.08.110 · R-12", codeUrl: "https://redmond.municipal.codes/RZC/21.08.110" },
  "R-18": { minLotSqft: null, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Redmond RZC 21.08.120 · R-18", codeUrl: "https://redmond.municipal.codes/RZC/21.08.120" },
  "R-20": { minLotSqft: null, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Redmond RZC 21.08.130 · R-20", codeUrl: "https://redmond.municipal.codes/RZC/21.08.130" },
  "R-30": { minLotSqft: null, maxDuPerAcre: 30, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Redmond RZC 21.08.140 · R-30", codeUrl: "https://redmond.municipal.codes/RZC/21.08.140" },
};

// ─── Renton, WA — RMC 4-2-110A ───────────────────────────────────────────────
// Source: Renton Municipal Code Title IV, Ch. 2.
// https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html
const RENTON_WA: Record<CityCode, ZoningRule> = {
  "RC": { minLotSqft: 435600, maxDuPerAcre: 0.1, kind: "rural", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · Resource Conservation",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "R-1": { minLotSqft: 43560, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-1",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "R-4": { minLotSqft: 9000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-4",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html",
    envelope: { maxLotCoveragePct: 35, maxImperviousPct: 50, maxHeightFt: 32 },
    verified: "verified",
    note: "Corrected Jul 2026: min lot is 9,000 sqft (was 8,000 in an earlier table). Middle-housing standards: RMC 4-2-110F." },
  "R-6": { minLotSqft: 7000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-6",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html",
    envelope: { maxLotCoveragePct: 40, maxImperviousPct: 55, maxHeightFt: 32 },
    verified: "verified" },
  "R-8": { minLotSqft: 5000, maxDuPerAcre: 8, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-8",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html",
    envelope: { maxLotCoveragePct: 50, maxImperviousPct: 65, maxHeightFt: 32 },
    verified: "verified",
    note: "Corrected Jul 2026: min lot is 5,000 sqft (was 4,500 in an earlier table). Middle-housing standards: RMC 4-2-110F." },
  "R-10": { minLotSqft: 3000, maxDuPerAcre: 10, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-10",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "R-14": { minLotSqft: 3000, maxDuPerAcre: 14, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-14",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "RMF": { minLotSqft: null, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Renton RMC 4-2-110A · RMF",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
};

// ─── Sammamish, WA — derives from KCC Title 21A; SMC 21.04 ──────────────────
const SAMMAMISH_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 43560, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Sammamish 21.04.030 · R-1", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
  "R-4": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Sammamish 21.04.030 · R-4", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
  "R-6": { minLotSqft: 5000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Sammamish 21.04.030 · R-6", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
  "R-8": { minLotSqft: 3750, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Sammamish 21.04.030 · R-8", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
  "R-12": { minLotSqft: 2500, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Sammamish 21.04.030 · R-12", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
  "R-18": { minLotSqft: 2000, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Sammamish 21.04.030 · R-18", codeUrl: "https://sammamish.municipal.codes/DC/21.04.030" },
};

// ─── Issaquah, WA — LUC Ch. 18.400 ──────────────────────────────────────────
const ISSAQUAH_WA: Record<CityCode, ZoningRule> = {
  "SF-E": { minLotSqft: 35000, maxDuPerAcre: 1.24, kind: "sf", allowsShortPlat: true,
    codeSection: "Issaquah LUC 18.400.060 · SF-E Estates", codeUrl: "https://issaquah.municipal.codes/LUC/18.400.060" },
  "SF-D": { minLotSqft: 14500, maxDuPerAcre: 3, kind: "sf", allowsShortPlat: true,
    codeSection: "Issaquah LUC 18.400.060 · SF-D Detached", codeUrl: "https://issaquah.municipal.codes/LUC/18.400.060" },
  "SF-S": { minLotSqft: 9600, maxDuPerAcre: 4.5, kind: "sf", allowsShortPlat: true,
    codeSection: "Issaquah LUC 18.400.060 · SF-S Suburban", codeUrl: "https://issaquah.municipal.codes/LUC/18.400.060" },
  "SF-SL": { minLotSqft: 6000, maxDuPerAcre: 7.26, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Issaquah LUC 18.400.060 · SF-SL Small Lot", codeUrl: "https://issaquah.municipal.codes/LUC/18.400.060" },
  "MF-M": { minLotSqft: null, maxDuPerAcre: 14.52, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Issaquah LUC 18.400 · MF-M Medium", codeUrl: "https://issaquah.municipal.codes/LUC/18.400" },
};

// ─── Mercer Island, WA — MICC Ch. 19.02 ─────────────────────────────────────
const MERCER_ISLAND_WA: Record<CityCode, ZoningRule> = {
  "R-8.4": { minLotSqft: 8400, maxDuPerAcre: 5.2, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Mercer Island MICC 19.02.020 · R-8.4", codeUrl: "https://library.municode.com/wa/mercer_island/codes/city_code" },
  "R-9.6": { minLotSqft: 9600, maxDuPerAcre: 4.5, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Mercer Island MICC 19.02.020 · R-9.6", codeUrl: "https://library.municode.com/wa/mercer_island/codes/city_code" },
  "R-12": { minLotSqft: 12000, maxDuPerAcre: 3.6, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Mercer Island MICC 19.02.020 · R-12", codeUrl: "https://library.municode.com/wa/mercer_island/codes/city_code" },
  "R-15": { minLotSqft: 15000, maxDuPerAcre: 2.9, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Mercer Island MICC 19.02.020 · R-15", codeUrl: "https://library.municode.com/wa/mercer_island/codes/city_code" },
};

// ─── Federal Way, WA — FWRC 19.200 ──────────────────────────────────────────
const FEDERAL_WAY_WA: Record<CityCode, ZoningRule> = {
  "RS 35.0": { minLotSqft: 35000, maxDuPerAcre: 1.2, kind: "sf", allowsShortPlat: true,
    codeSection: "Federal Way FWRC 19.200.010 · RS 35.0",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19200.html" },
  "RS 15.0": { minLotSqft: 15000, maxDuPerAcre: 2.9, kind: "sf", allowsShortPlat: true,
    codeSection: "Federal Way FWRC 19.200.010 · RS 15.0",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19200.html" },
  "RS 9.6": { minLotSqft: 9600, maxDuPerAcre: 4.5, kind: "sf", allowsShortPlat: true,
    codeSection: "Federal Way FWRC 19.200.010 · RS 9.6",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19200.html" },
  "RS 7.2": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Federal Way FWRC 19.200.010 · RS 7.2",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19200.html" },
  "RS 5.0": { minLotSqft: 5000, maxDuPerAcre: 8.7, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Federal Way FWRC 19.200.010 · RS 5.0",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19200.html" },
  "RM 3600": { minLotSqft: 3600, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Federal Way FWRC 19.205 · RM 3600",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19205.html" },
  "RM 2400": { minLotSqft: 2400, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Federal Way FWRC 19.205 · RM 2400",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19205.html" },
  "RM 1800": { minLotSqft: 1800, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Federal Way FWRC 19.205 · RM 1800",
    codeUrl: "https://www.codepublishing.com/WA/FederalWay/html/FederalWay19/FederalWay19205.html" },
};

// ─── Kent, WA — KCC 15.04.170 ────────────────────────────────────────────────
const KENT_WA: Record<CityCode, ZoningRule> = {
  "SR-1": { minLotSqft: 34700, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · SR-1", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "SR-3": { minLotSqft: 9600, maxDuPerAcre: 3.63, kind: "sf", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · SR-3", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "SR-4.5": { minLotSqft: 7600, maxDuPerAcre: 4.53, kind: "sf", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · SR-4.5", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "SR-6": { minLotSqft: 5700, maxDuPerAcre: 6.05, kind: "sf", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · SR-6", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "SR-8": { minLotSqft: 4000, maxDuPerAcre: 8.71, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · SR-8", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-D": { minLotSqft: 8500, maxDuPerAcre: 10, kind: "duplex", allowsShortPlat: true,
    codeSection: "Kent KCC 15.04.170 · MR-D Duplex", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-T12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kent KCC 15.04.170 · MR-T12", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-T16": { minLotSqft: null, maxDuPerAcre: 16, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kent KCC 15.04.170 · MR-T16", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-G": { minLotSqft: null, maxDuPerAcre: 16, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kent KCC 15.04.170 · MR-G", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-M": { minLotSqft: null, maxDuPerAcre: 23, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kent KCC 15.04.170 · MR-M", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
  "MR-H": { minLotSqft: null, maxDuPerAcre: 40, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kent KCC 15.04.170 · MR-H", codeUrl: "https://www.codepublishing.com/WA/Kent/html/Kent15/Kent1504.html" },
};

// ─── Shoreline, WA — SMC 20.50 ───────────────────────────────────────────────
const SHORELINE_WA: Record<CityCode, ZoningRule> = {
  "R-4": { minLotSqft: 10000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Shoreline SMC 20.50.020 · R-4",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-6": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Shoreline SMC 20.50.020 · R-6",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-8": { minLotSqft: null, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Shoreline SMC 20.50.020 · R-8",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Shoreline SMC 20.50.020 · R-12",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-18": { minLotSqft: null, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Shoreline SMC 20.50.020 · R-18",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-24": { minLotSqft: null, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Shoreline SMC 20.50.020 · R-24",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
  "R-48": { minLotSqft: null, maxDuPerAcre: 48, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Shoreline SMC 20.50.020 · R-48",
    codeUrl: "https://www.codepublishing.com/WA/Shoreline/html/Shoreline20/Shoreline2050.html" },
};

// ─── Bothell, WA — BMC 12.14.030 ─────────────────────────────────────────────
const BOTHELL_WA: Record<CityCode, ZoningRule> = {
  "R 40,000": { minLotSqft: 40000, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 40,000", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
  "R 20,000": { minLotSqft: 20000, maxDuPerAcre: 2, kind: "sf", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 20,000", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
  "R 9,600": { minLotSqft: 9600, maxDuPerAcre: 4.5, kind: "sf", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 9,600", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
  "R 8,400": { minLotSqft: 8400, maxDuPerAcre: 5, kind: "sf", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 8,400", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
  "R 7,200": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 7,200", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
  "R 5,400": { minLotSqft: 5400, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Bothell BMC 12.14.030 · R 5,400", codeUrl: "https://bothell.municipal.codes/BMC/12.14.030" },
};

// ─── Burien, WA — BMC 19.15 ──────────────────────────────────────────────────
const BURIEN_WA: Record<CityCode, ZoningRule> = {
  "RS-7200": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Burien BMC 19.15.030 · RS-7200",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
  "RS-12000": { minLotSqft: 12000, maxDuPerAcre: 3.6, kind: "sf", allowsShortPlat: true,
    codeSection: "Burien BMC 19.15.030 · RS-12000",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
  "RM-12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Burien BMC 19.15 · RM-12",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
  "RM-18": { minLotSqft: null, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Burien BMC 19.15 · RM-18",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
  "RM-24": { minLotSqft: null, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Burien BMC 19.15 · RM-24",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
  "RM-48": { minLotSqft: null, maxDuPerAcre: 48, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Burien BMC 19.15 · RM-48",
    codeUrl: "https://www.codepublishing.com/WA/Burien/html/Burien19/Burien1915.html" },
};

// ─── Newcastle, WA — NMC 18.12 ───────────────────────────────────────────────
const NEWCASTLE_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 35000, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Newcastle NMC 18.12.030 · R-1",
    codeUrl: "https://www.codepublishing.com/WA/Newcastle/html/Newcastle18/Newcastle1812.html" },
  "R-4": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Newcastle NMC 18.12.030 · R-4",
    codeUrl: "https://www.codepublishing.com/WA/Newcastle/html/Newcastle18/Newcastle1812.html" },
  "R-6": { minLotSqft: null, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Newcastle NMC 18.12.030 · R-6",
    codeUrl: "https://www.codepublishing.com/WA/Newcastle/html/Newcastle18/Newcastle1812.html" },
  "R-8": { minLotSqft: null, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Newcastle NMC 18.12.030 · R-8",
    codeUrl: "https://www.codepublishing.com/WA/Newcastle/html/Newcastle18/Newcastle1812.html" },
  "R-12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Newcastle NMC 18.12.030 · R-12",
    codeUrl: "https://www.codepublishing.com/WA/Newcastle/html/Newcastle18/Newcastle1812.html" },
};

// ─── Auburn, WA — ACC 18.07 ──────────────────────────────────────────────────
const AUBURN_WA: Record<CityCode, ZoningRule> = {
  "RC": { minLotSqft: 43560, maxDuPerAcre: 1, kind: "rural", allowsShortPlat: true,
    codeSection: "Auburn ACC 18.07.030 · Residential Conservancy", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-1": { minLotSqft: 35000, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Auburn ACC 18.07.030 · R-1", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-5": { minLotSqft: 6000, maxDuPerAcre: 5, kind: "sf", allowsShortPlat: true,
    codeSection: "Auburn ACC 18.07.030 · R-5", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-7": { minLotSqft: 4500, maxDuPerAcre: 7, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Auburn ACC 18.07.030 · R-7", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-10": { minLotSqft: null, maxDuPerAcre: 10, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Auburn ACC 18.07.030 · R-10", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-16": { minLotSqft: null, maxDuPerAcre: 16, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Auburn ACC 18.07.030 · R-16", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
  "R-20": { minLotSqft: null, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Auburn ACC 18.07.030 · R-20", codeUrl: "https://auburn.municipal.codes/ACC/18.07.030" },
};

// ─── Tukwila, WA — TMC 18.18 ─────────────────────────────────────────────────
const TUKWILA_WA: Record<CityCode, ZoningRule> = {
  "LDR": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Tukwila TMC 18.18 · Low Density Residential",
    codeUrl: "https://www.tukwilawa.gov/wp-content/uploads/DCD-Current-TMC-18.52.pdf" },
  "MDR": { minLotSqft: null, maxDuPerAcre: 12, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Tukwila TMC 18.18 · Medium Density Residential",
    codeUrl: "https://www.tukwilawa.gov/wp-content/uploads/DCD-Current-TMC-18.52.pdf" },
  "HDR": { minLotSqft: null, maxDuPerAcre: 22, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Tukwila TMC 18.18 · High Density Residential",
    codeUrl: "https://www.tukwilawa.gov/wp-content/uploads/DCD-Current-TMC-18.52.pdf" },
};

// ─── SeaTac, WA — SMC 15.400 ─────────────────────────────────────────────────
const SEATAC_WA: Record<CityCode, ZoningRule> = {
  "UL-7200": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "SeaTac SMC 15.400 · UL-7200",
    codeUrl: "https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15400.html" },
  "UM-3600": { minLotSqft: 3600, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "SeaTac SMC 15.400 · UM-3600",
    codeUrl: "https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15400.html" },
  "UM-2400": { minLotSqft: 2400, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "SeaTac SMC 15.400 · UM-2400",
    codeUrl: "https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15400.html" },
  "UH-1800": { minLotSqft: 1800, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "SeaTac SMC 15.400 · UH-1800",
    codeUrl: "https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15400.html" },
  "UH-900": { minLotSqft: 900, maxDuPerAcre: 48, kind: "multifamily", allowsShortPlat: false,
    codeSection: "SeaTac SMC 15.400 · UH-900",
    codeUrl: "https://www.codepublishing.com/WA/SeaTac/html/SeaTac15/SeaTac15400.html" },
};

// ─── Maple Valley, WA — MVMC 18.40 ───────────────────────────────────────────
const MAPLE_VALLEY_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 43560, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Maple Valley MVMC 18.40.030 · R-1",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
  "R-4": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Maple Valley MVMC 18.40.030 · R-4",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
  "R-6": { minLotSqft: 5000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Maple Valley MVMC 18.40.030 · R-6",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
  "R-8": { minLotSqft: 3750, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Maple Valley MVMC 18.40.030 · R-8",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
  "R-12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Maple Valley MVMC 18.40.030 · R-12",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
  "R-18": { minLotSqft: null, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Maple Valley MVMC 18.40.030 · R-18",
    codeUrl: "https://www.codepublishing.com/WA/MapleValley/html/MapleValley18/MapleValley1840.html" },
};

// ─── Snoqualmie, WA — SMC 17.15 ──────────────────────────────────────────────
const SNOQUALMIE_WA: Record<CityCode, ZoningRule> = {
  "RC": { minLotSqft: 43560, maxDuPerAcre: 0.5, kind: "rural", allowsShortPlat: true,
    codeSection: "Snoqualmie SMC 17.15.040 · Rural Cluster",
    codeUrl: "https://www.codepublishing.com/WA/Snoqualmie/html/Snoqualmie17/Snoqualmie1715.html" },
  "R-1": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Snoqualmie SMC 17.15.040 · R-1 Low",
    codeUrl: "https://www.codepublishing.com/WA/Snoqualmie/html/Snoqualmie17/Snoqualmie1715.html" },
  "R-2": { minLotSqft: 5000, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Snoqualmie SMC 17.15.040 · R-2 Medium",
    codeUrl: "https://www.codepublishing.com/WA/Snoqualmie/html/Snoqualmie17/Snoqualmie1715.html" },
  "R-3": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Snoqualmie SMC 17.15.040 · R-3 High",
    codeUrl: "https://www.codepublishing.com/WA/Snoqualmie/html/Snoqualmie17/Snoqualmie1715.html" },
};

// ─── North Bend, WA — NBMC 18.10 ─────────────────────────────────────────────
const NORTH_BEND_WA: Record<CityCode, ZoningRule> = {
  "LDR": { minLotSqft: 10000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "North Bend NBMC 18.10.040 · Low Density Residential",
    codeUrl: "https://www.codepublishing.com/WA/NorthBend/html/NorthBend18/NorthBend1810.html" },
  "MDR": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "North Bend NBMC 18.11 · Medium Density Residential",
    codeUrl: "https://www.codepublishing.com/WA/NorthBend/html/NorthBend18/NorthBend1811.html" },
  "HDR": { minLotSqft: null, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "North Bend NBMC 18.10 · High Density Residential",
    codeUrl: "https://www.codepublishing.com/WA/NorthBend/html/NorthBend18/NorthBend1810.html" },
};

// ─── Unincorporated King County — KCC Title 21A.12.030 ──────────────────────
// The KC GIS layer returns these codes for all unincorporated parcels.
// Authoritative source: https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning
const KING_COUNTY_UNINC: Record<CityCode, ZoningRule> = {
  "RA-2.5": { minLotSqft: 108900, maxDuPerAcre: 0.4, kind: "rural", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · RA-2.5",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "RA-5": { minLotSqft: 217800, maxDuPerAcre: 0.2, kind: "rural", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · RA-5",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "RA-10": { minLotSqft: 435600, maxDuPerAcre: 0.1, kind: "rural", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · RA-10",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-1": { minLotSqft: 24000, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-1",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-4": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-4",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-6": { minLotSqft: 5000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-6",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-8": { minLotSqft: 3750, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-8",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-12": { minLotSqft: 2500, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-12",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-18": { minLotSqft: 2000, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-18",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-24": { minLotSqft: 1500, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-24",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
  "R-48": { minLotSqft: 900, maxDuPerAcre: 48, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Unincorporated KC · KCC 21A.12.030 · R-48",
    codeUrl: "https://kingcounty.gov/en/legacy/services/gis/propresearch/kc_zoning" },
};

// ─── Des Moines, WA — DMMC Title 18 (added Jul 2026) ────────────────────────
// Middle housing (Ord. 1821, 2025): 4 units/lot or 24 du/ac in all RS zones;
// up to 3 ADUs count toward the 4; ADU condo conveyance allowed (Ord. 1820).
const DES_MOINES_WA: Record<CityCode, ZoningRule> = {
  "RS-15000": { minLotSqft: 15000, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Des Moines DMMC 18.52.010A · RS-15,000 (+ Ord. 1821 middle housing)",
    codeUrl: "https://www.codepublishing.com/WA/DesMoines/#!/DesMoines18/DesMoines1852.html",
    middleHousingUnitsPerLot: 4, verified: "verified",
    note: "HB 1110 (Ord. 1821): up to 4 units/lot or 24 du/ac, whichever is greater; max 3 ADUs count toward the total." },
  "RS-9600": { minLotSqft: 9600, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Des Moines DMMC 18.52.010A · RS-9,600",
    codeUrl: "https://www.codepublishing.com/WA/DesMoines/#!/DesMoines18/DesMoines1852.html",
    middleHousingUnitsPerLot: 4, verified: "verified" },
  "RS-8400": { minLotSqft: 8400, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Des Moines DMMC 18.52.010A · RS-8,400",
    codeUrl: "https://www.codepublishing.com/WA/DesMoines/#!/DesMoines18/DesMoines1852.html",
    middleHousingUnitsPerLot: 4, verified: "verified" },
  "RS-7200": { minLotSqft: 7200, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Des Moines DMMC 18.52.010A · RS-7,200",
    codeUrl: "https://www.codepublishing.com/WA/DesMoines/#!/DesMoines18/DesMoines1852.html",
    middleHousingUnitsPerLot: 4, verified: "verified" },
  "RS-4000": { minLotSqft: 4000, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Des Moines DMMC 18.52.010A · RS-4,000",
    codeUrl: "https://www.codepublishing.com/WA/DesMoines/#!/DesMoines18/DesMoines1852.html",
    middleHousingUnitsPerLot: 4, verified: "verified" },
};

// ─── Kenmore, WA — KMC 18.21 (Ord. 25-0630/25-0631, Dec 2025) ───────────────
const KENMORE_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: null, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Kenmore KMC 18.21.030 Table B · R-1", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 30, maxHeightFt: 35 }, verified: "secondary" },
  "R-4": { minLotSqft: 7200, maxDuPerAcre: 4, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kenmore KMC 18.21.030 Table B · R-4", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 55, maxImperviousPct: 45, maxHeightFt: 35 },
    middleHousingUnitsPerLot: 2, verified: "secondary",
    note: "Middle housing per KMC 18.21.035 (Ord. 25-0630/0631, 2025): min 2 units/lot; extraction indicates up to 4 — verify with the city." },
  "R-6": { minLotSqft: 5400, maxDuPerAcre: 6, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Kenmore KMC 18.21.030 Table B · R-6", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 70, maxImperviousPct: 60, maxHeightFt: 35 },
    middleHousingUnitsPerLot: 2, verified: "secondary" },
  "R-12": { minLotSqft: null, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kenmore KMC 18.21 · R-12", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 85, maxHeightFt: 60 }, verified: "secondary" },
  "R-18": { minLotSqft: null, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kenmore KMC 18.21 · R-18", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 85, maxHeightFt: 60 }, verified: "secondary" },
  "R-24": { minLotSqft: null, maxDuPerAcre: 24, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kenmore KMC 18.21 · R-24", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 85, maxHeightFt: 80 }, verified: "secondary" },
  "R-48": { minLotSqft: null, maxDuPerAcre: 48, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Kenmore KMC 18.21 · R-48", codeUrl: "https://ecode360.com/49600538",
    envelope: { maxLotCoveragePct: 90 }, verified: "secondary" },
};

// ─── Covington, WA — CMC 18.30.030 (added Jul 2026, table verified) ─────────
// Min lot area is 2,500 sqft in ALL residential zones; density governs yield.
const COVINGTON_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 2500, maxDuPerAcre: 1, kind: "sf", allowsShortPlat: true,
    codeSection: "Covington CMC 18.30.030 · R-1 Urban Separator",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 30, maxHeightFt: 35 }, verified: "verified",
    note: "Urban separator: clustering required, plat impervious cap 8%; HB 1110 2-unit minimum does NOT apply to urban-separator lots." },
  "R-4": { minLotSqft: 2500, maxDuPerAcre: 4, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Covington CMC 18.30.030 · R-4",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 55, maxHeightFt: 35 },
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "Ord. 04-25 (2025): min 2 units/lot (CMC 18.30.030(B)(21)); middle-housing base height 45 ft. Up to 6 du/ac with incentives." },
  "R-6": { minLotSqft: 2500, maxDuPerAcre: 6, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Covington CMC 18.30.030 · R-6",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 70, maxHeightFt: 35 },
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-8": { minLotSqft: 2500, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Covington CMC 18.30.030 · R-8",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 75, maxHeightFt: 35 },
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-12": { minLotSqft: 2500, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: true,
    codeSection: "Covington CMC 18.30.030 · R-12",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 75, maxHeightFt: 35 }, verified: "verified" },
  "R-18": { minLotSqft: 2500, maxDuPerAcre: 18, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Covington CMC 18.30.030 · R-18",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 75, maxHeightFt: 35 }, verified: "verified" },
  "MR": { minLotSqft: 2500, maxDuPerAcre: 14, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Covington CMC 18.30.030 · MR Multifamily",
    codeUrl: "https://covington.municipal.codes/CMC/18.30.030",
    envelope: { maxLotCoveragePct: 80, maxHeightFt: 60 }, verified: "verified",
    note: "Up to 50 du/ac with incentives." },
};

// ─── Woodinville, WA — WMC 21.31.030 (Ord. 792, 2025 — units-per-lot) ───────
const WOODINVILLE_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 35000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-1 (2 du/lot; +1 per extra 43,560 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-4": { minLotSqft: 9000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-4 (2 du/lot; +1 per extra 10,890 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-6": { minLotSqft: 6000, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-6 (3 du/lot; +1 per extra 7,260 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 3, verified: "verified" },
  "R-8": { minLotSqft: 5000, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-8 (3 du/lot; +1 per extra 5,445 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 3, verified: "verified" },
  "R-12": { minLotSqft: 3600, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-12 (3 du/lot base; +1 per extra 3,630 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 3, verified: "verified" },
  "R-18": { minLotSqft: 2400, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: true,
    codeSection: "Woodinville WMC 21.31.030 · R-18 (+1 per extra 2,420 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    middleHousingUnitsPerLot: 3, verified: "verified" },
  "R-24": { minLotSqft: 1700, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Woodinville WMC 21.31.030 · R-24 (min 3 du/lot; SF/duplex prohibited)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    verified: "verified" },
  "R-48": { minLotSqft: 900, maxDuPerAcre: null, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Woodinville WMC 21.31.030 · R-48 (+1 per extra 907 sqft)",
    codeUrl: "https://www.codepublishing.com/WA/Woodinville/html/Woodinville21/Woodinville2131.html",
    verified: "verified" },
};

// ─── Lake Forest Park, WA — LFPMC Title 18 (Ord. 1310, 2025) ────────────────
const LAKE_FOREST_PARK_WA: Record<CityCode, ZoningRule> = {
  "R-20": { minLotSqft: 20000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "LFPMC 18.16.030 · R-20 Residential Low",
    codeUrl: "https://www.codepublishing.com/WA/LakeForestPark/html/LakeForestPark18/LakeForestPark1816.html",
    envelope: { maxLotCoveragePct: 25, maxImperviousPct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "SF + one 2-unit middle-housing dwelling per lot (Ord. 1310, 2025)." },
  "R-15": { minLotSqft: 15000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "LFPMC 18.18 · R-15 Residential Low/Moderate",
    codeUrl: "https://www.codepublishing.com/WA/LakeForestPark/html/LakeForestPark18/LakeForestPark1818.html",
    middleHousingUnitsPerLot: 2, verified: "unverified",
    note: "Min lot inferred from zone name — verify LFPMC 18.18 before relying on a split." },
  "R-10": { minLotSqft: 10000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "LFPMC 18.20.030 · R-10 Residential Moderate/High",
    codeUrl: "https://www.codepublishing.com/WA/LakeForestPark/html/LakeForestPark18/LakeForestPark1820.html",
    envelope: { maxLotCoveragePct: 30, maxImperviousPct: 45, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-7.2": { minLotSqft: 7200, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "LFPMC 18.21 · R-7.2",
    codeUrl: "https://www.codepublishing.com/WA/LakeForestPark/html/LakeForestPark18/LakeForestPark1821.html",
    middleHousingUnitsPerLot: 2, verified: "unverified",
    note: "Min lot inferred from zone name — verify LFPMC 18.21 before relying on a split." },
};

// ─── Normandy Park, WA — NPMC 18.32 ─────────────────────────────────────────
const NORMANDY_PARK_WA: Record<CityCode, ZoningRule> = {
  "R-7.2": { minLotSqft: 7200, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Normandy Park NPMC 18.32 · R-7.2",
    codeUrl: "https://www.codepublishing.com/WA/NormandyPark/html/NormandyPark18/NormandyPark1832.html",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "unverified",
    note: "One extraction showed a reduced 4,800 sqft post-middle-housing minimum — verify NPMC 18.32 with the city." },
  "R-12.5": { minLotSqft: 12500, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Normandy Park NPMC 18.32 · R-12.5",
    codeUrl: "https://www.codepublishing.com/WA/NormandyPark/html/NormandyPark18/NormandyPark1832.html",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "unverified" },
  "R-15": { minLotSqft: 15000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Normandy Park NPMC 18.32 · R-15",
    codeUrl: "https://www.codepublishing.com/WA/NormandyPark/html/NormandyPark18/NormandyPark1832.html",
    envelope: { maxLotCoveragePct: 30, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "secondary" },
  "R-20": { minLotSqft: 20000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Normandy Park NPMC 18.32 · R-20",
    codeUrl: "https://www.codepublishing.com/WA/NormandyPark/html/NormandyPark18/NormandyPark1832.html",
    envelope: { maxLotCoveragePct: 30, maxHeightFt: 30 },
    middleHousingUnitsPerLot: 2, verified: "secondary" },
};

// ─── Enumclaw, WA — EMC 18.06.030 (outside contiguous UGA — no HB 1110) ─────
const ENUMCLAW_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 15000, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Enumclaw EMC 18.06.030 · R-1",
    codeUrl: "https://cityofenumclaw.net/DocumentCenter/View/8429/5-Appendix_E---EMC-18-06-030",
    envelope: { maxLotCoveragePct: 30, maxHeightFt: 30 }, verified: "verified" },
  "R-2": { minLotSqft: 8400, maxDuPerAcre: null, kind: "sf", allowsShortPlat: true,
    codeSection: "Enumclaw EMC 18.06.030 · R-2",
    codeUrl: "https://cityofenumclaw.net/DocumentCenter/View/8429/5-Appendix_E---EMC-18-06-030",
    envelope: { maxLotCoveragePct: 40, maxHeightFt: 30 }, verified: "verified",
    note: "Max lot 18,000 sqft; one 7,500 sqft lot allowed per short plat." },
  "R-3": { minLotSqft: 6200, maxDuPerAcre: 7, kind: "duplex", allowsShortPlat: true,
    codeSection: "Enumclaw EMC 18.06.030 · R-3",
    codeUrl: "https://cityofenumclaw.net/DocumentCenter/View/8429/5-Appendix_E---EMC-18-06-030",
    envelope: { maxLotCoveragePct: 40, maxHeightFt: 30 }, verified: "verified",
    note: "Duplex/cottage at 3,100 sqft per unit via CUP; max lot 12,500 sqft." },
  "R-4": { minLotSqft: 6200, maxDuPerAcre: 15, kind: "multifamily", allowsShortPlat: true,
    codeSection: "Enumclaw EMC 18.06.030 · R-4",
    codeUrl: "https://cityofenumclaw.net/DocumentCenter/View/8429/5-Appendix_E---EMC-18-06-030",
    envelope: { maxLotCoveragePct: 40, maxHeightFt: 30 }, verified: "verified",
    note: "≈1 DU/2,900 sqft (~15 du/ac); 30 du/ac senior housing by CUP." },
};

// ─── Duvall, WA — DMC 14.12 (SF), 14.14 (R12), 14.16 (R20) ──────────────────
const DUVALL_WA: Record<CityCode, ZoningRule> = {
  "R4": { minLotSqft: 6000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Duvall DMC 14.12.050 · R4",
    codeUrl: "https://library.municode.com/wa/duvall/codes/code_of_ordinances",
    envelope: { maxHeightFt: 30 }, verified: "secondary" },
  "R4.5": { minLotSqft: 5600, maxDuPerAcre: 4.5, kind: "sf", allowsShortPlat: true,
    codeSection: "Duvall DMC 14.12.060 · R4.5",
    codeUrl: "https://library.municode.com/wa/duvall/codes/code_of_ordinances",
    envelope: { maxHeightFt: 30 }, verified: "secondary" },
  "R6": { minLotSqft: 5000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Duvall DMC 14.12.070 · R6",
    codeUrl: "https://library.municode.com/wa/duvall/codes/code_of_ordinances",
    envelope: { maxHeightFt: 30 }, verified: "secondary" },
  "R8": { minLotSqft: 4000, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Duvall DMC 14.12.080 · R8",
    codeUrl: "https://library.municode.com/wa/duvall/codes/code_of_ordinances",
    envelope: { maxHeightFt: 30 }, verified: "secondary" },
  "R12": { minLotSqft: 2500, maxDuPerAcre: 12, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Duvall DMC 14.14 · R12 Multi-Family (min density 8 du/ac)",
    codeUrl: "https://www.duvallwa.gov/DocumentCenter/View/4192/Code-Chapters",
    envelope: { maxLotCoveragePct: 60, maxHeightFt: 35 }, verified: "verified" },
  "R20": { minLotSqft: 2250, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Duvall DMC 14.16 · R20 Multi-Family (min density 14 du/ac)",
    codeUrl: "https://www.duvallwa.gov/DocumentCenter/View/4192/Code-Chapters",
    envelope: { maxLotCoveragePct: 75, maxHeightFt: 35 }, verified: "verified" },
};

// ─── Carnation, WA — CMC 15.48 (secondary-source — spot-check) ──────────────
const CARNATION_WA: Record<CityCode, ZoningRule> = {
  "R-4": { minLotSqft: 10000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Carnation CMC 15.48 · R-4", codeUrl: "https://library.municode.com/wa/carnation/codes/code_of_ordinances",
    envelope: { maxLotCoveragePct: 35, maxHeightFt: 30 }, verified: "secondary" },
  "R-6": { minLotSqft: 6000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Carnation CMC 15.48 · R-6", codeUrl: "https://library.municode.com/wa/carnation/codes/code_of_ordinances",
    envelope: { maxLotCoveragePct: 40, maxHeightFt: 35 }, verified: "secondary" },
  "R-8": { minLotSqft: 5000, maxDuPerAcre: 8, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Carnation CMC 15.48 · R-8", codeUrl: "https://library.municode.com/wa/carnation/codes/code_of_ordinances",
    envelope: { maxLotCoveragePct: 45, maxHeightFt: 35 }, verified: "secondary" },
  "R-15": { minLotSqft: 3000, maxDuPerAcre: 15, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Carnation CMC 15.48 · R-15", codeUrl: "https://library.municode.com/wa/carnation/codes/code_of_ordinances",
    envelope: { maxLotCoveragePct: 50, maxHeightFt: 35 }, verified: "secondary" },
  "R-20": { minLotSqft: 2500, maxDuPerAcre: 20, kind: "multifamily", allowsShortPlat: false,
    codeSection: "Carnation CMC 15.48 · R-20", codeUrl: "https://library.municode.com/wa/carnation/codes/code_of_ordinances",
    envelope: { maxLotCoveragePct: 55, maxHeightFt: 35 }, verified: "secondary" },
};

// ─── Black Diamond, WA — BDMC 18.30.040 ─────────────────────────────────────
const BLACK_DIAMOND_WA: Record<CityCode, ZoningRule> = {
  "R4": { minLotSqft: 9600, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Black Diamond BDMC 18.30.040 · R4 (Ord. 17-1089)",
    codeUrl: "https://library.municode.com/wa/black_diamond/codes/code_of_ordinances",
    envelope: { maxImperviousPct: 70, maxHeightFt: 32 }, verified: "verified" },
  "R6": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Black Diamond BDMC 18.30.040 · R6",
    codeUrl: "https://library.municode.com/wa/black_diamond/codes/code_of_ordinances",
    envelope: { maxImperviousPct: 70, maxHeightFt: 32 }, verified: "secondary" },
  "MPD": { minLotSqft: null, maxDuPerAcre: null, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Black Diamond BDMC 18.98 · Master Planned Development overlay",
    codeUrl: "https://library.municode.com/wa/black_diamond/codes/code_of_ordinances",
    verified: "unverified",
    note: "MPD parcels (Ten Trails) use the MPD permit's own lot standards, not BDMC 18.30.040." },
};

// ─── Pacific, WA — PMC Title 20 (UNVERIFIED placeholders) ───────────────────
const PACIFIC_WA: Record<CityCode, ZoningRule> = {
  "RS": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Pacific PMC Title 20 · RS Single-Family (UNVERIFIED — confirm with city)",
    codeUrl: "https://www.codepublishing.com/WA/Pacific/", verified: "unverified" },
  "MDR": { minLotSqft: null, maxDuPerAcre: 8, kind: "duplex", allowsShortPlat: true,
    codeSection: "Pacific PMC Title 20 · Medium Density Residential (UNVERIFIED — comp-plan avg density)",
    codeUrl: "https://www.codepublishing.com/WA/Pacific/", verified: "unverified" },
};

// ─── Algona, WA — AMC 22.24.060 (single residential district) ───────────────
const ALGONA_WA: Record<CityCode, ZoningRule> = {
  "R": { minLotSqft: 4000, maxDuPerAcre: 17, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Algona AMC 22.24.060 · Residential (Ord. 1255-25)",
    codeUrl: "https://algona.municipal.codes/Code/22.24.060",
    envelope: { maxLotCoveragePct: 65, maxHeightFt: 25 },
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "Min lot 4,000; max 17 du/ac (SF detached capped at 8 du/ac). Middle housing/ADU height 36 ft when stacked over garage; base 25 ft." },
};

// ─── Medina, WA — MMC Title 16 ──────────────────────────────────────────────
const MEDINA_WA: Record<CityCode, ZoningRule> = {
  "R-16": { minLotSqft: 16000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Medina MMC 16.73 · R-16 (16,000 sqft min lot)",
    codeUrl: "https://library.municode.com/wa/medina/codes/code_of_ordinances",
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "HB 1110 Tier 3: 2 units/lot required." },
  "R-20": { minLotSqft: 20000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Medina MMC Title 16 · R-20 (20,000 sqft min lot)",
    codeUrl: "https://library.municode.com/wa/medina/codes/code_of_ordinances",
    middleHousingUnitsPerLot: 2, verified: "verified" },
  "R-30": { minLotSqft: 30000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Medina MMC 16.73 · R-30 (30,000 sqft min lot)",
    codeUrl: "https://library.municode.com/wa/medina/codes/code_of_ordinances",
    middleHousingUnitsPerLot: 2, verified: "verified" },
};

// ─── Clyde Hill, WA — CHMC 17.16 ────────────────────────────────────────────
const CLYDE_HILL_WA: Record<CityCode, ZoningRule> = {
  "R-1": { minLotSqft: 20000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Clyde Hill CHMC 17.16.030 · R-1 (20,000 sqft min building site)",
    codeUrl: "https://ecode360.com/CL4436",
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "Min frontage 100 ft. HB 1110 Tier 3: 2 units/lot (2025 middle-housing/ADU updates adopted)." },
};

// ─── Yarrow Point, WA — YPMC 17.16 ──────────────────────────────────────────
const YARROW_POINT_WA: Record<CityCode, ZoningRule> = {
  "R-12": { minLotSqft: 12000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Yarrow Point YPMC 17.16 · R-12",
    codeUrl: "https://www.codepublishing.com/WA/YarrowPoint/html/YarrowPoint17/YarrowPoint1716.html",
    envelope: { maxLotCoveragePct: 30, maxImperviousPct: 60 },
    middleHousingUnitsPerLot: 2, verified: "secondary" },
  "R-15": { minLotSqft: 15000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Yarrow Point YPMC 17.16 · R-15",
    codeUrl: "https://www.codepublishing.com/WA/YarrowPoint/html/YarrowPoint17/YarrowPoint1716.html",
    middleHousingUnitsPerLot: 2, verified: "unverified",
    note: "Min lot inferred from zone name — verify YPMC 17.16." },
};

// ─── Hunts Point, WA — HPMC Title 18 ────────────────────────────────────────
const HUNTS_POINT_WA: Record<CityCode, ZoningRule> = {
  "R-40": { minLotSqft: 40000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Hunts Point HPMC 18.31 · R-40",
    codeUrl: "https://ecode360.com/48429425",
    middleHousingUnitsPerLot: 2, verified: "unverified",
    note: "Zone verified; 40,000 sqft min inferred from zone name — verify HPMC 18.31." },
  "R-20A": { minLotSqft: 20000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Hunts Point HPMC 18.38 · R-20A Flex",
    codeUrl: "https://ecode360.com/48429612",
    middleHousingUnitsPerLot: 2, verified: "unverified" },
};

// ─── Beaux Arts Village, WA — single residential zone ───────────────────────
const BEAUX_ARTS_WA: Record<CityCode, ZoningRule> = {
  "R": { minLotSqft: 10000, maxDuPerAcre: null, kind: "duplex", allowsShortPlat: true,
    codeSection: "Beaux Arts Village · single residential zone (min lot 10,000, 2025–2045 Comp Plan)",
    codeUrl: "https://beauxarts-wa.gov/documents/153/241230_TBA_Comprehensive_Plan_Final.pdf",
    middleHousingUnitsPerLot: 2, verified: "verified",
    note: "HB 1110 Tier 3: 2 units/lot; no higher middle-housing mandate." },
};

// Registry keyed by "STATE|CITY". Extend by dropping a table here.
// Unincorporated KC uses a synthetic city key "KING COUNTY".
const REGISTRY: Record<string, Record<CityCode, ZoningRule>> = {
  "WA|BELLEVUE": BELLEVUE_WA,
  "WA|SEATTLE": SEATTLE_WA,
  "WA|KIRKLAND": KIRKLAND_WA,
  "WA|REDMOND": REDMOND_WA,
  "WA|RENTON": RENTON_WA,
  "WA|SAMMAMISH": SAMMAMISH_WA,
  "WA|ISSAQUAH": ISSAQUAH_WA,
  "WA|MERCER ISLAND": MERCER_ISLAND_WA,
  "WA|FEDERAL WAY": FEDERAL_WAY_WA,
  "WA|KENT": KENT_WA,
  "WA|SHORELINE": SHORELINE_WA,
  "WA|BOTHELL": BOTHELL_WA,
  "WA|BURIEN": BURIEN_WA,
  "WA|NEWCASTLE": NEWCASTLE_WA,
  "WA|AUBURN": AUBURN_WA,
  "WA|TUKWILA": TUKWILA_WA,
  "WA|SEATAC": SEATAC_WA,
  "WA|MAPLE VALLEY": MAPLE_VALLEY_WA,
  "WA|SNOQUALMIE": SNOQUALMIE_WA,
  "WA|NORTH BEND": NORTH_BEND_WA,
  "WA|KING COUNTY": KING_COUNTY_UNINC,
  // Added Jul 2026 — full-county coverage pass:
  "WA|DES MOINES": DES_MOINES_WA,
  "WA|KENMORE": KENMORE_WA,
  "WA|COVINGTON": COVINGTON_WA,
  "WA|WOODINVILLE": WOODINVILLE_WA,
  "WA|LAKE FOREST PARK": LAKE_FOREST_PARK_WA,
  "WA|NORMANDY PARK": NORMANDY_PARK_WA,
  "WA|ENUMCLAW": ENUMCLAW_WA,
  "WA|DUVALL": DUVALL_WA,
  "WA|CARNATION": CARNATION_WA,
  "WA|BLACK DIAMOND": BLACK_DIAMOND_WA,
  "WA|PACIFIC": PACIFIC_WA,
  "WA|ALGONA": ALGONA_WA,
  "WA|MEDINA": MEDINA_WA,
  "WA|CLYDE HILL": CLYDE_HILL_WA,
  "WA|YARROW POINT": YARROW_POINT_WA,
  "WA|HUNTS POINT": HUNTS_POINT_WA,
  "WA|BEAUX ARTS": BEAUX_ARTS_WA,
  "WA|BEAUX ARTS VILLAGE": BEAUX_ARTS_WA,
};

function normalize(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export interface ZoningLookupInput {
  state?: string | null;
  city?: string | null;
  code?: string | null;
}

/**
 * Returns the authoritative zoning rule for this property's city + code,
 * or null when the city isn't in the registry yet (caller falls back to
 * the generic regex parser).
 */
export function lookupZoning(input: ZoningLookupInput): ZoningRule | null {
  const state = normalize(input.state);
  const city = normalize(input.city);
  const code = normalize(input.code);
  if (!state || !city || !code) return null;
  const table = REGISTRY[`${state}|${city}`];
  if (!table) return null;
  // Try exact match, then space-stripped (handles "SF 5000" vs "SF-5000" inputs).
  if (table[code]) return table[code];
  const alt = code.replace(/[\s-]+/g, "");
  for (const key of Object.keys(table)) {
    if (key.replace(/[\s-]+/g, "") === alt) return table[key];
  }
  return null;
}

/** True when the rule permits only detached single-family homes. */
export function isSingleFamilyOnly(rule: ZoningRule | null): boolean {
  return rule?.kind === "sf";
}

/** True when stacked multifamily (3+ units) is allowed by-right. */
export function allowsMultifamily(rule: ZoningRule | null): boolean {
  return rule?.kind === "multifamily" || rule?.kind === "mixed_use";
}

/** True when attached townhomes / rowhouses are allowed by-right. */
export function allowsTownhomes(rule: ZoningRule | null): boolean {
  if (!rule) return false;
  return rule.kind === "sf_attached" || rule.kind === "duplex" ||
         rule.kind === "multifamily" || rule.kind === "mixed_use";
}
