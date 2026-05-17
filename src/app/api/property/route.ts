import { NextRequest, NextResponse } from "next/server";
import {
  ADAPTIVE_RADII_M,
  MIN_PARCELS_FOR_TYPOLOGY,
  TREND_LOOKBACK_MONTHS,
  bucketParcelByPreuse,
  computeTypologyDistribution,
  type Comp,
  type NeighborhoodData,
  type ParcelSample,
  type TypologyBucket,
} from "@/lib/buildability";

/**
 * Aggregated property lookup. Takes lat/lng and returns:
 *   - parcel: subject parcel data (PropertyInfo layer 2)
 *   - sales: top recent sales (PropertyInfo layer 3) — kept for back-compat
 *   - marketEstimate: median of recent sales (kept for back-compat)
 *   - assessor: subject's building details (sqft, beds, baths, year)
 *   - neighborhood: NEW — adaptive-radius typology + cited comps (with sqft + drill-in URLs)
 */

const KC_PROPERTY_INFO =
  "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer";

const KC_ASSESSOR_DETAIL = (pin: string) =>
  `https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=${pin}`;
const KC_PARCEL_VIEWER = (pin: string) =>
  `https://gismaps.kingcounty.gov/parcelviewer2/?pin=${pin}`;

// ─────────────────────────────────────────────────────────────────────────────
// PropertyInfo helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyInfoFeature {
  attributes: Record<string, unknown>;
}

async function queryPropertyInfoPoint(
  layerId: number,
  lat: number,
  lng: number,
  outFields: string,
  extraParams: Record<string, string> = {}
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
  return (data.features ?? []).map((f: PropertyInfoFeature) => f.attributes);
}

async function queryNearbyParcels(lat: number, lng: number, radiusM: number) {
  return queryPropertyInfoPoint(
    2,
    lat,
    lng,
    "PIN,ADDR_FULL,PREUSE_DESC,LOTSQFT",
    {
      distance: radiusM.toString(),
      units: "esriSRUnit_Meter",
      where: "PROPTYPE = 'R'",
      resultRecordCount: "200",
    }
  );
}

async function queryNearbySales(lat: number, lng: number, radiusM: number) {
  return queryPropertyInfoPoint(
    3,
    lat,
    lng,
    "PIN,address,SaleDate,SalePrice,Property_Type,Principal_Use",
    {
      distance: radiusM.toString(),
      units: "esriSRUnit_Meter",
      where: "SalePrice > 100000",
      orderByFields: "SaleDate DESC",
      resultRecordCount: "30",
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Assessor scrape (single + batch)
// ─────────────────────────────────────────────────────────────────────────────

interface AssessorBits {
  sqftLiving: number;
  yearBuilt: number;
  bedrooms: number;
  bathrooms: number;
  stories: number;
}

async function getAssessorDetails(pin: string): Promise<AssessorBits | null> {
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

// Limit concurrent assessor fetches so we don't hammer KC.
async function fetchAssessorBatch(pins: string[]): Promise<Record<string, AssessorBits | null>> {
  const out: Record<string, AssessorBits | null> = {};
  const CONCURRENCY = 5;
  for (let i = 0; i < pins.length; i += CONCURRENCY) {
    const chunk = pins.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((p) => getAssessorDetails(p)));
    chunk.forEach((pin, idx) => (out[pin] = results[idx]));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Neighborhood assembly
// ─────────────────────────────────────────────────────────────────────────────

function monthsAgo(months: number): number {
  return Date.now() - months * 30 * 24 * 60 * 60 * 1000;
}

function parseSaleDate(value: unknown): number {
  if (typeof value === "number") return value; // KC layer 3 returns epoch ms
  if (typeof value === "string") {
    const t = Date.parse(value);
    return isNaN(t) ? 0 : t;
  }
  return 0;
}

interface RawParcel {
  PIN: string;
  ADDR_FULL?: string;
  PREUSE_DESC?: string;
  LOTSQFT?: number;
}

interface RawSale {
  PIN: string;
  address?: string;
  SaleDate?: number | string;
  SalePrice?: number;
  Property_Type?: string;
  Principal_Use?: string;
}

async function buildNeighborhood(
  lat: number,
  lng: number,
  subjectPin: string | null,
  subjectCity: string | null
): Promise<NeighborhoodData> {
  // 1. Adaptive radius for typology (parcels)
  let parcels: RawParcel[] = [];
  let radiusM = ADAPTIVE_RADII_M[ADAPTIVE_RADII_M.length - 1];
  for (const r of ADAPTIVE_RADII_M) {
    parcels = (await queryNearbyParcels(lat, lng, r)) as RawParcel[];
    if (parcels.length >= MIN_PARCELS_FOR_TYPOLOGY) {
      radiusM = r;
      break;
    }
    radiusM = r;
  }

  // Exclude the subject parcel from typology counts.
  const otherParcels = subjectPin
    ? parcels.filter((p) => p.PIN && p.PIN !== subjectPin)
    : parcels;

  const parcelSamples: ParcelSample[] = otherParcels.map((p): ParcelSample => ({
    pin: p.PIN,
    address: p.ADDR_FULL ?? null,
    presentUse: p.PREUSE_DESC ?? null,
    typology: bucketParcelByPreuse(p.PREUSE_DESC),
    lotSizeSqft: typeof p.LOTSQFT === "number" ? p.LOTSQFT : undefined,
    sourceUrl: KC_ASSESSOR_DETAIL(p.PIN),
  }));

  const typology = computeTypologyDistribution(parcelSamples);

  // 2. Sales (always 800m for citation list; radius is for typology only)
  const salesRaw = ((await queryNearbySales(lat, lng, 800)) as RawSale[]).filter(
    (s) => s.PIN && s.SalePrice && (s.SalePrice as number) > 100000
  );

  // Citation list: top 10, sorted newest first (already by query).
  const topSales = salesRaw.slice(0, 10);

  // 3. Fetch assessor sqft for the citation sales (parallel, capped).
  const assessorByPin = await fetchAssessorBatch(topSales.map((s) => s.PIN));

  const sales: Comp[] = topSales.map((s): Comp => {
    const ab = assessorByPin[s.PIN];
    const sqft = ab?.sqftLiving;
    const typo = bucketParcelByPreuse(s.Principal_Use);
    const salePrice = Number(s.SalePrice ?? 0);
    return {
      pin: s.PIN,
      address: s.address ?? "Unknown",
      salePrice,
      saleDate: typeof s.SaleDate === "number"
        ? new Date(s.SaleDate).toISOString().slice(0, 10)
        : String(s.SaleDate ?? ""),
      principalUse: s.Principal_Use ?? "",
      typology: typo,
      sqftLiving: sqft && sqft > 200 ? sqft : undefined,
      pricePerSqft: sqft && sqft > 200 && salePrice ? Math.round(salePrice / sqft) : undefined,
      sourceUrl: KC_ASSESSOR_DETAIL(s.PIN),
      parcelViewerUrl: KC_PARCEL_VIEWER(s.PIN),
    };
  });

  // 4. Trend signal: recent non-SFR sales in last 24 months.
  const trendCutoff = monthsAgo(TREND_LOOKBACK_MONTHS);
  const recentMultiUnitCount = salesRaw.filter((s) => {
    const t = parseSaleDate(s.SaleDate);
    if (t < trendCutoff) return false;
    const bucket = bucketParcelByPreuse(s.Principal_Use);
    return (
      bucket === "duplex" ||
      bucket === "triplex" ||
      bucket === "fourplex" ||
      bucket === "five_plus" ||
      bucket === "sfr_with_adu"
    );
  }).length;

  // 5. Home-size stats from the cited sales (only ones with assessor sqft).
  const homeSqfts = sales
    .map((c) => c.sqftLiving)
    .filter((v): v is number => typeof v === "number" && v > 200)
    .sort((a, b) => a - b);

  const pct = (p: number) =>
    homeSqfts.length === 0
      ? null
      : homeSqfts[Math.min(homeSqfts.length - 1, Math.floor(homeSqfts.length * p))];

  const lotSqfts = parcelSamples
    .map((p) => p.lotSizeSqft)
    .filter((v): v is number => typeof v === "number" && v > 0)
    .sort((a, b) => a - b);
  const medianLotSqft = lotSqfts.length
    ? lotSqfts[Math.floor(lotSqfts.length / 2)]
    : null;

  return {
    radiusM,
    parcelCount: parcelSamples.length,
    parcels: parcelSamples.slice(0, 60), // cap payload
    sales,
    typology,
    recentMultiUnitCount,
    medianHomeSqft: pct(0.5),
    p25HomeSqft: pct(0.25),
    p75HomeSqft: pct(0.75),
    medianLotSqft,
    isSparse: parcelSamples.length < MIN_PARCELS_FOR_TYPOLOGY,
    sourceCity: subjectCity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handler
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
  const lng = parseFloat(req.nextUrl.searchParams.get("lng") ?? "");

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: "lat and lng required" }, { status: 400 });
  }

  // Subject parcel + initial sales (back-compat).
  const parcelResults = (await queryPropertyInfoPoint(
    2,
    lat,
    lng,
    "PIN,ADDR_FULL,CTYNAME,POSTALCTYNAME,LOTSQFT,APPRLNDVAL,APPR_IMPR,KCA_ZONING,KCA_ACRES,PREUSE_CODE,PREUSE_DESC,PROPTYPE"
  )) as Array<Record<string, unknown>>;
  const parcel = parcelResults[0] ?? null;

  const subjectPin = (parcel?.PIN as string) ?? null;
  const subjectCity =
    ((parcel?.CTYNAME as string)?.trim() ||
      (parcel?.POSTALCTYNAME as string)?.trim()) ?? null;

  // Run assessor lookup + neighborhood assembly in parallel.
  const [assessor, neighborhood] = await Promise.all([
    subjectPin ? getAssessorDetails(subjectPin) : Promise.resolve(null),
    buildNeighborhood(lat, lng, subjectPin, subjectCity),
  ]);

  // Back-compat: keep `sales` and `marketEstimate` at the top level.
  const marketEstimate =
    neighborhood.sales.length > 0
      ? (() => {
          const prices = neighborhood.sales
            .map((s) => s.salePrice)
            .sort((a, b) => a - b);
          return prices[Math.floor(prices.length / 2)];
        })()
      : null;

  return NextResponse.json({
    parcel: parcel
      ? {
          pin: parcel.PIN,
          address: parcel.ADDR_FULL,
          city: subjectCity,
          lotSizeSqft:
            (parcel.LOTSQFT as number) ||
            Math.round(((parcel.KCA_ACRES as number) || 0) * 43560),
          appraisedLandValue: (parcel.APPRLNDVAL as number) || 0,
          appraisedImpValue: (parcel.APPR_IMPR as number) || 0,
          appraisedTotal:
            ((parcel.APPRLNDVAL as number) || 0) + ((parcel.APPR_IMPR as number) || 0),
          zoningCode: (parcel.KCA_ZONING as string)?.trim() || null,
          presentUseCode: parcel.PREUSE_CODE,
          presentUse: (parcel.PREUSE_DESC as string)?.trim() || null,
          propertyType: parcel.PROPTYPE,
          assessorUrl: subjectPin ? KC_ASSESSOR_DETAIL(subjectPin) : null,
          parcelViewerUrl: subjectPin ? KC_PARCEL_VIEWER(subjectPin) : null,
        }
      : null,
    sales: neighborhood.sales.slice(0, 5).map((c) => ({
      address: c.address,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      principalUse: c.principalUse,
    })),
    marketEstimate,
    assessor,
    neighborhood,
  });
}

export type { TypologyBucket };
