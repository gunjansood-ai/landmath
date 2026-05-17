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

const RENTCAST_KEY = process.env.RENTCAST_API_KEY;

// ─── RentCast comps (real sqft + yearBuilt; KC Assessor HTML is AJAX-only) ───
//
// IMPORTANT: KC Assessor's Dashboard.aspx / Detail.aspx are ASP.NET WebForms
// pages that load all property data via __VIEWSTATE postback. The raw HTML
// contains zero useful data — sqft, yearBuilt, beds, baths are all blank.
// So we use RentCast (free tier 50 calls/mo) for cited comp enrichment.

interface RentCastListing {
  formattedAddress?: string;
  price?: number;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  yearBuilt?: number;
  listedDate?: string;
  removedDate?: string;
  lastSeenDate?: string;
  distance?: number;
  propertyType?: string;
  latitude?: number;
  longitude?: number;
}

interface RentCastFetchResult {
  comps: RentCastListing[];
  status: "ok" | "no_key" | "http_error" | "exception";
  httpStatus?: number;
}

async function fetchRentCastSoldComps(
  lat: number,
  lng: number
): Promise<RentCastFetchResult> {
  if (!RENTCAST_KEY || RENTCAST_KEY === "your_rentcast_api_key_here") {
    return { comps: [], status: "no_key" };
  }
  // Pull SOLD listings within 1.5 miles, last 24 months. Bigger radius +
  // higher limit gives us enough new-construction comps to filter to.
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    radius: "1.5",
    propertyType: "Single Family",
    status: "Sold",
    limit: "50",
    daysOld: "730",
  });
  try {
    const res = await fetch(
      `https://api.rentcast.io/v1/listings/sale?${params}`,
      {
        headers: { accept: "application/json", "X-Api-Key": RENTCAST_KEY },
        next: { revalidate: 86400 },
      }
    );
    if (!res.ok) {
      console.error("RentCast comps error:", res.status);
      return { comps: [], status: "http_error", httpStatus: res.status };
    }
    const data = await res.json();
    return { comps: Array.isArray(data) ? data : [], status: "ok" };
  } catch (err) {
    console.error("RentCast fetch failed:", err);
    return { comps: [], status: "exception" };
  }
}

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

// NOTE: fetchAssessorBatch removed — KC Assessor HTML is AJAX-loaded and
// returns no useful raw HTML for sqft/yearBuilt. RentCast (see fetchRentCastSoldComps)
// is now the source of truth for comp enrichment. The single-property
// getAssessorDetails above is retained for the subject (best-effort only).

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

  // 2. Sales — adaptive radius to ensure enough comp pool for strategy filtering.
  //    Start 800m; widen to 1200m if <15 raw comps; 1609m (1 mile) if still <10.
  //    Strategy-aware filtering on the client will narrow this pool further.
  let salesRaw = ((await queryNearbySales(lat, lng, 800)) as RawSale[]).filter(
    (s) => s.PIN && s.SalePrice && (s.SalePrice as number) > 100000
  );
  if (salesRaw.length < 15) {
    const wider = ((await queryNearbySales(lat, lng, 1200)) as RawSale[]).filter(
      (s) => s.PIN && s.SalePrice && (s.SalePrice as number) > 100000
    );
    if (wider.length > salesRaw.length) salesRaw = wider;
  }
  if (salesRaw.length < 10) {
    const widest = ((await queryNearbySales(lat, lng, 1609)) as RawSale[]).filter(
      (s) => s.PIN && s.SalePrice && (s.SalePrice as number) > 100000
    );
    if (widest.length > salesRaw.length) salesRaw = widest;
  }

  // Citation pool: top 20 so strategy filters have enough to bite into;
  // UI defaults to showing 10 but can drill in.
  const topSales = salesRaw.slice(0, 20);

  // 3. RentCast comps — primary source of $/sqft data (has real sqft + yearBuilt).
  //    KC Assessor HTML can't be scraped; KC layer 3 sales lack sqft. RentCast it is.
  const rentCastResult = await fetchRentCastSoldComps(lat, lng);
  const rentCastComps = rentCastResult.comps;

  // Build a KC-address-keyed map so we can enrich RentCast comps with a KC PIN
  // for drill-in (best effort — many won't match, that's OK).
  const normalizeAddr = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  const kcByStreet = new Map<string, RawSale>();
  for (const s of salesRaw) {
    if (s.address) {
      // KC address may be "10728 NE 26TH ST" or "10728 NE 26TH ST BELLEVUE WA".
      // Extract just the leading number + street tokens up to first city-ish word.
      const streetMatch = s.address.match(/^(\d+[^A-Z]*(?:[A-Z]+\s*)+?(?:ST|AVE|DR|RD|PL|CT|LN|WAY|BLVD|PKWY|LOOP|TER)\b)/i);
      const street = streetMatch ? streetMatch[1].trim() : s.address.split(/\s{2,}|,/)[0];
      kcByStreet.set(normalizeAddr(street), s);
    }
  }

  const findKcMatch = (rcAddress: string): RawSale | undefined => {
    const streetOnly = rcAddress.split(",")[0]?.trim() ?? "";
    return kcByStreet.get(normalizeAddr(streetOnly));
  };

  // Build the cited-comp set FROM RentCast (every comp has sqft + yearBuilt).
  const rentCastSales: Comp[] = rentCastComps
    .filter((r) => r.formattedAddress && r.price && r.price > 100000)
    .map((r): Comp => {
      const sqft = r.squareFootage && r.squareFootage > 200 ? r.squareFootage : undefined;
      const yearBuilt = r.yearBuilt && r.yearBuilt > 1800 ? r.yearBuilt : undefined;
      const saleDate = r.lastSeenDate || r.removedDate || r.listedDate || "";
      const saleTs = Date.parse(saleDate);
      const saleYear = !isNaN(saleTs)
        ? new Date(saleTs).getFullYear()
        : new Date().getFullYear();
      // Widened from 5 to 10 years. A 2016 build sold in 2024 is still a
      // valid "new construction" comp for valuation purposes — the home
      // presents as modern and prices accordingly.
      const isNewConstructionAtSale =
        yearBuilt !== undefined && yearBuilt >= saleYear - 10;
      // Best-effort KC enrichment for drill-in URL.
      const kc = findKcMatch(r.formattedAddress ?? "");
      return {
        pin: kc?.PIN ?? "",
        address: r.formattedAddress ?? "Unknown",
        salePrice: r.price ?? 0,
        saleDate: saleDate ? saleDate.slice(0, 10) : "",
        principalUse: r.propertyType ?? "Single Family",
        typology: "sfr",
        sqftLiving: sqft,
        yearBuilt,
        isNewConstructionAtSale,
        pricePerSqft: sqft && r.price ? Math.round(r.price / sqft) : undefined,
        sourceUrl: kc?.PIN
          ? KC_ASSESSOR_DETAIL(kc.PIN)
          : `https://www.redfin.com/?q=${encodeURIComponent(r.formattedAddress ?? "")}`,
        parcelViewerUrl: kc?.PIN ? KC_PARCEL_VIEWER(kc.PIN) : undefined,
      };
    });

  // KC fallback comps — used only when RentCast returned nothing. No sqft data
  // means these won't contribute to ppsf median, but they're cited for visibility.
  const kcFallbackSales: Comp[] = topSales.map((s): Comp => {
    const salePrice = Number(s.SalePrice ?? 0);
    return {
      pin: s.PIN,
      address: s.address ?? "Unknown",
      salePrice,
      saleDate:
        typeof s.SaleDate === "number"
          ? new Date(s.SaleDate).toISOString().slice(0, 10)
          : String(s.SaleDate ?? ""),
      principalUse: s.Principal_Use ?? "",
      typology: bucketParcelByPreuse(s.Principal_Use),
      sqftLiving: undefined,
      yearBuilt: undefined,
      isNewConstructionAtSale: false,
      pricePerSqft: undefined,
      sourceUrl: KC_ASSESSOR_DETAIL(s.PIN),
      parcelViewerUrl: KC_PARCEL_VIEWER(s.PIN),
    };
  });

  // RentCast primary; KC fallback only if RentCast is empty.
  const sales: Comp[] =
    rentCastSales.length > 0
      ? rentCastSales.slice(0, 15)
      : kcFallbackSales.slice(0, 10);

  // ── Diagnostics for the UI ──────────────────────────────────────────────
  const compsWithSqft = sales.filter((c) => c.sqftLiving !== undefined).length;
  const newConstructionComps = sales.filter((c) => c.isNewConstructionAtSale).length;
  const diagnostic = {
    rentCastStatus: rentCastResult.status,
    rentCastHttpStatus: rentCastResult.httpStatus,
    rentCastReturned: rentCastComps.length,
    compsWithSqft,
    newConstructionComps,
    source: (rentCastSales.length > 0 ? "rentcast" : "kc_only") as "rentcast" | "kc_only",
  };

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
    compDiagnostic: diagnostic,
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
