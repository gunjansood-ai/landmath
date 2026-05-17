import { NextRequest, NextResponse } from "next/server";

/**
 * Permit Radar — queries Seattle Open Data (Socrata) for building permit
 * activity near a subject property. Returns recent permits within a
 * configurable radius, categorised by type.
 *
 * Data source:
 *   Seattle Building Permits — data.seattle.gov dataset 76t5-zqzr
 *   Socrata SoQL spatial query: within_circle(location1, lat, lng, radiusMeters)
 *
 * Coverage: Seattle city limits only. Returns source="unavailable" for
 * coordinates outside Seattle's bounding box.
 */

// Seattle Open Data — Building Permits (Socrata)
const SEATTLE_PERMITS_URL = "https://data.seattle.gov/resource/76t5-zqzr.json";

// Approximate Seattle bounding box — coords outside this → unavailable
const SEATTLE_BOUNDS = {
  latMin: 47.48,
  latMax: 47.74,
  lngMin: -122.46,
  lngMax: -122.22,
};

function isInSeattle(lat: number, lng: number): boolean {
  return (
    lat >= SEATTLE_BOUNDS.latMin &&
    lat <= SEATTLE_BOUNDS.latMax &&
    lng >= SEATTLE_BOUNDS.lngMin &&
    lng <= SEATTLE_BOUNDS.lngMax
  );
}

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
  source: "seattle_open_data" | "unavailable";
  error?: string;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function categorizePermit(
  permitTypeMapped: string,
  permitTypeDesc: string,
  desc: string
): PermitRecord["category"] {
  const t = (permitTypeMapped ?? "").toLowerCase();
  const td = (permitTypeDesc ?? "").toLowerCase();
  const d = (desc ?? "").toLowerCase();
  const combined = `${t} ${td} ${d}`;

  if (t === "demolition" || combined.includes("demolit") || combined.includes("demo")) return "demo";
  if (combined.includes("adu") || combined.includes("accessory dwelling") || combined.includes("backyard cottage") || combined.includes("dadu")) return "adu";
  if (
    combined.includes("new single family") ||
    combined.includes("new residence") ||
    combined.includes("new home") ||
    combined.includes("construct new") ||
    (combined.includes("new") && combined.includes("single family"))
  ) return "new_construction";
  if (combined.includes("addition") || combined.includes("expand") || combined.includes("add to")) return "addition";
  if (
    combined.includes("remodel") ||
    combined.includes("renovate") ||
    combined.includes("alteration") ||
    combined.includes("repair") ||
    combined.includes("tenant improvement") ||
    combined.includes("interior")
  ) return "renovation";

  return "other";
}

function computeCompetitiveScore(permits: PermitRecord[], lookbackDays: number): number {
  const newConst = permits.filter((p) => p.category === "new_construction").length;
  const adu = permits.filter((p) => p.category === "adu").length;
  const additions = permits.filter((p) => p.category === "addition").length;

  const daysFactor = 90 / lookbackDays;
  const weightedCount = (newConst * 3 + adu * 2 + additions * 1) * daysFactor;

  return Math.min(100, Math.round((weightedCount / 10) * 100));
}

function emptyResult(
  radiusMiles: number,
  lookbackDays: number,
  source: PermitRadarResult["source"],
  error?: string
): PermitRadarResult {
  return {
    permits: [],
    summary: {
      total: 0,
      newConstruction: 0,
      adu: 0,
      additions: 0,
      renovations: 0,
      demolitions: 0,
      recentActivity: "low",
      competitiveSupplyScore: 0,
      competitiveSupplyLabel: "Low",
      radiusMiles,
      lookbackDays,
    },
    source,
    error,
  };
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const radiusMiles = parseFloat(req.nextUrl.searchParams.get("radius") ?? "1.0");
  const lookbackDays = parseInt(req.nextUrl.searchParams.get("days") ?? "90");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  // Only Seattle is supported — return unavailable for other areas
  if (!isInSeattle(lat, lng)) {
    return NextResponse.json(emptyResult(radiusMiles, lookbackDays, "unavailable"));
  }

  const radiusMeters = Math.round(radiusMiles * 1609.34);
  const cutoffDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    // Socrata SoQL query — spatial circle + date filter
    const where = `within_circle(location1,${lat},${lng},${radiusMeters}) AND issueddate > '${cutoffDate}'`;
    const params = new URLSearchParams({
      $where: where,
      $order: "issueddate DESC",
      $limit: "200",
    });

    const res = await fetch(`${SEATTLE_PERMITS_URL}?${params}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      console.error(`Seattle permits API error: ${res.status}`);
      return NextResponse.json(emptyResult(radiusMiles, lookbackDays, "unavailable", `API ${res.status}`));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await res.json();

    const permits: PermitRecord[] = rows
      .map((r): PermitRecord => {
        const pLat = r.latitude ? parseFloat(r.latitude) : null;
        const pLng = r.longitude ? parseFloat(r.longitude) : null;
        const dist = pLat && pLng ? haversineMiles(lat, lng, pLat, pLng) : null;
        const category = categorizePermit(
          r.permittypemapped ?? "",
          r.permittypedesc ?? "",
          r.description ?? ""
        );

        return {
          permitNumber: r.permitnum ?? "",
          address: [r.originaladdress1, r.originalcity].filter(Boolean).join(", "),
          permitType: r.permittypemapped ?? "",
          description: r.description ?? "",
          issuedDate: r.issueddate ? r.issueddate.slice(0, 10) : null,
          status: r.statuscurrent ?? "",
          estimatedValue: r.estprojectcost ? parseFloat(r.estprojectcost) : null,
          latitude: pLat,
          longitude: pLng,
          distanceMiles: dist != null ? Math.round(dist * 100) / 100 : null,
          category,
        };
      })
      // Only surface supply-relevant permit types
      .filter((p) =>
        p.category === "new_construction" ||
        p.category === "adu" ||
        p.category === "addition" ||
        p.category === "demo" ||
        p.category === "renovation"
      )
      .sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

    const newConstruction = permits.filter((p) => p.category === "new_construction").length;
    const adu = permits.filter((p) => p.category === "adu").length;
    const additions = permits.filter((p) => p.category === "addition").length;
    const renovations = permits.filter((p) => p.category === "renovation").length;
    const demolitions = permits.filter((p) => p.category === "demo").length;
    const total = permits.length;

    const competitiveSupplyScore = computeCompetitiveScore(permits, lookbackDays);
    const competitiveSupplyLabel: PermitRadarResult["summary"]["competitiveSupplyLabel"] =
      competitiveSupplyScore >= 60 ? "High" : competitiveSupplyScore >= 30 ? "Medium" : "Low";
    const recentActivity: PermitRadarResult["summary"]["recentActivity"] =
      total >= 10 ? "high" : total >= 4 ? "medium" : "low";

    return NextResponse.json({
      permits: permits.slice(0, 50),
      summary: {
        total,
        newConstruction,
        adu,
        additions,
        renovations,
        demolitions,
        recentActivity,
        competitiveSupplyScore,
        competitiveSupplyLabel,
        radiusMiles,
        lookbackDays,
      },
      source: "seattle_open_data",
    } satisfies PermitRadarResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Permit radar error:", msg);
    return NextResponse.json(emptyResult(radiusMiles, lookbackDays, "unavailable", msg));
  }
}
