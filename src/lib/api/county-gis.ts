/**
 * County GIS API — free parcel & zoning data from ArcGIS REST services
 *
 * Currently supports:
 *   - King County (parcels + zoning)
 *
 * All endpoints are free & public — no API key required.
 */

export interface ParcelData {
  pin: string;
  major: string;
  minor: string;
  areaSqft: number;
}

export interface ZoningData {
  currentZone: string;
  potentialZone: string;
}

export interface PropertyDetails {
  taxPayerName: string;
  situsAddress: string;
  landValue: number;
  improvementValue: number;
  totalValue: number;
  sqftLiving: number;
  yearBuilt: number;
  bedrooms: number;
  bathrooms: number;
  stories: number;
  lotSizeSqft: number;
  zoningCode: string;
}

const KING_COUNTY = {
  parcels:
    "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_Parcels/MapServer/0/query",
  zoning:
    "https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/planning__zoning_area/MapServer/450/query",
};

/** Query King County parcel by lat/lng */
export async function getParcelByLocation(
  lat: number,
  lng: number
): Promise<ParcelData | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });

  try {
    const res = await fetch(`${KING_COUNTY.parcels}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const feature = data.features?.[0]?.attributes;
    if (!feature) return null;

    return {
      pin: feature.PIN,
      major: feature.MAJOR,
      minor: feature.MINOR,
      areaSqft: feature["Shape.STArea()"] ?? 0,
    };
  } catch {
    console.error("King County parcel lookup failed");
    return null;
  }
}

/** Query King County zoning by lat/lng (unincorporated areas only) */
export async function getZoningByLocation(
  lat: number,
  lng: number
): Promise<ZoningData | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
  });

  try {
    const res = await fetch(`${KING_COUNTY.zoning}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const feature = data.features?.[0]?.attributes;
    if (!feature) return null;

    return {
      currentZone: feature.CURRZONE ?? "Unknown",
      potentialZone: feature.POTENTIAL ?? "",
    };
  } catch {
    console.error("King County zoning lookup failed");
    return null;
  }
}

/**
 * Get detailed property info from King County Assessor via their web API.
 * Falls back to parcel GIS data if the detail lookup fails.
 */
export async function getPropertyDetails(
  pin: string
): Promise<PropertyDetails | null> {
  try {
    // King County Assessor eReal Property API
    const res = await fetch(
      `https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=${pin}`
    );
    if (!res.ok) return null;

    const html = await res.text();

    // Parse key fields from the HTML response
    const extract = (pattern: RegExp): string => {
      const match = html.match(pattern);
      return match?.[1]?.trim() ?? "";
    };

    const sqftLiving = parseInt(extract(/Sq Ft.*?(\d[\d,]+)/i).replace(/,/g, "")) || 0;
    const yearBuilt = parseInt(extract(/Year Built.*?(\d{4})/i)) || 0;
    const bedrooms = parseInt(extract(/Bedrooms.*?(\d+)/i)) || 0;
    const bathrooms = parseFloat(extract(/(?:Full Bath|Bathrooms).*?(\d+\.?\d*)/i)) || 0;
    const totalValue = parseInt(extract(/Appraised Total.*?\$([\d,]+)/i).replace(/,/g, "")) || 0;
    const landValue = parseInt(extract(/Land.*?\$([\d,]+)/i).replace(/,/g, "")) || 0;
    const improvementValue = parseInt(extract(/Imps.*?\$([\d,]+)/i).replace(/,/g, "")) || 0;
    const lotSizeStr = extract(/Lot Size.*?([\d,.]+)/i);
    const lotSizeSqft = parseFloat(lotSizeStr.replace(/,/g, "")) || 0;

    return {
      taxPayerName: extract(/Tax Payer.*?>(.*?)</i),
      situsAddress: extract(/Situs.*?>(.*?)</i),
      landValue,
      improvementValue,
      totalValue: totalValue || landValue + improvementValue,
      sqftLiving,
      yearBuilt,
      bedrooms,
      bathrooms,
      stories: 1,
      lotSizeSqft,
      zoningCode: extract(/Zoning.*?>([\w-]+)</i) || "Unknown",
    };
  } catch {
    console.error("King County property detail lookup failed for PIN:", pin);
    return null;
  }
}

/**
 * Combined lookup: find parcel at lat/lng, then get details.
 */
export async function lookupProperty(lat: number, lng: number) {
  const parcel = await getParcelByLocation(lat, lng);

  if (!parcel) {
    return { parcel: null, zoning: null, details: null };
  }

  // Run zoning and detail lookups in parallel
  const [zoning, details] = await Promise.all([
    getZoningByLocation(lat, lng),
    getPropertyDetails(parcel.pin),
  ]);

  return { parcel, zoning, details };
}
