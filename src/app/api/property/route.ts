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

const APILLOW_KEY = process.env.APILLOW_API_KEY;
const APILLOW_BASE = "https://api.apillow.co/v1";

// ─── APIllow comps (real sqft + yearBuilt; KC Assessor HTML is AJAX-only) ────
//
// IMPORTANT: KC Assessor's Dashboard.aspx / Detail.aspx are ASP.NET WebForms
// pages that load all property data via __VIEWSTATE postback. The raw HTML
// contains zero useful data — sqft, yearBuilt, beds, baths are all blank.
// We use APIllow (Zillow data API) for cited comp enrichment. APIllow is async:
// POST a job → poll GET /v1/results/{job_id} until complete.

interface ApiillowProperty {
  street_address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  latitude?: number;
  longitude?: number;
  price?: number;
  last_sold_price?: number;
  living_area?: number;
  bedrooms?: number;
  bathrooms?: number;
  year_built?: number;
  property_type?: string;
  price_history?: Array<{ date?: string; event?: string; price?: number }>;
}

interface ApiillowFetchResult {
  comps: ApiillowProperty[];
  status: "ok" | "no_key" | "http_error" | "exception";
  httpStatus?: number;
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

async function pollApiillowJob(
  jobId: string,
  timeoutMs = 20000
): Promise<ApiillowProperty[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${APILLOW_BASE}/results/${jobId}`, {
      headers: { "X-API-Key": APILLOW_KEY! },
    });
    if (!res.ok) throw new Error(`APIllow poll error: ${res.status}`);
    const data = await res.json();
    if (data.status === "complete") {
      return (data.results ?? [])
        .filter((r: { success: boolean }) => r.success)
        .map((r: { property: ApiillowProperty }) => r.property);
    }
    if (data.status === "failed") throw new Error("APIllow job failed");
  }
  throw new Error("APIllow poll timeout");
}

async function fetchApiillowSoldComps(
  lat: number,
  lng: number,
  city: string | null
): Promise<ApiillowFetchResult> {
  if (!APILLOW_KEY || APILLOW_KEY === "your_apillow_api_key_here") {
    return { comps: [], status: "no_key" };
  }

  // APIllow searches by city or ZIP, not lat/lng radius. We search sold SFRs
  // in the subject city and then filter to 1.5 miles post-fetch.
  const searchQuery = city ? `${city} WA` : `${lat.toFixed(3)},${lng.toFixed(3)}`;

  try {
    const res = await fetch(`${APILLOW_BASE}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": APILLOW_KEY },
      body: JSON.stringify({
        search: searchQuery,
        type: "sold",
        property_type: "house",
        max_items: 100,
      }),
    });
    if (!res.ok) {
      console.error("APIllow comps submit error:", res.status);
      return { comps: [], status: "http_error", httpStatus: res.status };
    }
    const { job_id } = await res.json();
    const all = await pollApiillowJob(job_id);

    // Filter to 1.5-mile radius from subject.
    const nearby = all.filter(
      (p) =>
        p.latitude &&
        p.longitude &&
        haversineMiles(lat, lng, p.latitude, p.longitude) <= 1.5
    );

    return { comps: nearby, status: "ok" };
  } catch (err) {
    console.error("APIllow fetch failed:", err);
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
// returns no useful raw HTML for sqft/yearBuilt. APIllow (see fetchApiillowSoldComps)
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

  // 3. APIllow comps — primary source of $/sqft data (has real sqft + yearBuilt).
  //    KC Assessor HTML can't be scraped; KC layer 3 sales lack sqft. APIllow it is.
  const apiillowResult = await fetchApiillowSoldComps(lat, lng, subjectCity);
  const apiillowComps = apiillowResult.comps;

  // Build a KC-address-keyed map so we can enrich APIllow comps with a KC PIN
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

  // Build the cited-comp set FROM APIllow (every comp has sqft + yearBuilt).
  const apiillowSales: Comp[] = apiillowComps
    .filter((p) => p.street_address && (p.last_sold_price ?? p.price ?? 0) > 100000)
    .map((p): Comp => {
      const price = p.last_sold_price ?? p.price ?? 0;
      const sqft = p.living_area && p.living_area > 200 ? p.living_area : undefined;
      const yearBuilt = p.year_built && p.year_built > 1800 ? p.year_built : undefined;
      // Extract sold date from price_history events.
      const soldEvent = p.price_history
        ? [...p.price_history].reverse().find((e) => e.event?.toLowerCase().includes("sold"))
        : undefined;
      const saleDate = soldEvent?.date?.slice(0, 10) ?? "";
      const saleTs = saleDate ? Date.parse(saleDate) : NaN;
      const saleYear = !isNaN(saleTs)
        ? new Date(saleTs).getFullYear()
        : new Date().getFullYear();
      // Widened from 5 to 10 years. A 2016 build sold in 2024 is still a
      // valid "new construction" comp for valuation purposes — the home
      // presents as modern and prices accordingly.
      const isNewConstructionAtSale =
        yearBuilt !== undefined && yearBuilt >= saleYear - 10;
      const formattedAddr = p.street_address
        ? `${p.street_address}, ${p.city ?? ""}, ${p.state ?? ""} ${p.zipcode ?? ""}`.trim()
        : "Unknown";
      // Best-effort KC enrichment for drill-in URL.
      const kc = findKcMatch(formattedAddr);
      return {
        pin: kc?.PIN ?? "",
        address: formattedAddr,
        salePrice: price,
        saleDate,
        principalUse: p.property_type ?? "Single Family",
        typology: "sfr",
        sqftLiving: sqft,
        yearBuilt,
        isNewConstructionAtSale,
        pricePerSqft: sqft && price ? Math.round(price / sqft) : undefined,
        sourceUrl: kc?.PIN
          ? KC_ASSESSOR_DETAIL(kc.PIN)
          : `https://www.redfin.com/?q=${encodeURIComponent(formattedAddr)}`,
        parcelViewerUrl: kc?.PIN ? KC_PARCEL_VIEWER(kc.PIN) : undefined,
      };
    });

  // KC fallback comps — used only when APIllow returned nothing. No sqft data
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

  // APIllow primary; KC fallback only if APIllow is empty.
  const sales: Comp[] =
    apiillowSales.length > 0
      ? apiillowSales.slice(0, 15)
      : kcFallbackSales.slice(0, 10);

  // ── Diagnostics for the UI ──────────────────────────────────────────────
  const compsWithSqft = sales.filter((c) => c.sqftLiving !== undefined).length;
  const newConstructionComps = sales.filter((c) => c.isNewConstructionAtSale).length;
  const diagnostic = {
    apiillowStatus: apiillowResult.status,
    apiillowHttpStatus: apiillowResult.httpStatus,
    apiillowReturned: apiillowComps.length,
    compsWithSqft,
    newConstructionComps,
    source: (apiillowSales.length > 0 ? "apillow" : "kc_only") as "apillow" | "kc_only",
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
