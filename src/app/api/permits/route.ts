import { NextRequest, NextResponse } from "next/server";

/**
 * Permit Radar — queries KC GIS building permit layers for activity
 * near a subject property. Returns recent new-construction and
 * renovation permits within a 1-mile radius.
 *
 * KC Open Data permit endpoints:
 *   - Residential Building Permits (King County unincorporated + cities)
 *   - Uses KingCo_PropertyInfo layer 4 (permit activity)
 *
 * Falls back gracefully if the layer is unavailable.
 */

// KC GIS – PropertyInfo service layers
const KC_PROPERTY_INFO = "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer";

// KC Open Data Portal – residential permits
const KC_PERMITS_URL =
  "https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/permits__residential_permits/MapServer/0/query";

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
    competitiveSupplyScore: number; // 0–100, higher = more competing supply
    competitiveSupplyLabel: "Low" | "Medium" | "High";
    radiusMiles: number;
    lookbackDays: number;
  };
  source: "kc_gis" | "unavailable";
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

function categorizePermit(type: string, desc: string): PermitRecord["category"] {
  const t = (type ?? "").toLowerCase();
  const d = (desc ?? "").toLowerCase();
  const combined = `${t} ${d}`;

  if (combined.includes("demo") || combined.includes("demolit")) return "demo";
  if (combined.includes("adu") || combined.includes("accessory dwelling") || combined.includes("accessory unit")) return "adu";
  if (combined.includes("new") && (combined.includes("single family") || combined.includes("sfr") || combined.includes("residence") || combined.includes("dwelling"))) return "new_construction";
  if (combined.includes("addition") || combined.includes("expand") || combined.includes("square footage")) return "addition";
  if (combined.includes("remodel") || combined.includes("renovate") || combined.includes("repair") || combined.includes("replace")) return "renovation";
  if (combined.includes("new construct") || combined.includes("new home") || combined.includes("build")) return "new_construction";

  return "other";
}

function computeCompetitiveScore(permits: PermitRecord[], lookbackDays: number): number {
  // Weight: new construction & ADU are direct supply competitors
  const newConst = permits.filter((p) => p.category === "new_construction").length;
  const adu = permits.filter((p) => p.category === "adu").length;
  const additions = permits.filter((p) => p.category === "addition").length;

  // Per 90-day equivalent rate (normalize to 90-day window)
  const daysFactor = 90 / lookbackDays;
  const weightedCount = (newConst * 3 + adu * 2 + additions * 1) * daysFactor;

  // Score: 0 = no competition, 100 = heavy competition
  // Calibrated: >10 new construction permits in 90 days = 100 (very high)
  const score = Math.min(100, Math.round((weightedCount / 10) * 100));
  return score;
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
  const radiusMiles = parseFloat(req.nextUrl.searchParams.get("radius") ?? "1.0");
  const lookbackDays = parseInt(req.nextUrl.searchParams.get("days") ?? "90");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  // Convert radius to meters for ArcGIS
  const radiusM = Math.round(radiusMiles * 1609.34);

  // Lookback date in MS
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  try {
    // ── Try KC Open Data Portal permits layer ─────────────────────────────
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      distance: radiusM.toString(),
      units: "esriSRUnit_Meter",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
      resultRecordCount: "200",
      orderByFields: "IssuedDate DESC",
    });

    let permits: PermitRecord[] = [];
    let source: PermitRadarResult["source"] = "unavailable";

    const res = await fetch(`${KC_PERMITS_URL}?${params}`, {
      next: { revalidate: 3600 }, // cache 1 hr
    });

    if (res.ok) {
      const data = await res.json();
      const features = data.features ?? [];

      permits = features
        .filter((f: Record<string, unknown>) => {
          const attrs = f.attributes as Record<string, unknown>;
          // Filter to within lookback window
          const issuedTs = attrs.IssuedDate ? Number(attrs.IssuedDate) : null;
          if (issuedTs && issuedTs < cutoffMs) return false;
          return true;
        })
        .map((f: Record<string, unknown>): PermitRecord => {
          const attrs = f.attributes as Record<string, unknown>;
          const geo = f.geometry as { x?: number; y?: number } | null;
          const pLat = geo?.y ?? null;
          const pLng = geo?.x ?? null;
          const issuedTs = attrs.IssuedDate ? new Date(Number(attrs.IssuedDate)).toISOString().slice(0, 10) : null;
          const permitType = String(attrs.PermitType ?? attrs.PermitCategory ?? "");
          const desc = String(attrs.Description ?? attrs.WorkDescription ?? "");
          const dist =
            pLat && pLng ? haversineMiles(lat, lng, pLat, pLng) : null;

          return {
            permitNumber: String(attrs.PermitNumber ?? attrs.ApplNum ?? ""),
            address: String(attrs.Address ?? attrs.SitusAddress ?? ""),
            permitType,
            description: desc,
            issuedDate: issuedTs,
            status: String(attrs.StatusCurrent ?? attrs.Status ?? ""),
            estimatedValue: typeof attrs.EstimatedValue === "number" ? attrs.EstimatedValue : null,
            latitude: pLat,
            longitude: pLng,
            distanceMiles: dist ? Math.round(dist * 100) / 100 : null,
            category: categorizePermit(permitType, desc),
          };
        })
        .filter((p: PermitRecord) =>
          p.category === "new_construction" ||
          p.category === "adu" ||
          p.category === "addition" ||
          p.category === "demo" ||
          p.category === "renovation"
        )
        .sort((a: PermitRecord, b: PermitRecord) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));

      source = "kc_gis";
    }

    // ── Fallback: try PropertyInfo layer for permit-like activity ─────────
    if (permits.length === 0 && source === "unavailable") {
      // Try layer 4 of PropertyInfo if it exists (permit records)
      const fallbackParams = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: radiusM.toString(),
        units: "esriSRUnit_Meter",
        outFields: "PIN,ADDR_FULL,PREUSE_DESC,LOTSQFT",
        returnGeometry: "false",
        f: "json",
        where: "PROPTYPE = 'R'",
        resultRecordCount: "50",
      });

      const fallbackRes = await fetch(
        `${KC_PROPERTY_INFO}/2/query?${fallbackParams}`
      );
      if (fallbackRes.ok) {
        // We have parcel data — no real permit data, report graceful unavailability
        source = "unavailable";
      }
    }

    // ── Build summary ─────────────────────────────────────────────────────
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

    const result: PermitRadarResult = {
      permits: permits.slice(0, 50), // cap payload
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
      source,
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Permit radar error:", msg);

    // Return a graceful empty response — never hard-fail the property page
    return NextResponse.json({
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
      source: "unavailable",
      error: msg,
    } satisfies PermitRadarResult);
  }
}
