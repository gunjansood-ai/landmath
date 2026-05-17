import {
  Strategy,
  QualityTier,
  FinancingConfig,
  PropertyData,
  AnalysisResult,
  TownhomeInputs,
  MultiFamilyInputs,
} from "@/store/useStore";
import {
  computeConfidence,
  computeNeighborhoodGuardrails,
  type NeighborhoodGuardrails,
} from "@/lib/buildability";

// Cost per sqft by quality tier (WA state defaults)
export const DEFAULT_COST_PER_SQFT: Record<QualityTier, number> = {
  standard: 220,
  premium: 300,
  luxury: 425,
  ultra_luxury: 650,
};

// Quality tier display info
export const QUALITY_TIERS: Record<
  QualityTier,
  { label: string; description: string; timeMultiplier: number }
> = {
  standard: {
    label: "Standard",
    description: "Builder-grade finishes, basic systems",
    timeMultiplier: 1.0,
  },
  premium: {
    label: "Premium",
    description: "Upgraded finishes, hardwood, quartz, energy efficient",
    timeMultiplier: 1.2,
  },
  luxury: {
    label: "Luxury",
    description: "High-end finishes, smart home, designer touches",
    timeMultiplier: 1.5,
  },
  ultra_luxury: {
    label: "Ultra-Luxury",
    description: "Fully custom, imported materials, architectural",
    timeMultiplier: 2.0,
  },
};

// Strategy display info
export const STRATEGIES: Record<
  Strategy,
  { label: string; tagline: string; icon: string }
> = {
  fresh_build: {
    label: "Fresh Build",
    tagline: "Tear it down, start from scratch",
    icon: "building",
  },
  split_build: {
    label: "Split & Build",
    tagline: "Divide the lot, multiply the profit",
    icon: "scissors",
  },
  main_adu: {
    label: "Main + ADU",
    tagline: "Primary home plus income units",
    icon: "home",
  },
  flip_fix: {
    label: "Flip & Fix",
    tagline: "Renovate and cash out",
    icon: "wrench",
  },
  townhome: {
    label: "Townhome",
    tagline: "Row houses, sell each unit",
    icon: "rows",
  },
  multifamily: {
    label: "Multi-Family",
    tagline: "Condo or income-producing complex",
    icon: "building2",
  },
  pass: {
    label: "Pass",
    tagline: "The math doesn't work",
    icon: "x",
  },
};

/**
 * Estimate the district minimum lot size from a zoning code string.
 * Handles common WA patterns:
 *   - SF-5000, SF-7200 → numeric is the min lot in sqft
 *   - R-5, R-7.2, RS-5 → numeric is units-per-acre OR min lot in 1000s of sqft
 *   - R-1, R-2, R-3 → dwelling-units-per-acre (smaller number = larger lot)
 *   - NR-1 / RA-2.5 / RA-5 (King County rural) → 1, 2.5, 5 acres respectively
 *   - LR1/LR2/LR3, MR, HR → Seattle low-rise / mid-rise / high-rise (no min lot)
 *   - Returns null when the code is unrecognized.
 */
export function estimateDistrictMinLotSqft(zoningCode: string | null | undefined): number | null {
  if (!zoningCode || /^unknown$/i.test(zoningCode)) return null;
  const upper = zoningCode.trim().toUpperCase();

  // Seattle Low-Rise / Mid-Rise / High-Rise — no minimum lot size (density zones)
  if (/^(LR[123]|MR|HR|NC[123]|C[12]|IB|IC|IG[12]?)[^0-9]?/.test(upper)) return null;

  // Rural-area pattern: RA-X means X-acre minimum
  const ra = upper.match(/^RA[- ]?(\d+(?:\.\d+)?)/);
  if (ra) return Math.round(parseFloat(ra[1]) * 43560);

  // Rural NR-1 etc — common in unincorporated KC
  const nr = upper.match(/^NR[- ]?(\d+(?:\.\d+)?)/);
  if (nr) return Math.round(parseFloat(nr[1]) * 43560);

  // SF-NNNN, RS-NNNN — number is explicit sqft minimum
  const sfNumeric = upper.match(/(?:SF|RS)[- ]?(\d{3,5})(?:[^\d]|$)/);
  if (sfNumeric) {
    const n = parseInt(sfNumeric[1], 10);
    if (n >= 1000) return n;
  }

  // R-NNNN — number ≥ 1000 treated as explicit sqft
  const rSqft = upper.match(/^R[- ]?(\d{4,5})(?:[^\d]|$)/);
  if (rSqft) {
    const n = parseInt(rSqft[1], 10);
    if (n >= 1000 && n <= 200000) return n;
  }

  // R-N with N as units-per-acre (Bellevue, Seattle low-density)
  const rUnits = upper.match(/^R[- ]?(\d+(?:\.\d+)?)$/);
  if (rUnits) {
    const units = parseFloat(rUnits[1]);
    if (units > 0 && units <= 30) {
      return Math.round(43560 / units);
    }
  }

  // Last-resort: any embedded 4-5 digit number = explicit sqft
  const anyNumeric = upper.match(/(\d{4,5})/);
  if (anyNumeric) {
    const n = parseInt(anyNumeric[1], 10);
    if (n >= 1000 && n <= 200000) return n;
  }

  return null;
}

// ─── Zoning classification helpers ──────────────────────────────────────────

type ZoningClass =
  | "sf"           // single-family (SF-5000, R-1, RS-9600 …)
  | "lr"           // Seattle low-rise (LR1/LR2/LR3) — allows townhomes + small MF
  | "mr_hr"        // Seattle mid/high-rise — allows large MF
  | "commercial"   // NC/C/IB zones — mixed use
  | "rural"        // RA/NR zones
  | "unknown";

export function classifyZoning(zoningCode: string | null | undefined): ZoningClass {
  if (!zoningCode || /^unknown$/i.test(zoningCode)) return "unknown";
  const upper = zoningCode.trim().toUpperCase();
  if (/^(HR|MR)([^0-9]|$)/.test(upper)) return "mr_hr";
  if (/^LR[123]([^0-9]|$)/.test(upper)) return "lr";
  if (/^(NC[123]|C[12]|IB|IC|IG[12]?)([^0-9]|$)/.test(upper)) return "commercial";
  if (/^(RA|NR)[- ]?\d/.test(upper)) return "rural";
  // SF, RS, R-NNNN, R-N (small number = SF density)
  if (/^(SF|RS)[- ]?\d/.test(upper)) return "sf";
  if (/^R[- ]?\d/.test(upper)) return "sf"; // R-1 through R-9, R-5000, etc.
  return "unknown";
}

// ─── Official zoning lookup URLs ─────────────────────────────────────────────

export interface ZoningLookupLink {
  label: string;
  url: string;
}

/**
 * Returns up to two official links the user can click to verify zoning for
 * the subject property. Coordinates are used for map-based portals.
 */
export function getZoningLookupLinks(
  property: Pick<PropertyData, "city" | "state" | "county" | "zip" | "lat" | "lng" | "zoningCode" | "subjectAssessorUrl" | "subjectParcelViewerUrl">
): ZoningLookupLink[] {
  const city = (property.city ?? "").toLowerCase();
  const state = (property.state ?? "").toUpperCase();
  const lat = property.lat;
  const lng = property.lng;
  const links: ZoningLookupLink[] = [];

  if (state === "WA") {
    if (city.includes("seattle")) {
      if (lat && lng) {
        links.push({
          label: "Seattle Zoning Map (SDCI)",
          url: `https://maps.seattle.gov/SDCI/?lat=${lat}&lng=${lng}`,
        });
      } else {
        links.push({
          label: "Seattle Zoning Map (SDCI)",
          url: "https://maps.seattle.gov/SDCI/",
        });
      }
      links.push({
        label: "Seattle ADU Resources (SDCI)",
        url: "https://www.seattle.gov/sdci/permits/common-projects/accessory-dwelling-units",
      });
    } else if (city.includes("bellevue")) {
      links.push({
        label: "Bellevue Zoning Map",
        url: "https://gisapps.bellevuewa.gov/Portal/apps/storymaps/map-viewer/index.html#webmap=a2a5b5acbb8e48d98e8f1d9a2c93c929",
      });
      links.push({
        label: "Bellevue Land Use & Zoning",
        url: "https://bellevuewa.gov/city-government/departments/community-development/land-use",
      });
    } else if (city.includes("kirkland")) {
      links.push({
        label: "Kirkland Zoning Map",
        url: "https://www.kirklandwa.gov/government/departments/planning-building/planning-zoning",
      });
    } else if (city.includes("redmond")) {
      links.push({
        label: "Redmond Permits & Zoning",
        url: "https://www.redmond.gov/428/Permits-and-Zoning",
      });
    } else {
      // Generic KC
      if (lat && lng) {
        links.push({
          label: "King County GIS Parcel Viewer",
          url: `https://blue.kingcounty.gov/Assessor/eRealProperty/default.aspx`,
        });
      }
      links.push({
        label: "King County DPER Permits",
        url: "https://www.kingcounty.gov/depts/local-services/permits.aspx",
      });
    }
  } else {
    // Generic fallback: Google the city's zoning map
    const cityLabel = property.city ? `${property.city}, ${state}` : state;
    links.push({
      label: `${cityLabel} Zoning Map`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${cityLabel} zoning map official`)}`,
    });
    links.push({
      label: `${cityLabel} Building Permits`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${cityLabel} building permit lookup`)}`,
    });
  }

  // If we have a direct assessor URL from GIS, always append it
  if (property.subjectAssessorUrl) {
    links.push({
      label: "Assessor Property Record",
      url: property.subjectAssessorUrl,
    });
  }
  if (property.subjectParcelViewerUrl) {
    links.push({
      label: "Parcel Viewer Map",
      url: property.subjectParcelViewerUrl,
    });
  }

  return links;
}

// ─── Feasibility reasoning ────────────────────────────────────────────────────

export interface FeasibilityReasoning {
  verdict: "permitted" | "conditional" | "not_allowed";
  summary: string;
  logic: string[];        // step-by-step bullets explaining the decision
  assumptions: string[];  // explicit assumptions / limitations
  gaps: string[];         // what we couldn't verify
  links: ZoningLookupLink[];
}

/**
 * Returns a plain-English breakdown of why we scored a strategy as
 * permitted / conditional / not_allowed for this property.
 */
export function getFeasibilityReasoning(
  property: PropertyData,
  strategy: Strategy,
  feasibility: "permitted" | "conditional" | "not_allowed"
): FeasibilityReasoning {
  const zoningClass = classifyZoning(property.zoningCode);
  const districtMin = estimateDistrictMinLotSqft(property.zoningCode);
  const lot = property.lotSizeSqft;
  const links = getZoningLookupLinks(property);
  const zCode = property.zoningCode || "Unknown";

  switch (strategy) {
    case "fresh_build": {
      return {
        verdict: feasibility,
        summary: "Demolish and rebuild — almost always zoning-permitted on residential lots.",
        logic: [
          `Your lot is zoned "${zCode}". A tear-down rebuild doesn't change density or lot layout, so zoning approval is generally straightforward.`,
          "The main gating factor is a building permit, not a rezone or subdivision approval.",
          "We marked this 'Permitted' because no new lots, additional units, or density increase is required.",
        ],
        assumptions: [
          "The existing structure has no landmark or historic designation requiring review.",
          "There are no deed restrictions, HOA rules, or easements blocking demolition.",
          "No critical areas (steep slopes, wetlands, floodplain) require special setback treatment.",
        ],
        gaps: [
          "We didn't check whether the lot is in a historic district — call the city if the home is pre-1940.",
          "We didn't verify specific setback, FAR, or height limits for your zone — confirm with a designer before drawing plans.",
        ],
        links,
      };
    }

    case "split_build": {
      if (feasibility === "not_allowed") {
        const reason = !districtMin
          ? `We couldn't parse a minimum lot size from zoning code "${zCode}", and the lot (${lot.toLocaleString()} sqft) is below our 15,000 sqft conservative threshold for an unrecognized code.`
          : `Your lot (${lot.toLocaleString()} sqft) is smaller than the 2× district minimum required for a split: ${(districtMin * 2).toLocaleString()} sqft.`;
        return {
          verdict: "not_allowed",
          summary: "Lot too small to split under estimated zoning rules.",
          logic: [reason],
          assumptions: [
            `District minimum lot size ${districtMin ? `estimated at ${districtMin.toLocaleString()} sqft from code "${zCode}"` : "could not be determined"}.`,
            "Two resulting parcels must each meet or exceed the district minimum after the split.",
          ],
          gaps: [
            "Zoning code parsing is an estimate. Confirm the actual minimum lot size with city planning.",
            "Critical areas, deed restrictions, or frontage requirements may impose additional constraints.",
          ],
          links,
        };
      }
      const required = districtMin ? districtMin * 2 : null;
      const margin = required ? Math.round(((lot - required) / required) * 100) : null;
      return {
        verdict: feasibility,
        summary: feasibility === "permitted"
          ? "Lot size likely supports a two-lot split — verify with city."
          : "Lot is borderline for a split — formal city review required.",
        logic: [
          districtMin
            ? `Zoning code "${zCode}" → estimated district minimum lot: ${districtMin.toLocaleString()} sqft.`
            : `Zoning code "${zCode}" not recognized — using 15,000 sqft conservative threshold.`,
          `Your lot: ${lot.toLocaleString()} sqft. Two new lots must each meet the minimum, so the lot needs to be at least ${required?.toLocaleString() ?? "2×"} the district min.`,
          margin != null
            ? `Your lot is ${margin > 0 ? "+" : ""}${margin}% vs. the required minimum — ${feasibility === "permitted" ? "clears the bar with a safety margin" : "just barely meets it, leaving little room for setbacks or access easements"}.`
            : `At this size a split is plausible under most WA single-family zoning.`,
          "We add a 10% buffer on top of the bare minimum to account for setbacks, access easements, and frontage requirements that eat into usable area.",
        ],
        assumptions: [
          "Short plats (2-lot splits) are the assumed process — subdivisions into 3+ lots take longer.",
          "Both resulting lots must have independent street access (panhandle or frontage).",
          "No critical areas (wetlands, steep slopes) overlap the subdivision line.",
          "Assumption: city allows two detached structures in this zone.",
        ],
        gaps: [
          "We estimated the district minimum from the zoning code string — the city may use a different value.",
          "We didn't check frontage width, which can block a split even when lot area is sufficient.",
          "Short-plat approval involves discretionary review; the lot-size math is necessary but not sufficient.",
          "Tree retention, utility easements, and access width rules vary by city.",
        ],
        links,
      };
    }

    case "main_adu": {
      if (feasibility === "not_allowed") {
        return {
          verdict: "not_allowed",
          summary: "Lot is too small for an ADU under our minimum threshold.",
          logic: [
            `Your lot is ${lot.toLocaleString()} sqft. We use 4,000 sqft as the floor below which ADU construction becomes physically impractical regardless of zoning.`,
            "Washington HB 1337 (2023) mandates ADU rights across urban lots, but very small lots still face practical constraints.",
          ],
          assumptions: [
            "Physical ADU construction on lots below 4,000 sqft is rare due to setback requirements.",
          ],
          gaps: [
            "Your city may have looser rules — confirm with the local permitting office.",
          ],
          links,
        };
      }
      return {
        verdict: feasibility,
        summary: "ADUs are broadly allowed on WA residential lots by state law.",
        logic: [
          "Washington HB 1337 (signed April 2023) requires all cities in Urban Growth Areas to permit at least one Accessory Dwelling Unit on any lot that can accommodate a single-family home.",
          "The law allows up to 2 ADUs per lot (one attached/JADU + one detached/DADU).",
          `Your lot is ${lot.toLocaleString()} sqft — ${lot >= 5000 ? "comfortably above" : "near"} the 5,000 sqft threshold we use as the practical minimum for a detached ADU with required setbacks.`,
          lot >= 5000
            ? "We marked this 'Permitted' — state law removes the need for a rezone or special exception."
            : "We marked this 'Conditional' because the small lot size may make it physically difficult to meet setback requirements for a detached ADU.",
        ],
        assumptions: [
          "The property is in a Washington State Urban Growth Area.",
          "The existing home qualifies as a primary residence (ADUs aren't allowed on vacant lots).",
          "Owner-occupancy rules, if any, have been checked — HB 1337 eliminated most but some cities had grandfathered rules.",
        ],
        gaps: [
          "City-specific ADU design standards (setbacks, height, FAR, max size) still apply — we haven't verified those.",
          "HOA rules may restrict or prohibit ADUs even when city zoning allows them.",
          "Short-term rental restrictions may affect ADU revenue potential.",
          "HB 1337 doesn't override critical area setbacks (wetlands, steep slopes).",
        ],
        links,
      };
    }

    case "flip_fix": {
      return {
        verdict: "permitted",
        summary: "Renovation work never requires a rezone — always zoning-permitted.",
        logic: [
          "A fix-and-flip renovates the existing structure. No new lots, units, or density change is involved.",
          "This means no zoning approval is needed — only a building permit for the scope of work.",
          `The existing use (residential, zoned "${zCode}") is preserved.`,
        ],
        assumptions: [
          "The renovation stays within the existing footprint (no major additions).",
          "The home is not in a historic preservation district requiring design review.",
          "Work is cosmetic + systems (kitchen, baths, electrical, plumbing) — not structural changes that require engineering review.",
        ],
        gaps: [
          "If you plan to add square footage, zoning setbacks and FAR limits apply — that would be an 'Addition' permit, not just renovation.",
          "Unpermitted work in the existing structure may surface during permit inspection.",
        ],
        links,
      };
    }

    case "townhome": {
      if (feasibility === "not_allowed") {
        const isLrOrHigher = ["lr", "mr_hr", "commercial"].includes(zoningClass);
        return {
          verdict: "not_allowed",
          summary: "Townhome/row-house development doesn't appear permitted in this zone.",
          logic: [
            `Zoning code "${zCode}" → classified as "${zoningClass}".`,
            isLrOrHigher
              ? "This is a density zone that typically allows townhomes, but our pattern match didn't find a confirmed match."
              : "Townhomes require at least Low-Rise (LR1) or equivalent attached-housing zoning. Single-family zones typically prohibit them.",
            `Lot size ${lot.toLocaleString()} sqft is also below our 8,000 sqft minimum for townhome feasibility.`,
          ],
          assumptions: [
            "Townhome/row-house = attached housing requiring at least LR1 or RM zoning in most WA cities.",
          ],
          gaps: [
            "Some cities allow cottage housing clusters on SF lots — your city may have this provision.",
            "A formal pre-application conference with the city is the only reliable way to confirm.",
          ],
          links,
        };
      }
      return {
        verdict: feasibility,
        summary: feasibility === "permitted"
          ? "Zoning code suggests attached housing is allowed here."
          : "Townhomes may be possible but require formal city confirmation.",
        logic: [
          `Zoning code "${zCode}" → classified as "${zoningClass}".`,
          zoningClass === "lr"
            ? "Seattle LR1/LR2/LR3 zones explicitly permit townhomes and rowhouses up to defined height limits."
            : zoningClass === "mr_hr" || zoningClass === "commercial"
            ? "Mid-rise, high-rise, and commercial zones typically allow townhomes as a lower-intensity use."
            : "Our pattern match found attached-housing zoning indicators in the code, but couldn't confirm the exact subzone rules.",
          `Lot size ${lot.toLocaleString()} sqft ${lot >= 8000 ? "is adequate" : "is tight"} for a townhome project (typical minimum ~6,000 sqft).`,
        ],
        assumptions: [
          "Townhome = attached fee-simple units (not condos).",
          "Unit count and density are assumed to be within the zone's maximum.",
          "Adequate street frontage and access for each unit is assumed.",
        ],
        gaps: [
          "We haven't verified the specific unit count or height limit for your subzone.",
          "Seattle LR zones have detailed design standards (setbacks, landscaping, facade) — a pre-application meeting is recommended.",
          "Form-based code requirements (modulation, materials) vary.",
        ],
        links,
      };
    }

    case "multifamily": {
      if (feasibility === "not_allowed") {
        return {
          verdict: "not_allowed",
          summary: "Multi-family development doesn't appear permitted in this zone.",
          logic: [
            `Zoning code "${zCode}" → classified as "${zoningClass}".`,
            zoningClass === "sf"
              ? "Single-family zones prohibit multi-family (3+ unit) buildings. You'd need an upzone or a SEPA rezone process."
              : zoningClass === "lr"
              ? "Seattle LR zones allow townhomes and small multi-family (LR2+ typically allows 6+ units), but the specific subzone limits may cap unit count."
              : `Code "${zCode}" doesn't match mid-rise (MR), high-rise (HR), or RM patterns required for standard multi-family.`,
            lot < 12000
              ? `Lot size (${lot.toLocaleString()} sqft) is also below our 12,000 sqft minimum for a practical multi-family project.`
              : "",
          ].filter(Boolean),
          assumptions: [
            "Multi-family = 4+ unit building (not duplex/triplex, which may have separate allowances).",
          ],
          gaps: [
            "WA HB 1110 (2023) requires many cities to allow middle housing (duplexes, fourplexes) on SF lots. If your city has implemented this, triplex/fourplex may now be legal even in an SF zone.",
            "Confirm with city planning — a pre-application conference will clarify what's allowed.",
          ],
          links,
        };
      }
      return {
        verdict: feasibility,
        summary: feasibility === "permitted"
          ? "Zoning code supports multi-family development."
          : "Multi-family may be possible but formal review is required.",
        logic: [
          `Zoning code "${zCode}" → classified as "${zoningClass}".`,
          zoningClass === "mr_hr"
            ? "Seattle MR (Mid-Rise) and HR (High-Rise) zones explicitly allow multi-family residential buildings."
            : zoningClass === "lr"
            ? "Seattle LR2/LR3 zones allow multi-unit residential. LR1 is limited to smaller buildings."
            : zoningClass === "commercial"
            ? "Commercial/mixed-use zones typically allow residential uses above ground floor."
            : "The zoning code contains patterns associated with higher-density residential, but we couldn't confirm the exact limits.",
          `Lot size ${lot.toLocaleString()} sqft ${lot >= 12000 ? "is workable" : "is on the smaller side"} for a multi-family project.`,
        ],
        assumptions: [
          "Zoning allows the number of units in the analysis (we haven't verified the FAR cap for this specific subzone).",
          "The lot has adequate setbacks, parking access, and utility capacity for the proposed density.",
        ],
        gaps: [
          "Unit count maximums, height limits, and FAR in your specific subzone need to be confirmed.",
          "WA SEPA environmental review may be triggered for larger projects (typically 20+ units).",
          "Parking minimums vary — some Seattle zones have eliminated them, others haven't.",
        ],
        links,
      };
    }

    default:
      return {
        verdict: feasibility,
        summary: "No specific zoning analysis available for this strategy.",
        logic: [],
        assumptions: [],
        gaps: [],
        links,
      };
  }
}

// Zoning feasibility check.
// split_build is now properly conservative: must clear 2× district min PLUS a
// 10% margin (real-world setbacks, frontage, and access easements eat lot).
export function checkFeasibility(
  property: PropertyData,
  strategy: Strategy
): "permitted" | "conditional" | "not_allowed" {
  const lotSize = property.lotSizeSqft;

  switch (strategy) {
    case "fresh_build":
      return "permitted";
    case "split_build": {
      const districtMin = estimateDistrictMinLotSqft(property.zoningCode);
      // Without a known district min, we can't responsibly call this permitted.
      if (!districtMin) {
        // Conservative: only "conditional" when lot is large enough that a split
        // is plausible under most WA zoning (15,000+ sqft typical floor).
        if (lotSize >= 15000) return "conditional";
        return "not_allowed";
      }
      const requiredWithMargin = districtMin * 2 * 1.10; // 10% buffer for setbacks/access
      const requiredBare = districtMin * 2;
      if (lotSize >= requiredWithMargin) return "permitted";
      if (lotSize >= requiredBare) return "conditional";
      return "not_allowed";
    }
    case "main_adu":
      // HB 1337 (2023): WA cities must allow 2 ADUs per residential lot in UGAs.
      if (lotSize >= 5000) return "permitted";
      if (lotSize >= 4000) return "conditional";
      return "not_allowed";
    case "flip_fix":
      return "permitted";
    case "townhome": {
      // Townhomes require R-2, RM, or similar attached-housing zoning.
      // Without a full zoning KB, we approximate: lots ≥6000 sqft in urban zones = conditional.
      const upper = (property.zoningCode ?? "").toUpperCase();
      const permittedPatterns = /R-?[2-9]|RM|TH|MF|MU|C[12]/;
      if (permittedPatterns.test(upper)) return "permitted";
      if (lotSize >= 8000) return "conditional";
      return "not_allowed";
    }
    case "multifamily": {
      // Multi-family requires higher-density zoning (R-3+, RM, MF, MU).
      const upper = (property.zoningCode ?? "").toUpperCase();
      const permittedPatterns = /R-?[3-9]|RM|MF|MU|C[12]/;
      if (permittedPatterns.test(upper)) return "permitted";
      if (lotSize >= 12000) return "conditional";
      return "not_allowed";
    }
    default:
      return "not_allowed";
  }
}

// Calculate maximum buildable sqft based on lot and FAR
function getMaxBuildableSqft(property: PropertyData, strategy: Strategy): number {
  const lotSize = property.lotSizeSqft;
  const far = 0.5; // Default FAR for residential zones
  const maxCoverage = 0.35;
  const maxFootprint = lotSize * maxCoverage;

  switch (strategy) {
    case "fresh_build":
      return Math.min(lotSize * far, maxFootprint * 2.5); // up to 2.5 stories
    case "split_build": {
      const lotsCount = lotSize >= 12000 ? 2 : 1;
      const perLotSize = lotSize / lotsCount;
      return perLotSize * far * lotsCount;
    }
    case "main_adu": {
      const mainSqft = Math.min(lotSize * far * 0.7, 3500);
      const aduSqft = Math.min(1000, lotSize * 0.1);
      const aduCount = lotSize >= 8000 ? 2 : 1;
      return mainSqft + aduSqft * aduCount;
    }
    case "flip_fix":
      return property.currentSqft + Math.min(500, lotSize * 0.05);
    default:
      return 0;
  }
}

// Estimate permit timeline by strategy
function getPermitMonths(strategy: Strategy): number {
  switch (strategy) {
    case "fresh_build":
      return 6;
    case "split_build":
      return 10; // Short plat adds time
    case "main_adu":
      return 5;
    case "flip_fix":
      return 2;
    default:
      return 0;
  }
}

// Estimate build time
function getBuildMonths(strategy: Strategy, tier: QualityTier, sqft: number): number {
  const baseMonths = Math.ceil(sqft / 400); // ~400 sqft per month base
  const multiplier = QUALITY_TIERS[tier].timeMultiplier;
  const strategyMultiplier = strategy === "split_build" ? 1.3 : 1.0;
  return Math.ceil(baseMonths * multiplier * strategyMultiplier);
}

// Estimate days on market → months
function getSellMonths(tier: QualityTier, price: number): number {
  if (price > 2000000) return 4;
  if (price > 1000000) return 3;
  if (tier === "standard") return 2;
  return 2.5;
}

// Monthly mortgage payment (P&I)
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number,
  interestOnly: boolean = false
): number {
  if (principal <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (interestOnly) {
    return principal * monthlyRate;
  }
  const numPayments = termYears * 12;
  if (monthlyRate === 0) return principal / numPayments;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1)
  );
}

// ─── Sale $/sqft model ──────────────────────────────────────────────────────
//
// We now compute strategy-specific $/sqft from a strategy-specific comp pool:
//
//   fresh_build / split_build:
//     - Comp pool = NEW CONSTRUCTION only (built ≤5 yr before sale).
//     - Apply tier multiplier (new construction has its own price tier).
//
//   main_adu:
//     - Comp pool = SFR-with-ADU comps preferred; fall back to recent SFRs.
//     - Apply tier multiplier (but ADU portion sells at ~85%).
//
//   flip_fix:
//     - Comp pool = ALL existing-home resale (the renovated unit will be
//       priced against existing homes, not new builds).
//     - Apply small renovation premium (1.05–1.20×) — NOT the new-construction
//       multiplier. Buyers won't pay new-construction prices for a flip.
//
// Calibrated against WA 2026 data:
//   - Seattle median resale ~$545–572/sqft
//   - New construction WA average ~$425–500/sqft cost, sells at $500–800/sqft
//   - Bellevue/Eastside custom new $850–1000/sqft
//   - Medina/Mercer Island ultra new $1100–1500+/sqft
//
// Sources: Redfin Seattle market report (Apr 2026), Emerald City Construction
// (2026 Seattle/Eastside custom-home guide), HomeGuide (WA 2026 build-cost data).

export const TIER_NEW_CONSTRUCTION_MULTIPLIER: Record<QualityTier, number> = {
  standard: 1.00,
  premium: 1.20,
  luxury: 1.55,
  ultra_luxury: 2.00,
};

// Renovation premium — what a renovated existing home sells for vs. the
// median existing-home comp $/sqft in the area. Much smaller than new-construction
// premiums because the buyer pool is the same (resale buyers, not new-build buyers).
const TIER_FLIP_PREMIUM: Record<QualityTier, number> = {
  standard: 1.05,
  premium: 1.10,
  luxury: 1.20,
  ultra_luxury: 1.30,
};

// WA-wide fallback sale $/sqft for NEW CONSTRUCTION when no comps are available.
export const DEFAULT_SELL_PRICE_PER_SQFT: Record<QualityTier, number> = {
  standard: 425,
  premium: 600,
  luxury: 850,
  ultra_luxury: 1300,
};

// WA-wide fallback for FLIP RESALE (existing-home renovated). Lower than new build.
const DEFAULT_FLIP_PRICE_PER_SQFT: Record<QualityTier, number> = {
  standard: 400,
  premium: 520,
  luxury: 680,
  ultra_luxury: 950,
};

// ─── ZIP-level new-construction $/sqft overrides ─────────────────────────────
// When the comp pipeline is unavailable (APIllow down, no sqft data),
// we still want SOMETHING smarter than a flat national average for known
// markets. These represent typical NEW-CONSTRUCTION sale prices (premium tier
// baseline) by ZIP. Tier multiplier is applied on top for luxury/ultra.
//
// Numbers from 2025–2026 Redfin / Zillow per-sqft data for new builds.
// Conservative midpoints — actual luxury builds can exceed by 30–50%.
// Better than nothing, worse than real comps.
const ZIP_NEW_CONSTRUCTION_PPSF: Record<string, number> = {
  // ── Washington State ─────────────────────────────────────────────────────
  // Bellevue / Eastside premium
  "98004": 1100, // Bridle Trails / Yarrow Bay
  "98005": 700,  // Crossroads / Lake Hills
  "98006": 700,  // Newport / Factoria
  "98007": 650,
  "98008": 650,  // Lake Hills / Crossroads
  "98039": 1500, // Medina / Clyde Hill / Hunts Point
  "98040": 1000, // Mercer Island
  "98033": 850,  // Kirkland
  "98034": 700,  // Kirkland east
  "98052": 700,  // Redmond
  "98053": 750,  // Redmond east
  "98074": 700,  // Sammamish
  "98075": 700,  // Sammamish east
  "98027": 650,  // Issaquah
  "98029": 700,  // Issaquah Highlands
  // Seattle
  "98109": 850,  // Queen Anne / South Lake Union
  "98112": 950,  // Madison Park / Madrona
  "98119": 850,  // Queen Anne North
  "98199": 850,  // Magnolia
  "98115": 700,  // View Ridge / Wedgwood
  "98117": 700,  // Ballard / Loyal Heights
  "98103": 700,  // Greenwood / Fremont / Wallingford
  "98105": 800,  // Laurelhurst / U-District
  "98144": 700,  // Mt Baker / Beacon Hill
  "98107": 650,  // Ballard
  "98108": 600,
  "98116": 700,  // West Seattle premium
  "98136": 650,  // West Seattle
  "98122": 700,  // Capitol Hill / Central District
  "98102": 800,  // Eastlake / Capitol Hill
  "98106": 550,
  "98118": 600,
  "98125": 600,
  "98126": 600,
  "98133": 550,
  // Tacoma
  "98402": 400,  // Downtown Tacoma
  "98403": 500,  // Stadium / Old Town
  "98405": 400,
  "98406": 500,  // West End
  "98407": 600,  // North Tacoma
  "98422": 500,  // NE Tacoma
  // Spokane
  "99203": 350,  // South Hill premium
  "99201": 350,  // Downtown Spokane
  // ── California — Bay Area ─────────────────────────────────────────────────
  "94010": 1200, // Burlingame
  "94025": 1300, // Menlo Park
  "94027": 1800, // Atherton
  "94028": 1100, // Portola Valley
  "94062": 1100, // Redwood City
  "94301": 1400, // Palo Alto
  "94303": 1200, // Palo Alto east
  "94305": 1300, // Stanford
  "94401": 1200, // San Mateo
  "94402": 1100, // San Mateo west
  "94501": 800,  // Alameda
  "94502": 800,  // Alameda east
  "94506": 850,  // Danville
  "94507": 900,  // Alamo
  "94526": 850,  // Danville
  "94556": 750,  // Moraga
  "94563": 900,  // Orinda
  "94577": 600,  // San Leandro
  "94601": 550,  // Oakland Fruitvale
  "94602": 700,  // Oakland Glenview
  "94609": 650,  // Oakland Piedmont Ave
  "94611": 850,  // Piedmont / Rockridge
  "94618": 900,  // Rockridge
  "94705": 950,  // Berkeley Elmwood
  "94707": 900,  // Berkeley north hills
  "94708": 850,  // Berkeley hills
  "94920": 1100, // Belvedere / Tiburon
  "94941": 900,  // Mill Valley
  "94945": 750,  // Novato
  "94965": 1000, // Sausalito
  "95008": 700,  // Campbell
  "95014": 850,  // Cupertino
  "95030": 850,  // Los Gatos
  "95032": 800,  // Los Gatos east
  "95120": 900,  // San Jose Almaden
  "95125": 800,  // San Jose Willow Glen
  "95126": 750,  // San Jose Rose Garden
  "95129": 850,  // San Jose west
  // ── California — Los Angeles ──────────────────────────────────────────────
  "90024": 1200, // Westwood / Brentwood
  "90025": 1100, // West LA / Sawtelle
  "90027": 800,  // Los Feliz
  "90036": 900,  // Fairfax / Mid-City
  "90041": 750,  // Eagle Rock
  "90049": 1300, // Brentwood
  "90062": 550,  // South LA
  "90064": 900,  // Rancho Park
  "90066": 850,  // Mar Vista
  "90077": 1500, // Bel Air
  "90094": 900,  // Playa Vista
  "90210": 2000, // Beverly Hills
  "90211": 1500, // Beverly Hills adj.
  "90212": 1400, // Beverly Hills adj.
  "90254": 1200, // Hermosa Beach
  "90265": 1500, // Malibu
  "90272": 1500, // Pacific Palisades
  "90291": 1100, // Venice
  "90292": 1000, // Marina del Rey
  "90401": 1000, // Santa Monica
  "90403": 1100, // Santa Monica north
  "90405": 900,  // Santa Monica east
  "91011": 900,  // La Cañada
  "91105": 950,  // Pasadena south
  "91106": 850,  // Pasadena east
  "91302": 700,  // Calabasas
  "91361": 750,  // Westlake Village
  "91436": 1100, // Encino south
  // ── New York ─────────────────────────────────────────────────────────────
  "10001": 1300, // Chelsea / Hudson Yards
  "10003": 1200, // East Village / Greenwich Village
  "10007": 1400, // Tribeca / Financial
  "10011": 1200, // Chelsea / West Village
  "10013": 1400, // Soho / Tribeca
  "10014": 1300, // West Village
  "10019": 1400, // Midtown West
  "10022": 1500, // Midtown East
  "10023": 1300, // Upper West Side
  "10024": 1200, // Upper West Side
  "10025": 1100, // Morningside Heights / UWS
  "10028": 1200, // Upper East Side
  "10065": 1400, // Upper East Side
  "10075": 1300, // Upper East Side
  "10280": 1200, // Battery Park City
  "11201": 1100, // Brooklyn Heights / DUMBO
  "11215": 950,  // Park Slope
  "11217": 900,  // Boerum Hill / Gowanus
  "11231": 950,  // Carroll Gardens / Red Hook
  "11238": 900,  // Prospect Heights
  // ── Massachusetts — Boston ────────────────────────────────────────────────
  "02108": 1100, // Beacon Hill
  "02109": 1000, // North End / Waterfront
  "02110": 1000, // Financial District
  "02111": 900,  // Chinatown / Leather District
  "02116": 1100, // Back Bay
  "02118": 800,  // South End
  "02119": 600,  // Roxbury
  "02127": 800,  // South Boston
  "02129": 750,  // Charlestown
  "02130": 700,  // Jamaica Plain
  "02132": 650,  // West Roxbury
  "02134": 600,  // Allston
  "02135": 600,  // Brighton
  "02138": 900,  // Cambridge Harvard Sq
  "02139": 850,  // Cambridge Cambridgeport
  "02140": 800,  // Cambridge north
  "02141": 700,  // Cambridge east
  "02142": 750,  // Cambridge MIT
  "02143": 700,  // Somerville Inman Sq
  "02144": 650,  // Somerville Teele Sq
  "02145": 600,  // Somerville east
  // ── Illinois — Chicago ────────────────────────────────────────────────────
  "60601": 650,  // Millennium Park / Loop
  "60602": 650,  // Loop
  "60610": 700,  // Gold Coast / River North
  "60611": 750,  // Streeterville / Magnificent Mile
  "60614": 750,  // Lincoln Park
  "60615": 500,  // Hyde Park / Woodlawn
  "60618": 600,  // Roscoe Village / Avondale
  "60625": 550,  // Ravenswood / Albany Park
  "60626": 500,  // Rogers Park
  "60640": 550,  // Uptown
  "60647": 600,  // Logan Square
  "60657": 700,  // Lakeview / Wrigleyville
  // ── Texas — Dallas / Fort Worth ───────────────────────────────────────────
  "75205": 700,  // Highland Park / UP
  "75206": 600,  // M Streets / Lower Greenville
  "75209": 650,  // Bluffview / Devonshire
  "75219": 600,  // Oak Lawn
  "75225": 700,  // Preston Hollow south
  "75229": 650,  // North Dallas / Preston Hollow
  "75230": 650,  // Preston Hollow / Royal Lane
  "75240": 550,  // North Dallas Galleria
  // Texas — Houston
  "77005": 650,  // West University
  "77006": 600,  // Montrose
  "77007": 600,  // The Heights
  "77019": 700,  // River Oaks
  "77024": 700,  // Memorial
  "77025": 550,  // Braeswood / NRG area
  "77027": 700,  // River Oaks east
  "77098": 650,  // Upper Kirby / Greenway Plaza
  // ── Arizona — Phoenix Metro ───────────────────────────────────────────────
  "85018": 700,  // Arcadia / Biltmore
  "85028": 600,  // Paradise Valley adj.
  "85044": 500,  // Ahwatukee
  "85048": 500,  // Ahwatukee south
  "85050": 600,  // Desert Ridge
  "85054": 650,  // DC Ranch adj.
  "85250": 700,  // Scottsdale south
  "85251": 650,  // Scottsdale central
  "85254": 700,  // Scottsdale north
  "85255": 750,  // North Scottsdale
  "85259": 700,  // North Scottsdale east
  "85266": 800,  // Pinnacle Peak
  // ── Colorado — Denver Metro ───────────────────────────────────────────────
  "80203": 550,  // Capitol Hill
  "80205": 500,  // City Park / Whittier
  "80206": 600,  // Congress Park / Cherry Creek
  "80209": 650,  // Wash Park / Glendale
  "80210": 650,  // Platt Park / Observatory Park
  "80218": 600,  // Cheesman Park / Morey Middle
  "80220": 550,  // Montclair / Mayfair
  "80221": 450,  // Regis / Globeville
  "80246": 600,  // Hilltop / Crestmoor
  "80302": 650,  // Boulder central
  "80304": 700,  // Boulder north
  "80305": 600,  // Boulder south
  // ── Georgia — Atlanta Metro ───────────────────────────────────────────────
  "30305": 700,  // Buckhead
  "30306": 600,  // Virginia-Highland
  "30307": 550,  // Candler Park / Kirkwood
  "30308": 500,  // Midtown
  "30309": 550,  // Ansley Park / Midtown north
  "30318": 500,  // West Midtown / Blandtown
  "30327": 700,  // Sandy Springs / Buckhead west
  "30342": 650,  // Sandy Springs / North Buckhead
  // ── Oregon — Portland Metro ───────────────────────────────────────────────
  "97201": 600,  // Downtown / SW Hills
  "97202": 600,  // Sellwood / Brooklyn
  "97205": 600,  // Goose Hollow / NW Hills
  "97209": 650,  // Pearl District
  "97210": 600,  // Nob Hill / Northwest District
  "97212": 600,  // Irvington / Alameda
  "97213": 550,  // Hollywood / Laurelhurst
  "97214": 600,  // Hawthorne / Sunnyside
  "97215": 550,  // Mt Tabor
  "97221": 650,  // West Hills / SW
  // ── Texas — Austin Metro ──────────────────────────────────────────────────
  "78701": 700,  // Downtown Austin
  "78703": 750,  // Tarrytown / Clarksville
  "78704": 700,  // Travis Heights / South Austin
  "78705": 650,  // Hyde Park / UT area
  "78731": 700,  // Northwest Hills
  "78733": 750,  // Barton Creek / Westlake adj.
  "78746": 800,  // Westlake Hills / Rob Roy
  "78750": 600,  // Northwest Austin
  // ── DC Metro ─────────────────────────────────────────────────────────────
  "20001": 700,  // DC Shaw / U Street
  "20002": 650,  // DC Capitol Hill east
  "20003": 700,  // DC Capitol Hill / Navy Yard
  "20007": 800,  // Georgetown
  "20008": 750,  // Woodley Park / Cathedral Heights
  "20009": 700,  // Adams Morgan / Columbia Heights
  "20010": 650,  // Columbia Heights north
  "20016": 800,  // Spring Valley / American U
  "20015": 750,  // Chevy Chase DC
  "20817": 750,  // Bethesda / Chevy Chase MD
  "20814": 700,  // Bethesda
  "20815": 750,  // Chevy Chase MD
  "22101": 700,  // McLean VA
  "22102": 750,  // Tysons / McLean
  "22201": 650,  // Arlington Clarendon
  "22202": 600,  // Arlington Crystal City
  "22207": 700,  // Arlington north
  // ── Tennessee — Nashville ─────────────────────────────────────────────────
  "37203": 550,  // The Gulch / Midtown
  "37205": 600,  // Belle Meade
  "37206": 500,  // East Nashville
  "37209": 500,  // Sylvan Park / Charlotte
  "37212": 550,  // Belmont / Green Hills adj.
  "37215": 600,  // Green Hills
  "37220": 600,  // Oak Hill
  // ── North Carolina — Charlotte ────────────────────────────────────────────
  "28202": 500,  // Uptown Charlotte
  "28203": 550,  // Dilworth / South End
  "28204": 500,  // Elizabeth / Myers Park adj.
  "28205": 450,  // Plaza Midwood / NoDa
  "28207": 600,  // Myers Park
  "28209": 550,  // Sedgefield / Dilworth
  "28210": 500,  // South Charlotte / Ballantyne north
  // ── Florida — Miami Metro ─────────────────────────────────────────────────
  "33101": 600,  // Miami NW
  "33129": 900,  // Coconut Grove adj.
  "33131": 1000, // Brickell
  "33132": 950,  // Edgewater / Wynwood
  "33133": 900,  // Coconut Grove
  "33134": 800,  // Coral Gables
  "33137": 850,  // Upper Eastside / Design District
  "33139": 1100, // South Beach
  "33140": 1200, // Mid-Beach
  "33141": 1000, // Surfside
  "33154": 1100, // Bal Harbour
  "33156": 800,  // South Miami / Pinecrest
  "33158": 850,  // Old Cutler / Palmetto Bay
  "33480": 1500, // Palm Beach
};

export function getZipNewConstructionPpsf(
  zip: string | undefined | null
): number | null {
  if (!zip) return null;
  const cleaned = zip.toString().trim().slice(0, 5);
  return ZIP_NEW_CONSTRUCTION_PPSF[cleaned] ?? null;
}

export interface DefaultSellPricePerSqft {
  value: number;
  source:
    | "neighborhood_new"
    | "neighborhood_resale"
    | "neighborhood_all"
    | "zip_premium"
    | "flat_fallback";
  neighborhoodMedianPpsf?: number;
  compCount?: number;
  multiplier: number;
  strategy: Strategy;
  zip?: string;
}

/**
 * Strategy-aware default sell $/sqft.
 *
 * Pulls a filtered slice of nearby cited comps, takes the median $/sqft,
 * and applies the strategy-appropriate multiplier. Falls back to all
 * comps (with adjusted multiplier) if the strategy filter yields too few,
 * then to WA-wide defaults if no comps are usable.
 */
export function getDefaultSellPricePerSqft(
  property: PropertyData,
  tier: QualityTier,
  strategy: Strategy
): DefaultSellPricePerSqft {
  const nb = property.neighborhood;

  // Helper: pull median $/sqft from a comp subset.
  const medianPpsf = (
    comps: Array<{ pricePerSqft?: number }> | undefined
  ): { median: number; count: number } | null => {
    if (!comps || comps.length === 0) return null;
    const valid = comps
      .map((c) => c.pricePerSqft)
      .filter((v): v is number => typeof v === "number" && v > 0 && v < 5000);
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], count: valid.length };
  };

  // Lazy helper: build the fallback (ZIP-aware, then WA-wide flat) for any branch.
  const fallback = (): DefaultSellPricePerSqft => {
    const zipPremiumBase = getZipNewConstructionPpsf(property.zip);
    if (zipPremiumBase !== null) {
      // ZIP table is calibrated to "premium tier new construction" baseline.
      // Scale to the user's tier using a relative multiplier vs premium.
      const tierMult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
      const premiumMult = TIER_NEW_CONSTRUCTION_MULTIPLIER.premium;
      const relativeTierMult = tierMult / premiumMult;
      // For flip_fix, apply renovation discount (~80% of new-build sale price).
      const flipDiscount = strategy === "flip_fix" ? 0.80 : 1.0;
      return {
        value: Math.round(zipPremiumBase * relativeTierMult * flipDiscount),
        source: "zip_premium",
        multiplier: relativeTierMult * flipDiscount,
        strategy,
        zip: property.zip,
      };
    }
    const flat =
      strategy === "flip_fix"
        ? DEFAULT_FLIP_PRICE_PER_SQFT[tier]
        : DEFAULT_SELL_PRICE_PER_SQFT[tier];
    return {
      value: flat,
      source: "flat_fallback",
      multiplier:
        strategy === "flip_fix"
          ? TIER_FLIP_PREMIUM[tier]
          : TIER_NEW_CONSTRUCTION_MULTIPLIER[tier],
      strategy,
    };
  };

  if (!nb || nb.sales.length === 0) {
    return fallback();
  }

  // For new-build strategies:
  //  Tier 1) Have ≥3 NEW-construction comps → use their median DIRECTLY.
  //           (No tier multiplier — those comps ARE new-construction prices.)
  //  Tier 2) <3 new comps → use all-comp median × tier multiplier
  //           (multiplier here estimates the new-construction premium over resale).
  //  Tier 3) <3 valid comps anywhere → WA flat fallback.
  if (strategy === "fresh_build" || strategy === "split_build") {
    const newComps = nb.sales.filter((s) => s.isNewConstructionAtSale === true);
    const fromNew = medianPpsf(newComps);
    if (fromNew && fromNew.count >= 3) {
      return {
        value: fromNew.median, // direct — these ARE new-construction sale prices
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromNew.median,
        compCount: fromNew.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const mult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // main_adu: prefer SFR+ADU comps, fall back to recent SFRs (new), then all.
  // When we have new-construction comps, use them directly (no multiplier).
  if (strategy === "main_adu") {
    const aduComps = nb.sales.filter((s) => s.typology === "sfr_with_adu");
    const fromAdu = medianPpsf(aduComps);
    if (fromAdu && fromAdu.count >= 3) {
      return {
        value: fromAdu.median,
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromAdu.median,
        compCount: fromAdu.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const recentSfr = nb.sales.filter(
      (s) => s.typology === "sfr" && (s.isNewConstructionAtSale || (s.yearBuilt ?? 0) >= 2015)
    );
    const fromRecentSfr = medianPpsf(recentSfr);
    if (fromRecentSfr && fromRecentSfr.count >= 3) {
      return {
        value: fromRecentSfr.median, // recent SFR ≈ new construction valuation
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromRecentSfr.median,
        compCount: fromRecentSfr.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const mult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // flip_fix: comp pool = ALL existing-home resale (SFRs, both new and old).
  // Apply RENOVATION premium, not new-construction premium.
  if (strategy === "flip_fix") {
    const mult = TIER_FLIP_PREMIUM[tier];
    // Prefer non-new comps since flips compete with the existing-home market.
    const resaleComps = nb.sales.filter(
      (s) =>
        (s.typology === "sfr" || s.typology === "sfr_with_adu") &&
        !s.isNewConstructionAtSale
    );
    const fromResale = medianPpsf(resaleComps);
    if (fromResale && fromResale.count >= 3) {
      return {
        value: Math.round(fromResale.median * mult),
        source: "neighborhood_resale",
        neighborhoodMedianPpsf: fromResale.median,
        compCount: fromResale.count,
        multiplier: mult,
        strategy,
      };
    }
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // Default (pass etc): fall back to standard new construction default.
  return fallback();
}

// ─── Strategy-specific construction cost ────────────────────────────────────
//
// Fix-n-upper renovation is fundamentally cheaper per sqft than new construction
// — we're touching finishes/systems, not pouring foundation. WA renovation
// typically runs $100–250/sqft depending on quality, vs new construction
// $220–650/sqft.
//
// Formula: max($100 floor, tier_new_cost × 0.40). Premium/luxury reno scales
// with tier (better finishes cost more), but always at ~40% of new-construction
// cost for the same tier.

const FLIP_COST_FLOOR_PER_SQFT = 100;
const FLIP_COST_RATIO = 0.40;

export function getEffectiveCostPerSqft(strategy: Strategy, tierCostPerSqft: number): number {
  if (strategy === "flip_fix") {
    return Math.max(FLIP_COST_FLOOR_PER_SQFT, Math.round(tierCostPerSqft * FLIP_COST_RATIO));
  }
  return tierCostPerSqft;
}

// Estimate sale price using the strategy-aware $/sqft helper.
function estimateSalePrice(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  buildSqft: number
): number {
  const pricePerSqft = getDefaultSellPricePerSqft(property, tier, strategy).value;

  switch (strategy) {
    case "fresh_build":
      return buildSqft * pricePerSqft;
    case "split_build": {
      // Splits sell as N similarly-sized new homes at the new-construction $/sqft.
      return buildSqft * pricePerSqft;
    }
    case "main_adu": {
      // Main house gets full $/sqft; ADU portion sells/values at ~85% of main.
      const mainValue = buildSqft * 0.75 * pricePerSqft;
      const aduValue = buildSqft * 0.25 * pricePerSqft * 0.85;
      return mainValue + aduValue;
    }
    case "flip_fix": {
      // pricePerSqft here is already the renovated-resale price (not new-construction).
      // No additional discount needed — the strategy-aware helper handled it.
      return buildSqft * pricePerSqft;
    }
    default:
      return 0;
  }
}

// Get the default buildable sqft for a strategy (exported for UI hints)
export function getDefaultBuildSqft(property: PropertyData, strategy: Strategy): number {
  return Math.round(getMaxBuildableSqft(property, strategy));
}

// Per-strategy overrides
export interface StrategyOverrides {
  buildSqft?: number;
  sellPricePerSqft?: number;
}

// Main analysis calculation
export function calculateAnalysis(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  overrides?: StrategyOverrides
): AnalysisResult {
  const feasibility = checkFeasibility(property, strategy);
  const maxByZoning = getMaxBuildableSqft(property, strategy);

  // Neighborhood guardrails: applied when we have neighborhood data.
  // Falls back to no-op when data is absent (e.g., outside KC for now).
  let guardrails: NeighborhoodGuardrails | null = null;
  let safeMaxSqft = maxByZoning;
  if (property.neighborhood) {
    guardrails = computeNeighborhoodGuardrails({
      strategy,
      neighborhood: property.neighborhood,
      maxBuildableByZoning: maxByZoning,
    });
    if (guardrails.size.medianSqft) {
      safeMaxSqft = guardrails.size.safeMaxSqft;
    }
  }

  const buildSqft = overrides?.buildSqft ?? safeMaxSqft;
  // Strategy-aware construction cost: flip_fix uses renovation rate, not new-build cost.
  const effectiveCostPerSqft = getEffectiveCostPerSqft(strategy, costPerSqft);
  const permitMonths = getPermitMonths(strategy);
  const buildMonths = getBuildMonths(strategy, tier, buildSqft);
  const expectedSalePrice = overrides?.sellPricePerSqft
    ? buildSqft * overrides.sellPricePerSqft
    : estimateSalePrice(property, strategy, tier, buildSqft);
  const sellMonths = Math.ceil(getSellMonths(tier, expectedSalePrice));
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // Acquisition costs
  const purchasePrice = property.listingPrice;
  const closingCosts = purchasePrice * 0.025; // 2.5%
  const downPayment = purchasePrice * (financing.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const acquisitionCost = purchasePrice + closingCosts;

  // Construction costs — use effective cost per sqft (renovation rate for flip_fix).
  const demolitionCost = strategy !== "flip_fix" ? 20000 : 0;
  const architectFees = strategy !== "flip_fix" ? buildSqft * effectiveCostPerSqft * 0.05 : 0;
  const permitFees = strategy === "split_build" ? 35000 : strategy === "flip_fix" ? 5000 : 20000;
  const contingency = buildSqft * effectiveCostPerSqft * 0.12;
  const landscaping = strategy !== "flip_fix" ? 25000 : 5000;
  const constructionCost =
    buildSqft * effectiveCostPerSqft +
    demolitionCost +
    architectFees +
    permitFees +
    contingency +
    landscaping;

  // Monthly holding costs
  const monthlyMortgage = calculateMonthlyPayment(
    loanAmount,
    financing.interestRate,
    financing.loanTermYears,
    financing.type === "interest_only"
  );
  const monthlyTax = property.annualPropertyTax / 12;
  const monthlyInsurance = (purchasePrice * 0.004) / 12; // ~0.4% annually
  const monthlyHoa = property.hoaMonthly || 0;
  const monthlyUtilities = 300;
  const holdingCostMonthly =
    monthlyMortgage + monthlyTax + monthlyInsurance + monthlyHoa + monthlyUtilities;
  const totalHoldingCost = holdingCostMonthly * timelineMonths;

  // Selling costs
  const agentCommission = expectedSalePrice * 0.05;
  const exciseTax = expectedSalePrice * 0.018; // WA excise tax ~1.8%
  const sellerConcessions = expectedSalePrice * 0.01;
  const stagingCosts = strategy !== "flip_fix" ? 5000 : 3000;
  const sellingCosts = agentCommission + exciseTax + sellerConcessions + stagingCosts;

  // Totals
  const totalProjectCost = acquisitionCost + constructionCost + totalHoldingCost + sellingCosts;
  const profit = expectedSalePrice - totalProjectCost;
  const totalCashInvested = downPayment + constructionCost + totalHoldingCost + closingCosts;
  const roi = totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0;
  const annualizedRoi = timelineMonths > 0 ? roi * (12 / timelineMonths) : 0;

  // Generate recommendation text
  let recommendation = "";
  if (feasibility === "not_allowed") {
    recommendation = `Not feasible: ${STRATEGIES[strategy].label} is not permitted under current zoning (${property.zoningCode}).`;
  } else if (profit > 0 && roi > 15) {
    recommendation = `Strong opportunity. ${STRATEGIES[strategy].label} projects ${formatCurrency(profit)} profit (${roi.toFixed(1)}% ROI) over ${timelineMonths} months.`;
  } else if (profit > 0) {
    recommendation = `Marginal deal. ${formatCurrency(profit)} profit but ${roi.toFixed(1)}% ROI may not justify the risk and effort over ${timelineMonths} months.`;
  } else {
    recommendation = `Not viable. Projects a ${formatCurrency(Math.abs(profit))} loss. Consider a different strategy or pass on this property.`;
  }

  // Confidence scoring (architect-mode §6). Only meaningful when we have guardrails.
  let confidenceScore: number | undefined;
  let confidenceLabel: AnalysisResult["confidenceLabel"];
  // Caveats start from guardrails and get strategy-specific additions appended.
  const extraCaveats: typeof guardrails extends { caveats: infer C } ? C : never[] =
    [] as unknown as never[];
  type CaveatLite = { severity: "info" | "warning" | "block"; text: string };
  const localCaveats: CaveatLite[] = [];

  // ── Split-and-build verification caveat ────────────────────────────────
  // Without a full zoning KB (Wave 1), we cannot verify the city's specific
  // short-plat rules: max lots, geometry, frontage, access easements, critical
  // areas, deed restrictions. The lot-size math is necessary but NOT sufficient.
  if (strategy === "split_build" && feasibility !== "not_allowed") {
    const districtMin = estimateDistrictMinLotSqft(property.zoningCode);
    if (!districtMin) {
      localCaveats.push({
        severity: "warning",
        text:
          `Zoning code "${property.zoningCode}" not recognized — district minimum lot size cannot be inferred. ` +
          `Split feasibility is speculative; confirm with city planning department before offering.`,
      });
    } else {
      const required = districtMin * 2;
      const margin = ((property.lotSizeSqft - required) / required) * 100;
      localCaveats.push({
        severity: feasibility === "conditional" ? "warning" : "info",
        text:
          `Subdivision math: lot ${property.lotSizeSqft.toLocaleString()} sqft vs. required ${required.toLocaleString()} sqft ` +
          `(2× estimated district min of ${districtMin.toLocaleString()} sqft) — ${margin > 0 ? "+" : ""}${margin.toFixed(0)}% margin. ` +
          `Lot-size math alone doesn't guarantee a short plat will be approved — confirm setback, frontage, access, ` +
          `and critical-area rules with the city.`,
      });
    }
    // Always add the "needs KB verification" caveat for split until the full
    // zoning KB is wired up. This is the dominant uncertainty driver.
    localCaveats.push({
      severity: "block",
      text:
        `Split confidence is conservatively capped at 65 until LandMath's per-city ` +
        `zoning rulebook is wired (Wave 1). Few WA lots actually qualify for a short plat ` +
        `even when the lot size math works — verify with a planner before committing capital.`,
    });
  }

  if (guardrails && property.neighborhood) {
    const nb = property.neighborhood;
    const recentCutoff = Date.now() - 12 * 30 * 24 * 60 * 60 * 1000;
    const compsAreRecent = nb.sales.some((s) => {
      const t = Date.parse(s.saleDate);
      return !isNaN(t) && t >= recentCutoff;
    });
    const confidence = computeConfidence({
      zoningKnown: Boolean(property.zoningCode && property.zoningCode !== "Unknown"),
      zoningRecentlyVerified: false, // flip to true once KB lookup is wired
      lotSizeFromGis: property.lotSizeSqft > 0,
      compsCount: nb.sales.length,
      compsAreRecent,
      guardrails,
    });
    confidenceScore = confidence.score;
    confidenceLabel = confidence.label;

    // Hard cap on split_build confidence until the zoning KB is wired.
    // Even a lot that clears the 2× math should not project "High" confidence
    // — short plats are gated on city-specific rules we don't yet ingest.
    if (strategy === "split_build" && confidenceScore !== undefined) {
      confidenceScore = Math.min(65, confidenceScore);
      confidenceLabel =
        confidenceScore >= 65
          ? "Moderate"
          : confidenceScore >= 40
          ? "Low"
          : "Speculative";
    }
  }
  void extraCaveats; // reserved for future merges from guardrails

  return {
    id: `${property.id}-${strategy}-${Date.now()}`,
    propertyId: property.id,
    property,
    strategy,
    qualityTier: tier,
    costPerSqft,
    buildSqft: Math.round(buildSqft),
    financing,
    acquisitionCost: Math.round(acquisitionCost),
    constructionCost: Math.round(constructionCost),
    holdingCostMonthly: Math.round(holdingCostMonthly),
    totalHoldingCost: Math.round(totalHoldingCost),
    sellingCosts: Math.round(sellingCosts),
    totalProjectCost: Math.round(totalProjectCost),
    expectedSalePrice: Math.round(expectedSalePrice),
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    annualizedRoi: Math.round(annualizedRoi * 10) / 10,
    timelineMonths,
    permitMonths,
    buildMonths,
    sellMonths,
    feasibility,
    recommendation,
    createdAt: new Date().toISOString(),
    confidence: confidenceScore,
    confidenceLabel,
    caveats: [...localCaveats, ...(guardrails?.caveats ?? [])],
    typologyFit: guardrails?.typologyFit,
    typologyShare: guardrails?.typologyShare,
    trendBumpApplied: guardrails?.trendBumpApplied,
    safeMaxSqft: guardrails?.size.medianSqft ? guardrails.size.safeMaxSqft : undefined,
  };
}

// Score combines ROI economics with confidence (when present).
function scoreAnalysis(a: AnalysisResult): number {
  const roiScore = a.roi * 0.3;
  const annualizedScore = a.annualizedRoi * 0.25;
  const riskScore =
    (a.feasibility === "permitted" ? 10 : 5) *
    (a.strategy === "flip_fix" ? 1.2 : 1) *
    0.2;
  const capitalScore = (1 - a.totalProjectCost / 5000000) * 10 * 0.15;
  // Confidence (0–100) scaled into a similar magnitude as the other inputs.
  const confidenceScore = ((a.confidence ?? 60) / 100) * 10 * 0.1;
  return roiScore + annualizedScore + riskScore + capitalScore + confidenceScore;
}

/**
 * Run all strategies. Always returns all four in **fixed strategy-enum order**
 * (fresh_build → split_build → main_adu → flip_fix) so the UI can render them
 * in stable positions. Each analysis carries `isTopRecommendation` indicating
 * whether it's currently in the top-2 by score, and `recommended` names the
 * single best one. Stable order is critical for mobile editing — when an
 * override flips scores, the cards must NOT reorder or the focused input
 * gets detached and loses focus.
 *
 * `additional` retains the not-allowed strategies (so they can still be
 * surfaced with a "Not Allowed" badge) plus any other excluded variants.
 */
export function analyzeAllStrategies(
  property: PropertyData,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  strategyOverrides?: Partial<Record<Strategy, StrategyOverrides>>
): {
  analyses: AnalysisResult[];
  additional: AnalysisResult[];
  recommended: Strategy;
} {
  const strategies: Strategy[] = ["fresh_build", "split_build", "main_adu", "flip_fix"];
  const all = strategies.map((s) =>
    calculateAnalysis(property, s, tier, costPerSqft, financing, strategyOverrides?.[s])
  );

  // Rank only the feasible ones — these compete for the top-2 slots and "best".
  const feasibleRanked = [...all]
    .filter((a) => a.feasibility !== "not_allowed")
    .map((a) => ({ strategy: a.strategy, score: scoreAnalysis(a), profit: a.profit }))
    .sort((a, b) => b.score - a.score);

  const top2Strategies = new Set(feasibleRanked.slice(0, 2).map((r) => r.strategy));
  const bestStrategy = feasibleRanked[0]?.strategy;
  const recommended: Strategy =
    bestStrategy && (feasibleRanked[0]?.profit ?? 0) > 0 ? bestStrategy : "pass";

  // Annotate all four in their original enum order.
  const annotated = all.map((a): AnalysisResult => ({
    ...a,
    isTopRecommendation: top2Strategies.has(a.strategy),
  }));

  return {
    analyses: annotated, // all four, in fixed order, top-2 marked
    additional: [],      // kept for back-compat; UI no longer uses a separate pane
    recommended,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET RENT DEFAULTS — ZIP-aware fallback when APIllow returns no rental data.
// Values are median 1BR asking rents ($/mo). Studio ≈ 75%, 2BR ≈ 140% of 1BR.
// Sources: Zillow Observed Rent Index / Apartment List (2025-2026 data).
// ─────────────────────────────────────────────────────────────────────────────

const ZIP_MEDIAN_1BR_RENT: Record<string, number> = {
  // ── Seattle / Eastside ────────────────────────────────────────────────────
  "98101": 2400, "98102": 2500, "98103": 2200, "98104": 2400, "98105": 2300,
  "98107": 2100, "98109": 2600, "98112": 2800, "98115": 2200, "98116": 2100,
  "98117": 2100, "98118": 1900, "98119": 2600, "98122": 2300, "98125": 1900,
  "98126": 1900, "98133": 1800, "98136": 2000, "98144": 2100, "98199": 2500,
  "98004": 2800, "98005": 2300, "98006": 2200, "98007": 2100, "98008": 2100,
  "98033": 2600, "98034": 2100, "98039": 4000, "98040": 3200, "98052": 2400,
  "98053": 2300, "98074": 2200, "98075": 2200, "98027": 2100, "98029": 2300,
  // ── Tacoma ────────────────────────────────────────────────────────────────
  "98402": 1400, "98403": 1500, "98405": 1400, "98406": 1600, "98407": 1700,
  // ── San Francisco Bay Area ────────────────────────────────────────────────
  "94105": 3800, "94107": 3600, "94109": 3400, "94110": 3000, "94114": 3500,
  "94115": 3400, "94117": 3200, "94118": 3300, "94121": 3000, "94122": 3000,
  "94123": 3500, "94131": 3200, "94132": 2800, "94133": 3400, "94134": 2800,
  "94025": 3500, "94027": 5500, "94301": 3800, "94401": 3200, "94501": 2400,
  "94611": 2800, "94618": 2900, "94705": 2800, "94707": 2600, "94920": 3200,
  "94941": 2800, "95014": 2600, "95030": 2500, "95125": 2200, "95126": 2200,
  // ── Los Angeles ───────────────────────────────────────────────────────────
  "90024": 3200, "90025": 2900, "90027": 2400, "90036": 2600, "90041": 2200,
  "90049": 3500, "90064": 2700, "90066": 2600, "90210": 5000, "90265": 4000,
  "90272": 4200, "90291": 3000, "90292": 2800, "90401": 2900, "90403": 3200,
  // ── New York ──────────────────────────────────────────────────────────────
  "10001": 4200, "10003": 4000, "10007": 4500, "10011": 4200, "10013": 4500,
  "10014": 4400, "10019": 4600, "10022": 5000, "10023": 4000, "10024": 3800,
  "10025": 3600, "10028": 4000, "10065": 4800, "10075": 4500,
  "11201": 3400, "11215": 3200, "11217": 3000, "11231": 3200, "11238": 3000,
  // ── Boston ────────────────────────────────────────────────────────────────
  "02108": 3500, "02109": 3200, "02116": 3800, "02118": 2800, "02127": 2800,
  "02129": 2600, "02130": 2400, "02138": 3000, "02139": 2800, "02143": 2400,
  // ── Chicago ───────────────────────────────────────────────────────────────
  "60601": 2200, "60610": 2300, "60611": 2400, "60614": 2400, "60647": 2000,
  "60657": 2200,
  // ── Dallas / Houston ──────────────────────────────────────────────────────
  "75205": 2200, "75206": 1800, "75219": 1800, "75225": 2000,
  "77005": 1800, "77006": 1600, "77007": 1700, "77019": 2200,
  // ── Phoenix / Scottsdale ─────────────────────────────────────────────────
  "85018": 1900, "85250": 1800, "85251": 1700, "85254": 2000, "85255": 2200,
  // ── Denver ───────────────────────────────────────────────────────────────
  "80203": 1800, "80206": 2000, "80209": 2100, "80302": 2200, "80304": 2300,
  // ── Austin ───────────────────────────────────────────────────────────────
  "78701": 2200, "78703": 2400, "78704": 2100, "78746": 2600,
  // ── DC Metro ─────────────────────────────────────────────────────────────
  "20001": 2400, "20003": 2500, "20007": 2800, "20009": 2300, "20016": 2600,
  "22201": 2200, "22207": 2500,
  // ── Nashville / Charlotte / Atlanta ───────────────────────────────────────
  "37203": 1800, "37205": 2000, "37215": 1900,
  "28202": 1700, "28203": 1800, "28207": 1900,
  "30305": 2000, "30306": 1800, "30309": 1700,
  // ── Miami ─────────────────────────────────────────────────────────────────
  "33101": 2000, "33131": 3200, "33132": 2800, "33133": 2800, "33139": 3500,
  "33140": 4000, "33480": 4500,
};

export interface MarketRentDefaults {
  studioRent: number;
  oneBrRent: number;
  twoBrRent: number;
  source: "zip" | "national";
}

/**
 * Return market-typical rents for a ZIP code.
 * Used as the fallback when APIllow rent comps are unavailable.
 */
export function getMarketRentDefaults(zip: string | undefined | null): MarketRentDefaults {
  const cleaned = (zip ?? "").trim().slice(0, 5);
  const oneBr = ZIP_MEDIAN_1BR_RENT[cleaned];
  if (oneBr) {
    return {
      studioRent: Math.round(oneBr * 0.75),
      oneBrRent: oneBr,
      twoBrRent: Math.round(oneBr * 1.40),
      source: "zip",
    };
  }
  // National median fallback (US 2025-2026 average)
  return { studioRent: 1400, oneBrRent: 1800, twoBrRent: 2300, source: "national" };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOWNHOME ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate townhome / row-house strategy metrics.
 * All units are assumed to sell fee-simple on completion.
 */
export function calculateTownhomeAnalysis(
  property: PropertyData,
  inputs: TownhomeInputs,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig
): AnalysisResult {
  const { unitCount, avgUnitSqft, hoaSetupCost, sharedInfraCost, salePricePerUnit } = inputs;

  const feasibility = checkFeasibility(property, "townhome");

  // ── Timeline ──────────────────────────────────────────────────────────────
  // Townhomes: longer permit (city review for attached), but build faster per sqft
  // than SFR due to shared structure and repeated floor plans.
  const permitMonths = 8;
  const totalSqft = unitCount * avgUnitSqft;
  // ~500 sqft/month (faster than SFR's 400 sqft/mo due to repetition)
  const buildMonths = Math.ceil((totalSqft / 500) * QUALITY_TIERS[tier].timeMultiplier);
  const sellMonths = 3; // units sell sequentially, avg 3mo to clear
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // ── Costs ─────────────────────────────────────────────────────────────────
  const purchasePrice = property.listingPrice;
  const closingCosts = purchasePrice * 0.025;
  const acquisitionCost = purchasePrice + closingCosts;

  // Attached housing builds for ~82% of standalone SFR cost/sqft:
  // shared walls, shared foundation runs, shared rooflines reduce per-unit cost.
  const attachedCostPerSqft = Math.round(costPerSqft * 0.82);

  const demolitionCost = 20000;
  const architectFees = totalSqft * attachedCostPerSqft * 0.05;
  const permitFees = 30000 + unitCount * 3000; // per-unit permit fees
  const contingency = totalSqft * attachedCostPerSqft * 0.12;
  const landscaping = 15000 + unitCount * 3000;
  const constructionCost =
    totalSqft * attachedCostPerSqft +
    demolitionCost +
    architectFees +
    permitFees +
    contingency +
    landscaping +
    hoaSetupCost +
    sharedInfraCost;

  // ── Holding costs ─────────────────────────────────────────────────────────
  const downPayment = purchasePrice * (financing.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const monthlyMortgage = calculateMonthlyPayment(
    loanAmount,
    financing.interestRate,
    financing.loanTermYears,
    financing.type === "interest_only"
  );
  const holdingCostMonthly =
    monthlyMortgage +
    property.annualPropertyTax / 12 +
    (purchasePrice * 0.004) / 12 +
    300;
  const totalHoldingCost = holdingCostMonthly * timelineMonths;

  // ── Revenue ───────────────────────────────────────────────────────────────
  // salePricePerUnit = 0 means auto-estimate from comps (use neighborhood data)
  let effectiveSalePricePerUnit = salePricePerUnit;
  if (!effectiveSalePricePerUnit || effectiveSalePricePerUnit === 0) {
    // Estimate: use attached/condo comps if available, else fall back to SFR comps
    const compResult = getDefaultSellPricePerSqft(property, tier, "fresh_build");
    // Townhomes trade at ~90% of SFR comparable (attached vs detached discount)
    effectiveSalePricePerUnit = Math.round(compResult.value * avgUnitSqft * 0.90);
  }

  const agentCommission = (effectiveSalePricePerUnit * unitCount) * 0.05;
  const exciseTax = (effectiveSalePricePerUnit * unitCount) * 0.018;
  const sellerConcessions = (effectiveSalePricePerUnit * unitCount) * 0.01;
  const sellingCosts = agentCommission + exciseTax + sellerConcessions + 5000;
  const expectedSalePrice = effectiveSalePricePerUnit * unitCount;

  // ── Profit ────────────────────────────────────────────────────────────────
  const totalProjectCost = acquisitionCost + constructionCost + totalHoldingCost + sellingCosts;
  const profit = expectedSalePrice - totalProjectCost;
  const totalCashInvested = downPayment + constructionCost + totalHoldingCost + closingCosts;
  const roi = totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0;
  const annualizedRoi = timelineMonths > 0 ? roi * (12 / timelineMonths) : 0;
  const profitPerUnit = unitCount > 0 ? Math.round(profit / unitCount) : 0;

  const recommendation =
    feasibility === "not_allowed"
      ? `Townhome/row house development appears not permitted under zoning ${property.zoningCode}. Verify with the city.`
      : profit > 0 && roi > 15
      ? `Townhome build projects ${formatCurrency(profit)} profit (${roi.toFixed(1)}% ROI) across ${unitCount} units over ${timelineMonths} months — ${formatCurrency(profitPerUnit)}/unit.`
      : profit > 0
      ? `Marginal townhome deal — ${formatCurrency(profit)} profit at ${roi.toFixed(1)}% ROI. Consider reducing unit count or negotiating acquisition.`
      : `Townhome not viable at current numbers. Projects a ${formatCurrency(Math.abs(profit))} loss.`;

  return {
    id: `${property.id}-townhome-${Date.now()}`,
    propertyId: property.id,
    property,
    strategy: "townhome",
    qualityTier: tier,
    costPerSqft,
    buildSqft: Math.round(totalSqft),
    financing,
    acquisitionCost: Math.round(acquisitionCost),
    constructionCost: Math.round(constructionCost),
    holdingCostMonthly: Math.round(holdingCostMonthly),
    totalHoldingCost: Math.round(totalHoldingCost),
    sellingCosts: Math.round(sellingCosts),
    totalProjectCost: Math.round(totalProjectCost),
    expectedSalePrice: Math.round(expectedSalePrice),
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    annualizedRoi: Math.round(annualizedRoi * 10) / 10,
    timelineMonths,
    permitMonths,
    buildMonths,
    sellMonths,
    feasibility,
    recommendation,
    createdAt: new Date().toISOString(),
    // Townhome-specific
    unitCount,
    profitPerUnit,
    costPerUnit: Math.round(totalProjectCost / Math.max(unitCount, 1)),
    revenuePerUnit: Math.round(expectedSalePrice / Math.max(unitCount, 1)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-FAMILY ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate multi-family / condo analysis.
 * Supports two exit paths:
 *   - "rent"  → NOI, cap rate, GRM, cash-on-cash
 *   - "sell"  → profit, ROI, margin per unit (condo conversion)
 */
export function calculateMultiFamilyAnalysis(
  property: PropertyData,
  inputs: MultiFamilyInputs,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig
): AnalysisResult {
  const {
    exitType,
    studioCount, oneBrCount, twoBrCount,
    avgUnitSqft,
    studioRent, oneBrRent, twoBrRent,
    vacancyRate,
    operatingExpenseRatio,
    condoConversionCost,
    salePricePerUnit,
  } = inputs;

  const totalUnits = studioCount + oneBrCount + twoBrCount;
  const feasibility = checkFeasibility(property, "multifamily");

  // ── Timeline ──────────────────────────────────────────────────────────────
  const permitMonths = 10; // full environmental review + design approval
  const totalSqft = totalUnits * avgUnitSqft;
  // MF builds at ~700 sqft/month — stacked/repetitive floor plans are the most
  // efficient residential construction type. Faster than SFR (400) or townhome (500).
  const buildMonths = Math.ceil((totalSqft / 700) * QUALITY_TIERS[tier].timeMultiplier);
  // Sell exit: takes longer to condo-convert + sell; rent exit: occupied sooner
  const sellMonths = exitType === "sell" ? 4 : 1;
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // ── Costs ─────────────────────────────────────────────────────────────────
  const purchasePrice = property.listingPrice;
  const closingCosts = purchasePrice * 0.025;
  const acquisitionCost = purchasePrice + closingCosts;

  // MF stacked units build at ~75% of SFR $/sqft — highest efficiency of any
  // residential type (shared vertical structure, mechanical chases, elevators spread
  // across many units). This is the standard industry adjustment.
  const mfCostPerSqft = Math.round(costPerSqft * 0.75);

  const demolitionCost = 25000;
  const architectFees = totalSqft * mfCostPerSqft * 0.06; // MF needs more detailed plans
  const permitFees = 40000 + totalUnits * 4000;
  const contingency = totalSqft * mfCostPerSqft * 0.12;
  const commonAreaCost = totalUnits * 8000; // hallways, lobby, amenities
  const condoConversionTotal = exitType === "sell" ? condoConversionCost * totalUnits : 0;
  const landscaping = 20000;
  const constructionCost =
    totalSqft * mfCostPerSqft +
    demolitionCost +
    architectFees +
    permitFees +
    contingency +
    commonAreaCost +
    condoConversionTotal +
    landscaping;

  // ── Holding costs ─────────────────────────────────────────────────────────
  const downPayment = purchasePrice * (financing.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const monthlyMortgage = calculateMonthlyPayment(
    loanAmount,
    financing.interestRate,
    financing.loanTermYears,
    financing.type === "interest_only"
  );
  const holdingCostMonthly =
    monthlyMortgage +
    property.annualPropertyTax / 12 +
    (purchasePrice * 0.004) / 12 +
    300;
  const totalHoldingCost = holdingCostMonthly * timelineMonths;
  const totalProjectCost = acquisitionCost + constructionCost + totalHoldingCost;

  // ── RENT EXIT ─────────────────────────────────────────────────────────────
  if (exitType === "rent") {
    // Weighted gross monthly rent
    const grossMonthlyRent =
      studioCount * studioRent + oneBrCount * oneBrRent + twoBrCount * twoBrRent;
    const grossRentalIncome = grossMonthlyRent * 12; // annual
    const effectiveGrossIncome = grossRentalIncome * (1 - vacancyRate);
    const operatingExpenses = effectiveGrossIncome * operatingExpenseRatio;
    const noi = effectiveGrossIncome - operatingExpenses;

    const capRate = totalProjectCost > 0 ? (noi / totalProjectCost) * 100 : 0;
    const grm = grossRentalIncome > 0 ? totalProjectCost / grossRentalIncome : 0;

    // Annual debt service — permanent MF loan at 75% LTV on stabilized value,
    // using a 30-year amortization (standard agency/DSCR structure).
    const totalLoan = totalProjectCost * 0.75;
    const annualDebtService =
      calculateMonthlyPayment(totalLoan, financing.interestRate, 30) * 12;
    const equity = totalProjectCost - totalLoan;
    const cashOnCash = equity > 0 ? ((noi - annualDebtService) / equity) * 100 : 0;
    const breakEvenOccupancy =
      grossRentalIncome > 0
        ? ((operatingExpenses + annualDebtService) / grossRentalIncome) * 100
        : 0;

    // For comparability with sell strategies, compute "paper profit" as
    // capitalized value minus cost (at 5.5% stabilized cap).
    const stabilizedCapRate = 0.055;
    const capitalizedValue = stabilizedCapRate > 0 ? noi / stabilizedCapRate : 0;
    const profit = capitalizedValue - totalProjectCost;
    const roi = equity > 0 ? cashOnCash : 0;

    const recommendation =
      feasibility === "not_allowed"
        ? `Multi-family appears not permitted under ${property.zoningCode}. Verify with the city.`
        : capRate >= 7
        ? `Strong rental investment — ${capRate.toFixed(1)}% cap rate, ${cashOnCash.toFixed(1)}% cash-on-cash. NOI: ${formatCurrency(noi)}/yr.`
        : capRate >= 5
        ? `Moderate rental return — ${capRate.toFixed(1)}% cap rate. Consider reducing construction budget or increasing rents.`
        : `Thin rental margins — ${capRate.toFixed(1)}% cap rate. Underwriting may not support the build cost.`;

    return {
      id: `${property.id}-multifamily-${Date.now()}`,
      propertyId: property.id,
      property,
      strategy: "multifamily",
      qualityTier: tier,
      costPerSqft,
      buildSqft: Math.round(totalSqft),
      financing,
      acquisitionCost: Math.round(acquisitionCost),
      constructionCost: Math.round(constructionCost),
      holdingCostMonthly: Math.round(holdingCostMonthly),
      totalHoldingCost: Math.round(totalHoldingCost),
      sellingCosts: 0,
      totalProjectCost: Math.round(totalProjectCost),
      expectedSalePrice: Math.round(capitalizedValue),
      profit: Math.round(profit),
      roi: Math.round(roi * 10) / 10,
      annualizedRoi: Math.round((roi * (12 / timelineMonths)) * 10) / 10,
      timelineMonths,
      permitMonths,
      buildMonths,
      sellMonths,
      feasibility,
      recommendation,
      createdAt: new Date().toISOString(),
      // MF-specific
      unitCount: totalUnits,
      exitType: "rent",
      grossRentalIncome: Math.round(grossRentalIncome),
      effectiveGrossIncome: Math.round(effectiveGrossIncome),
      noi: Math.round(noi),
      capRate: Math.round(capRate * 10) / 10,
      grm: Math.round(grm * 10) / 10,
      cashOnCash: Math.round(cashOnCash * 10) / 10,
      breakEvenOccupancy: Math.round(breakEvenOccupancy * 10) / 10,
      debtService: Math.round(annualDebtService),
      costPerUnit: Math.round(totalProjectCost / Math.max(totalUnits, 1)),
    };
  }

  // ── SELL EXIT (condo conversion) ──────────────────────────────────────────
  let effectiveSalePricePerUnit = salePricePerUnit;
  if (!effectiveSalePricePerUnit || effectiveSalePricePerUnit === 0) {
    const compResult = getDefaultSellPricePerSqft(property, tier, "fresh_build");
    // MF units sell at ~85% of SFR $/sqft (smaller units, shared walls)
    effectiveSalePricePerUnit = Math.round(compResult.value * avgUnitSqft * 0.85);
  }

  const totalRevenue = effectiveSalePricePerUnit * totalUnits;
  const agentCommission = totalRevenue * 0.05;
  const exciseTax = totalRevenue * 0.018;
  const sellingCosts = agentCommission + exciseTax + totalRevenue * 0.01 + 5000;
  const expectedSalePrice = totalRevenue;

  const profit = expectedSalePrice - totalProjectCost - sellingCosts;
  const totalCashInvested = downPayment + constructionCost + totalHoldingCost + closingCosts;
  const roi = totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0;
  const annualizedRoi = timelineMonths > 0 ? roi * (12 / timelineMonths) : 0;
  const profitPerUnit = totalUnits > 0 ? Math.round(profit / totalUnits) : 0;

  const recommendation =
    feasibility === "not_allowed"
      ? `Multi-family condo appears not permitted under ${property.zoningCode}. Verify with the city.`
      : profit > 0 && roi > 15
      ? `Condo conversion projects ${formatCurrency(profit)} profit (${roi.toFixed(1)}% ROI) across ${totalUnits} units — ${formatCurrency(profitPerUnit)}/unit.`
      : profit > 0
      ? `Marginal condo deal — ${formatCurrency(profit)} profit at ${roi.toFixed(1)}% ROI. Thin margins for the complexity.`
      : `Condo conversion not viable at current numbers. Projects a ${formatCurrency(Math.abs(profit))} loss.`;

  return {
    id: `${property.id}-multifamily-${Date.now()}`,
    propertyId: property.id,
    property,
    strategy: "multifamily",
    qualityTier: tier,
    costPerSqft,
    buildSqft: Math.round(totalSqft),
    financing,
    acquisitionCost: Math.round(acquisitionCost),
    constructionCost: Math.round(constructionCost),
    holdingCostMonthly: Math.round(holdingCostMonthly),
    totalHoldingCost: Math.round(totalHoldingCost),
    sellingCosts: Math.round(sellingCosts),
    totalProjectCost: Math.round(totalProjectCost),
    expectedSalePrice: Math.round(expectedSalePrice),
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    annualizedRoi: Math.round(annualizedRoi * 10) / 10,
    timelineMonths,
    permitMonths,
    buildMonths,
    sellMonths,
    feasibility,
    recommendation,
    createdAt: new Date().toISOString(),
    // MF-specific
    unitCount: totalUnits,
    exitType: "sell",
    profitPerUnit,
    costPerUnit: Math.round(totalProjectCost / Math.max(totalUnits, 1)),
    revenuePerUnit: Math.round(expectedSalePrice / Math.max(totalUnits, 1)),
  };
}

// Utility
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
