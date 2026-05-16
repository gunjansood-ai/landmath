import { NextRequest, NextResponse } from "next/server";

/**
 * Aggregated property lookup: takes lat/lng and fetches data from
 * King County GIS PropertyInfo service (rich parcel data + recent sales).
 *
 * Data sources:
 * - Layer 2: Parcels — lot size, appraised values, zoning, present use, property type
 * - Layer 3: Property sales in the last 3 years — actual market sale prices
 * - Fallback: KC Assessor HTML scrape for building details (sqft, beds, baths, year built)
 */

const KC_PROPERTY_INFO =
  "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer";

/** Query a PropertyInfo layer by point (uses simple x,y format with inSR=4326) */
async function queryPropertyInfo(
  layerId: number,
  lat: number,
  lng: number,
  outFields: string,
  extraParams?: Record<string, string>
) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    f: "json",
    ...extraParams,
  });

  const res = await fetch(`${KC_PROPERTY_INFO}/${layerId}/query?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.features?.map((f: { attributes: Record<string, unknown> }) => f.attributes) ?? [];
}

/** Get nearby residential sales (800m radius) for market price estimation */
async function getNearbySales(lat: number, lng: number) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: "800",
    units: "esriSRUnit_Meter",
    where: "SalePrice > 100000 AND Principal_Use LIKE '%RESIDENTIAL%'",
    outFields: "PIN,address,SaleDate,SalePrice,Property_Type,Principal_Use",
    returnGeometry: "false",
    orderByFields: "SaleDate DESC",
    resultRecordCount: "10",
    f: "json",
  });

  const res = await fetch(`${KC_PROPERTY_INFO}/3/query?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.features?.map((f: { attributes: Record<string, unknown> }) => f.attributes) ?? [];
}

/** Scrape KC Assessor for building details (sqft, beds, baths, year) */
async function getAssessorDetails(pin: string) {
  try {
    const res = await fetch(
      `https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr=${pin}`,
      { next: { revalidate: 86400 } }
    );
    if (!res.ok) return null;
    const html = await res.text();

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

  // Parallel: parcel info + nearby sales
  const [parcelResults, sales] = await Promise.all([
    queryPropertyInfo(
      2,
      lat,
      lng,
      "PIN,ADDR_FULL,CTYNAME,POSTALCTYNAME,LOTSQFT,APPRLNDVAL,APPR_IMPR,KCA_ZONING,KCA_ACRES,PREUSE_CODE,PREUSE_DESC,PROPTYPE"
    ),
    getNearbySales(lat, lng),
  ]);

  const parcel = parcelResults[0] ?? null;

  // Get building details from assessor if we have a PIN
  let assessor = null;
  if (parcel?.PIN) {
    assessor = await getAssessorDetails(parcel.PIN);
  }

  // Calculate market estimate from nearby sales
  let marketEstimate: number | null = null;
  if (sales.length > 0) {
    const validSales = sales.filter(
      (s: Record<string, unknown>) => (s.SalePrice as number) > 100000
    );
    if (validSales.length > 0) {
      // Use median of recent sales as market reference
      const prices = validSales
        .map((s: Record<string, unknown>) => s.SalePrice as number)
        .sort((a: number, b: number) => a - b);
      marketEstimate = prices[Math.floor(prices.length / 2)];
    }
  }

  return NextResponse.json({
    parcel: parcel
      ? {
          pin: parcel.PIN,
          address: parcel.ADDR_FULL,
          city: (parcel.CTYNAME as string)?.trim() || (parcel.POSTALCTYNAME as string)?.trim(),
          lotSizeSqft: parcel.LOTSQFT || Math.round((parcel.KCA_ACRES || 0) * 43560),
          appraisedLandValue: parcel.APPRLNDVAL || 0,
          appraisedImpValue: parcel.APPR_IMPR || 0,
          appraisedTotal: (parcel.APPRLNDVAL || 0) + (parcel.APPR_IMPR || 0),
          zoningCode: (parcel.KCA_ZONING as string)?.trim() || null,
          presentUseCode: parcel.PREUSE_CODE,
          presentUse: (parcel.PREUSE_DESC as string)?.trim() || null,
          propertyType: parcel.PROPTYPE, // R=residential, C=commercial, K=condo
        }
      : null,
    sales: sales.slice(0, 5).map((s: Record<string, unknown>) => ({
      address: s.address,
      salePrice: s.SalePrice,
      saleDate: s.SaleDate,
      principalUse: s.Principal_Use,
    })),
    marketEstimate,
    assessor,
  });
}
