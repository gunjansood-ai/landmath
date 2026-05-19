import { NextRequest, NextResponse } from "next/server";

/**
 * Permit Radar — multi-source permit data for King County, WA
 *
 * Sources by city:
 *   Seattle        → Seattle Open Data (Socrata) — data.seattle.gov/resource/76t5-zqzr
 *   Bellevue       → City of Bellevue ArcGIS FeatureServer — services1.arcgis.com
 *   Other KC cities → unavailable (no public API found), links to city portal
 *
 * City routing uses the `city` query param (passed from PropertyData.city),
 * with a lat/lng bounding box as fallback.
 */

// ── Data source URLs ──────────────────────────────────────────────────────────

const SEATTLE_PERMITS_URL  = "https://data.seattle.gov/resource/76t5-zqzr.json";
const BELLEVUE_PERMITS_URL =
  "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Bellevue_Permits/FeatureServer/0/query";

// ── Bounding boxes (lat/lng) as fallback city detection ───────────────────────
const SEATTLE_BOUNDS  = { latMin: 47.48, latMax: 47.74, lngMin: -122.46, lngMax: -122.22 };
const BELLEVUE_BOUNDS = { latMin: 47.54, latMax: 47.65, lngMin: -122.25, lngMax: -122.09 };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PermitRecord {
  permitNumber: string;
  address: string;
  permitType: string;
  description: string;
  issuedDate: string | null;
  status: string;
  estimatedValue: number | null;
  latitude: number | null;
  longitude: number | null;
  distanceMiles: number | null;
  category: "new_construction" | "addition" | "adu" | "renovation" | "demo" | "other";
  /** Direct link to the permit record in the city's permit portal */
  permitUrl?: string;
}

export interface PermitRadarResult {
  permits: PermitRecord[];
  summary: {
    total: number;
    newConstruction: number;
    adu: number;
    additions: number;
    renovations: number;
    demolitions: number;
    recentActivity: "high" | "medium" | "low";
    competitiveSupplyScore: number;
    competitiveSupplyLabel: "Low" | "Medium" | "High";
    radiusMiles: number;
    lookbackDays: number;
  };
  source: "seattle_open_data" | "bellevue_arcgis" | "unavailable";
  cityName?: string;       // human-readable city label for UI
  portalUrl?: string;      // city permit portal link for "unavailable" state
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function inBounds(
  lat: number, lng: number,
  b: { latMin: number; latMax: number; lngMin: number; lngMax: number }
): boolean {
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

type CityTarget = "seattle" | "bellevue" | "other_kc" | "unknown";

function detectCity(cityParam: string, lat: number, lng: number): CityTarget {
  const c = cityParam.toLowerCase().trim();
  if (c.includes("seattle"))  return "seattle";
  if (c.includes("bellevue")) return "bellevue";

  // Known KC cities that have no public permit API
  const otherKC = [
    "kirkland","redmond","renton","kent","sammamish","federal way","burien",
    "auburn","shoreline","bothell","kenmore","mercer island","issaquah",
    "newcastle","lake forest park","woodinville","covington","maple valley",
    "black diamond","enumclaw","north bend","snoqualmie","duvall","carnation",
    "unincorporated","king county",
  ];
  if (otherKC.some((k) => c.includes(k))) return "other_kc";

  // Bounding box fallback
  if (inBounds(lat, lng, SEATTLE_BOUNDS))  return "seattle";
  if (inBounds(lat, lng, BELLEVUE_BOUNDS)) return "bellevue";
  // Still inside KC rough bounds but city unknown
  if (lat >= 47.1 && lat <= 47.8 && lng >= -122.5 && lng <= -121.5) return "other_kc";
  return "unknown";
}

function computeCompetitiveScore(permits: PermitRecord[], lookbackDays: number): number {
  const newConst  = permits.filter((p) => p.category === "new_construction").length;
  const adu       = permits.filter((p) => p.category === "adu").length;
  const additions = permits.filter((p) => p.category === "addition").length;
  const daysFactor = 90 / lookbackDays;
  const weighted = (newConst * 3 + adu * 2 + additions * 1) * daysFactor;
  return Math.min(100, Math.round((weighted / 10) * 100));
}

function buildSummary(
  permits: PermitRecord[],
  radiusMiles: number,
  lookbackDays: number,
  source: PermitRadarResult["source"],
  cityName?: string,
  portalUrl?: string
): PermitRadarResult {
  const newConstruction = permits.filter((p) => p.category === "new_construction").length;
  const adu             = permits.filter((p) => p.category === "adu").length;
  const additions       = permits.filter((p) => p.category === "addition").length;
  const renovations     = permits.filter((p) => p.category === "renovation").length;
  const demolitions     = permits.filter((p) => p.category === "demo").length;
  const total           = permits.length;
  const score           = computeCompetitiveScore(permits, lookbackDays);
  return {
    permits: permits.slice(0, 50),
    summary: {
      total, newConstruction, adu, additions, renovations, demolitions,
      recentActivity: total >= 10 ? "high" : total >= 4 ? "medium" : "low",
      competitiveSupplyScore: score,
      competitiveSupplyLabel: score >= 60 ? "High" : score >= 30 ? "Medium" : "Low",
      radiusMiles,
      lookbackDays,
    },
    source,
    cityName,
    portalUrl,
  };
}

function emptyUnavailable(
  radiusMiles: number,
  lookbackDays: number,
  cityName?: string,
  portalUrl?: string
): PermitRadarResult {
  return buildSummary([], radiusMiles, lookbackDays, "unavailable", cityName, portalUrl);
}

// ── Seattle fetcher (Socrata) ─────────────────────────────────────────────────

function categorizeSeattle(typeMapped: string, typeDesc: string, desc: string): PermitRecord["category"] {
  const combined = `${typeMapped} ${typeDesc} ${desc}`.toLowerCase();
  if (typeMapped.toLowerCase() === "demolition" || combined.includes("demolit")) return "demo";
  if (combined.includes("adu") || combined.includes("accessory dwelling") ||
      combined.includes("backyard cottage") || combined.includes("dadu"))        return "adu";
  if (combined.includes("new single family") || combined.includes("new residence") ||
      combined.includes("new home") || combined.includes("construct new") ||
      (combined.includes("new") && combined.includes("single family")))          return "new_construction";
  if (combined.includes("addition") || combined.includes("expand"))              return "addition";
  if (combined.includes("remodel") || combined.includes("renovate") ||
      combined.includes("alteration") || combined.includes("repair") ||
      combined.includes("tenant improvement") || combined.includes("interior"))  return "renovation";
  return "other";
}

async function fetchSeattlePermits(
  lat: number, lng: number,
  radiusMiles: number, lookbackDays: number
): Promise<PermitRecord[]> {
  const radiusM   = Math.round(radiusMiles * 1609.34);
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const where     = `within_circle(location1,${lat},${lng},${radiusM}) AND issueddate > '${cutoffDate}'`;
  const params    = new URLSearchParams({ $where: where, $order: "issueddate DESC", $limit: "200" });

  const res = await fetch(`${SEATTLE_PERMITS_URL}?${params}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Seattle API ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await res.json();
  return rows
    .map((r): PermitRecord => {
      const pLat = r.latitude  ? parseFloat(r.latitude)  : null;
      const pLng = r.longitude ? parseFloat(r.longitude) : null;
      const dist = pLat && pLng ? haversineMiles(lat, lng, pLat, pLng) : null;
      const permitNum = r.permitnum ?? "";
      return {
        permitNumber: permitNum,
        address: [r.originaladdress1, r.originalcity].filter(Boolean).join(", "),
        permitType: r.permittypemapped ?? "",
        description: r.description ?? "",
        issuedDate: r.issueddate ? r.issueddate.slice(0, 10) : null,
        status: r.statuscurrent ?? "",
        estimatedValue: r.estprojectcost ? parseFloat(r.estprojectcost) : null,
        latitude: pLat,
        longitude: pLng,
        distanceMiles: dist != null ? Math.round(dist * 100) / 100 : null,
        category: categorizeSeattle(r.permittypemapped ?? "", r.permittypedesc ?? "", r.description ?? ""),
        // Seattle Accela Citizen Access deep link
        permitUrl: permitNum
          ? `https://cosaccela.seattle.gov/portal/Cap/CapDetail.aspx?Module=Building&capID1=${encodeURIComponent(permitNum)}`
          : undefined,
      };
    })
    .filter((p) => p.category !== "other")
    .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
}

// ── Bellevue fetcher (ArcGIS FeatureServer) ───────────────────────────────────

// Bellevue permit type codes → our categories
// BS=Single Family New, BR=SF Addition, BT/BU=SF Remodel, BE=Demolition
// BB/BA=Major Commercial, ADU detected via SQFOOTAGEADU field
const BELLEVUE_TYPE_MAP: Record<string, PermitRecord["category"]> = {
  BS: "new_construction",   // Single Family New
  BB: "new_construction",   // Major Commercial Project
  BA: "new_construction",   // Major Commercial Project w/ SEPA
  BR: "addition",           // Single Family Addition
  BT: "renovation",         // SF Remodel No Plan Review
  BU: "renovation",         // Single Family Remodel Plan Review
  BE: "demo",               // Demolition
  BZ: "renovation",         // Tenant Improvement
  BY: "renovation",         // Tenant Improvement - New Use
  BW: "other",              // Minor Commercial
};

function categorizeBellevue(
  permitType: string, typeDesc: string, desc: string, sqftAdu: number | null
): PermitRecord["category"] {
  // ADU detection via dedicated field
  if (sqftAdu && sqftAdu > 0) return "adu";
  const combined = `${permitType} ${typeDesc} ${desc}`.toLowerCase();
  if (combined.includes("adu") || combined.includes("accessory dwelling")) return "adu";

  const mapped = BELLEVUE_TYPE_MAP[permitType];
  if (mapped) return mapped;

  // Fallback description-based
  if (combined.includes("new single") || combined.includes("single family new")) return "new_construction";
  if (combined.includes("addition"))    return "addition";
  if (combined.includes("remodel") || combined.includes("renovate")) return "renovation";
  if (combined.includes("demo"))        return "demo";
  return "other";
}

async function fetchBellevuePermits(
  lat: number, lng: number,
  radiusMiles: number, lookbackDays: number
): Promise<PermitRecord[]> {
  const radiusM    = Math.round(radiusMiles * 1609.34);
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: radiusM.toString(),
    units: "esriSRUnit_Meter",
    where: `ISSUEDDATE > DATE '${cutoffDate}'`,
    outFields: [
      "PERMITNUMBER","PERMITTYPE","PERMITTYPEDESCRIPTION","PROJECTDESCRIPTION",
      "SITEADDRESS","ISSUEDDATE","PERMITSTATUS","VALUATION","SQFOOTAGEADU",
    ].join(","),
    returnGeometry: "true",
    outSR: "4326",
    orderByFields: "ISSUEDDATE DESC",
    resultRecordCount: "200",
    f: "json",
  });

  const res = await fetch(`${BELLEVUE_PERMITS_URL}?${params}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Bellevue API ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(`Bellevue ArcGIS: ${data.error.message}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.features ?? [])
    .map((f: any): PermitRecord => {
      const a    = f.attributes ?? {};
      const geo  = f.geometry ?? {};
      const pLat = geo.y ?? null;
      const pLng = geo.x ?? null;
      const dist = pLat && pLng ? haversineMiles(lat, lng, pLat, pLng) : null;
      const ts   = a.ISSUEDDATE;
      const sqftAdu = typeof a.SQFOOTAGEADU === "number" ? a.SQFOOTAGEADU : null;
      const permitNum = a.PERMITNUMBER ?? "";
      return {
        permitNumber: permitNum,
        address: a.SITEADDRESS ?? "",
        permitType: a.PERMITTYPEDESCRIPTION ?? a.PERMITTYPE ?? "",
        description: a.PROJECTDESCRIPTION ?? "",
        issuedDate: ts ? new Date(ts).toISOString().slice(0, 10) : null,
        status: a.PERMITSTATUS ?? "",
        estimatedValue: typeof a.VALUATION === "number" ? a.VALUATION : null,
        latitude: pLat,
        longitude: pLng,
        distanceMiles: dist != null ? Math.round(dist * 100) / 100 : null,
        category: categorizeBellevue(
          a.PERMITTYPE ?? "", a.PERMITTYPEDESCRIPTION ?? "", a.PROJECTDESCRIPTION ?? "", sqftAdu
        ),
        // Bellevue Accela Citizen Access deep link
        permitUrl: permitNum
          ? `https://epermit.bellevuewa.gov/CitizenAccess/Cap/CapDetail.aspx?Module=Building&capID1=${encodeURIComponent(permitNum)}`
          : undefined,
      };
    })
    .filter((p: PermitRecord) => p.category !== "other")
    .sort((a: PermitRecord, b: PermitRecord) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
}

// ── Portal links for cities without API ──────────────────────────────────────

const KC_CITY_PORTALS: Record<string, { label: string; url: string }> = {
  kirkland:       { label: "Kirkland Permit Center",    url: "https://www.kirklandwa.gov/government/departments/planning-and-building/permits-and-inspections" },
  redmond:        { label: "Redmond Permits",           url: "https://www.redmond.gov/428/Permits-and-Zoning" },
  renton:         { label: "Renton Permits & Licensing",url: "https://rentonwa.gov/cms/one.aspx?portalId=7922741&pageId=9867923" },
  kent:           { label: "Kent Permits",              url: "https://www.kentwa.gov/government/departments/permitting" },
  sammamish:      { label: "Sammamish Permits",         url: "https://www.sammamish.us/government/departments/community-development/permits/" },
  issaquah:       { label: "Issaquah Permits",          url: "https://ci.issaquah.wa.us/permits" },
  "mercer island":{ label: "Mercer Island Permits",     url: "https://www.mercergov.org/city-services/permits-inspections/" },
  shoreline:      { label: "Shoreline Permits",         url: "https://www.shorelinewa.gov/government/departments/planning-and-development/building-permits" },
  bothell:        { label: "Bothell Permits",           url: "https://www.ci.bothell.wa.us/220/Permits" },
  kenmore:        { label: "Kenmore Permits",           url: "https://www.kenmorewa.gov/city-hall/community-development/building-permits" },
  woodinville:    { label: "Woodinville Permits",       url: "https://www.ci.woodinville.wa.us/departments/building-planning" },
  "king county":  { label: "King County DPER",          url: "https://www.kingcounty.gov/depts/local-services/permits.aspx" },
};

function getPortalForCity(city: string): { label: string; url: string } | null {
  const c = city.toLowerCase().trim();
  for (const [key, val] of Object.entries(KC_CITY_PORTALS)) {
    if (c.includes(key)) return val;
  }
  return { label: "King County DPER", url: "https://www.kingcounty.gov/depts/local-services/permits.aspx" };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const lat          = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng          = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const radiusMiles  = parseFloat(req.nextUrl.searchParams.get("radius") ?? "1.0");
  const lookbackDays = parseInt(req.nextUrl.searchParams.get("days") ?? "90");
  const cityParam    = req.nextUrl.searchParams.get("city") ?? "";

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  const target = detectCity(cityParam, lat, lng);

  // ── Seattle ───────────────────────────────────────────────────────────────
  if (target === "seattle") {
    try {
      const permits = await fetchSeattlePermits(lat, lng, radiusMiles, lookbackDays);
      return NextResponse.json(buildSummary(permits, radiusMiles, lookbackDays, "seattle_open_data", "Seattle"));
    } catch (err) {
      console.error("Seattle permits error:", err);
      return NextResponse.json(emptyUnavailable(radiusMiles, lookbackDays, "Seattle"));
    }
  }

  // ── Bellevue ──────────────────────────────────────────────────────────────
  if (target === "bellevue") {
    try {
      const permits = await fetchBellevuePermits(lat, lng, radiusMiles, lookbackDays);
      return NextResponse.json(buildSummary(permits, radiusMiles, lookbackDays, "bellevue_arcgis", "Bellevue"));
    } catch (err) {
      console.error("Bellevue permits error:", err);
      return NextResponse.json(emptyUnavailable(radiusMiles, lookbackDays, "Bellevue",
        "https://services1.arcgis.com/EYzEZbDhXZjURPbP/arcgis/rest/services/Bellevue_Permits/FeatureServer"));
    }
  }

  // ── Other KC city — no API, return helpful unavailable ───────────────────
  if (target === "other_kc") {
    const portal = getPortalForCity(cityParam);
    const label  = cityParam
      ? cityParam.replace(/\b\w/g, (c) => c.toUpperCase())
      : "this area";
    return NextResponse.json(
      emptyUnavailable(radiusMiles, lookbackDays, label, portal?.url)
    );
  }

  // ── Unknown / outside KC ─────────────────────────────────────────────────
  return NextResponse.json(emptyUnavailable(radiusMiles, lookbackDays));
}
