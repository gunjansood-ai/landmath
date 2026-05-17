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
    note: "Single-family detached only. A 2-lot short plat requires ≥17,000 sqft (2 × 8,500). Townhome and multifamily forms are not permitted.",
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
  "NR1": { minLotSqft: 9600, maxDuPerAcre: 4.5, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 1",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "NR2": { minLotSqft: 7200, maxDuPerAcre: 6, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 2",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
  "NR3": { minLotSqft: 5000, maxDuPerAcre: 8.7, kind: "sf_attached", allowsShortPlat: true,
    codeSection: "Seattle SMC 23.44 · Neighborhood Residential 3",
    codeUrl: "https://library.municode.com/wa/seattle/codes/municipal_code" },
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
  "R-4": { minLotSqft: 8000, maxDuPerAcre: 4, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-4",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "R-6": { minLotSqft: 7000, maxDuPerAcre: 6, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-6",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
  "R-8": { minLotSqft: 4500, maxDuPerAcre: 8, kind: "sf", allowsShortPlat: true,
    codeSection: "Renton RMC 4-2-110A · R-8",
    codeUrl: "https://www.codepublishing.com/WA/Renton/html/Renton04/Renton0402/Renton0402110A.html" },
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
