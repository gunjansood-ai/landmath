import { NextRequest, NextResponse } from "next/server";

/**
 * Aggregated property lookup: takes lat/lng and fetches data from
 * King County GIS (parcel + zoning) + King County Assessor.
 * Runs server-side so we can call external APIs freely.
 */

const KC_PARCELS =
  "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_Parcels/MapServer/0/query";
const KC_ZONING =
  "https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/planning__zoning_area/MapServer/450/query";

async function queryArcGIS(baseUrl: string, lat: number, lng: number) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });

  const res = await fetch(`${baseUrl}?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.features?.[0]?.attributes ?? null;
}

async function getAssessorDetails(pin: string) {
  try {
    // Use the KC Assessor API endpoint for parcel detail
    const res = await fetch(
      `https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr=${pin}`,
      { next: { revalidate: 86400 } } // cache 24h
    );
    if (!res.ok) return null;
    const html = await res.text();

    // Extract data from the HTML
    const extract = (pattern: RegExp): string => {
      const m = html.match(pattern);
      return m?.[1]?.trim() ?? "";
    };

    return {
      sqftLiving: parseInt(extract(/SqFtTotLiving.*?>([\d,]+)/i).replace(/,/g, "")) || 0,
      yearBuilt: parseInt(extract(/YrBuilt.*?>(\d{4})/i)) || 0,
      bedrooms: parseInt(extract(/Bedrooms.*?>(\d+)/i)) || 0,
      bathrooms: parseFloat(extract(/BathFullCount.*?>(\d+)/i)) || 0,
      stories: parseFloat(extract(/Stories.*?>([\d.]+)/i)) || 1,
      totalValue: parseInt(extract(/ApprTotalValue.*?>([\d,]+)/i).replace(/,/g, "")) || 0,
      landValue: parseInt(extract(/ApprLandValue.*?>([\d,]+)/i).replace(/,/g, "")) || 0,
      impValue: parseInt(extract(/ApprImpsValue.*?>([\d,]+)/i).replace(/,/g, "")) || 0,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  // Parallel: parcel + zoning
  const [parcel, zoning] = await Promise.all([
    queryArcGIS(KC_PARCELS, lat, lng),
    queryArcGIS(KC_ZONING, lat, lng),
  ]);

  let assessor = null;
  if (parcel?.PIN) {
    assessor = await getAssessorDetails(parcel.PIN);
  }

  return NextResponse.json({
    parcel: parcel
      ? {
          pin: parcel.PIN,
          major: parcel.MAJOR,
          minor: parcel.MINOR,
          lotSizeSqft: Math.round(parcel["Shape.STArea()"] ?? 0),
        }
      : null,
    zoning: zoning
      ? {
          currentZone: zoning.CURRZONE ?? "Unknown",
          potentialZone: zoning.POTENTIAL ?? "",
        }
      : null,
    assessor,
  });
}
