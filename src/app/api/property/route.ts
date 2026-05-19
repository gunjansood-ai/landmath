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
import { sendAlert } from "@/lib/notify";
import { fetchKcHazards } from "@/lib/hazards/kc-gis";
import { fetchKcHistory } from "@/lib/history/kc-history";

/**
 * Aggregated property lookup. Takes lat/lng and returns:
 *   - parcel: subject parcel data
 *   - sales: top recent sales — kept for back-compat
 *   - marketEstimate: median of recent sales — kept for back-compat
 *   - assessor: subject's building details (sqft, beds, baths, year)
 *   - neighborhood: adaptive-radius typology + cited comps (with sqft + drill-in URLs)
 *   - isKingCounty: true when full KC GIS data is available; false elsewhere (uses
 *       Nominatim reverse geocode + APIllow property lookup as fallback)
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
  city: string | null,
  state: string = "WA"
): Promise<ApiillowFetchResult> {
  if (!APILLOW_KEY || APILLOW_KEY === "your_apillow_api_key_here") {
    return { comps: [], status: "no_key" };
  }

  // APIllow searches by city or ZIP, not lat/lng radius. We search sold SFRs
  // in the subject city and then filter to 1.5 miles post-fetch.
  const searchQuery = city ? `${city} ${state}` : `${lat.toFixed(3)},${lng.toFixed(3)}`;

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
      if (res.status === 401 || res.status === 403) {
        await sendAlert("🚨 APIllow API key rejected (comps) — HTTP " + res.status + ". Check APILLOW_API_KEY in Vercel env vars.");
      } else if (res.status >= 500) {
        await sendAlert("⚠️ APIllow comps endpoint returned " + res.status + " — service may be down. Comp pricing will fall back to ZIP/flat table.");
      }
      return { comps: [], status: "http_error", httpStatus: res.status };
    }
    const { job_id } = await res.json();
    let all: ApiillowProperty[];
    try {
      all = await pollApiillowJob(job_id);
    } catch (pollErr) {
      const msg = (pollErr as Error).message;
      if (msg.includes("timeout")) {
        await sendAlert("⚠️ APIllow comps job timed out (>20s). Comp data unavailable for this request.");
      } else {
        await sendAlert("🚨 APIllow comps poll failed: " + msg);
      }
      return { comps: [], status: "exception" };
    }

    // Filter to 1.5-mile radius from subject.
    const nearby = all.filter(
      (p) =>
        p.latitude &&
        p.longitude &&
        haversineMiles(lat, lng, p.latitude, p.longitude) <= 1.5
    );

    return { comps: nearby, status: "ok" };
  } catch (err) {
    const msg = (err as Error).message;
    console.error("APIllow fetch failed:", msg);
    await sendAlert("🚨 APIllow comps request threw an exception: " + msg);
    return { comps: [], status: "exception" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-KC fallback: Nominatim reverse geocode + APIllow property lookup
// ─────────────────────────────────────────────────────────────────────────────

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimResult {
  display_name?: string;
  address?: NominatimAddress;
}

async function reverseGeocode(lat: number, lng: number): Promise<NominatimResult | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      {
        headers: { "User-Agent": "LandMath/1.0 (landmath.app)" },
        next: { revalidate: 86400 },
      }
    );
    if (!res.ok) {
      await sendAlert("⚠️ Nominatim reverse geocode returned HTTP " + res.status + " for [" + lat.toFixed(4) + "," + lng.toFixed(4) + "]. Non-KC address lookup degraded.");
      return null;
    }
    return await res.json();
  } catch (err) {
    await sendAlert("⚠️ Nominatim reverse geocode failed: " + (err as Error).message + ". Non-KC address lookup unavailable.");
    return null;
  }
}

interface ApiillowPropertyDetail {
  street_address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  latitude?: number;
  longitude?: number;
  price?: number;
  last_sold_price?: number;
  zestimate?: number;
  living_area?: number;
  lot_size?: number;
  bedrooms?: number;
  bathrooms?: number;
  year_built?: number;
  property_type?: string;
  tax_history?: Array<{ year?: number; tax?: number; value?: number }>;
  price_history?: Array<{ date?: string; event?: string; price?: number }>;
}

/**
 * Walk APIllow's price_history and return the most recent "Listed for sale"
 * or "Price change" event within the last 180 days. This is the most reliable
 * signal for "what is the property listed at TODAY" — much better than
 * subjectApiillow.price which sometimes returns the last SOLD price by mistake.
 *
 * Returns null when no valid recent listing event exists.
 */
function findMostRecentListEvent(
  history: Array<{ date?: string; event?: string; price?: number }> | undefined,
): { price: number; date: string; event: string } | null {
  if (!history || history.length === 0) return null;
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000; // 180 days
  // Look for events that represent an active listing (not a sale).
  const LIST_EVENTS = /listed for sale|listing|price (change|reduced|increase)/i;
  const candidates = history
    .filter((h) => h.date && h.price && h.price > 50_000 && h.event && LIST_EVENTS.test(h.event))
    .filter((h) => {
      const t = Date.parse(h.date!);
      return !isNaN(t) && t >= cutoff;
    })
    .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  if (candidates.length === 0) return null;
  const top = candidates[0];
  return { price: top.price!, date: top.date!, event: top.event! };
}

async function lookupApiillowByAddress(
  address: string
): Promise<ApiillowPropertyDetail | null> {
  if (!APILLOW_KEY || APILLOW_KEY === "your_apillow_api_key_here") return null;
  try {
    const res = await fetch(`${APILLOW_BASE}/properties`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": APILLOW_KEY },
      body: JSON.stringify({ addresses: [address], max_items: 1 }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        await sendAlert("🚨 APIllow API key rejected (address lookup) — HTTP " + res.status + ". Non-KC subject property details unavailable. Check APILLOW_API_KEY.");
      } else if (res.status >= 500) {
        await sendAlert("⚠️ APIllow address lookup returned " + res.status + " — service may be down. Non-KC property details unavailable.");
      }
      return null;
    }
    const { job_id } = await res.json();
    try {
      const properties = await pollApiillowJob(job_id);
      return (properties[0] as ApiillowPropertyDetail) ?? null;
    } catch (pollErr) {
      const msg = (pollErr as Error).message;
      await sendAlert("⚠️ APIllow address lookup poll failed: " + msg + ". Non-KC property details unavailable.");
      return null;
    }
  } catch (err) {
    await sendAlert("⚠️ APIllow address lookup threw: " + (err as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Address normalisation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KC GIS returns addresses in ALL CAPS ("17426 SE 60TH ST", "BELLEVUE").
 * APIllow matches much better on title-cased input ("17426 SE 60th St").
 *
 * Rules:
 *  - Always capitalise the first letter of each word.
 *  - Keep known directional abbreviations (NE, SW, SE, NW, N, S, E, W) uppercase.
 *  - Keep street-type abbreviations (ST, AVE, DR, RD, PL, CT, LN, WAY, BLVD,
 *    PKWY, TER, CIR, LOOP, HWY) uppercase so Zillow/APIllow recognises them.
 *  - Ordinals (60TH, 1ST, 2ND, 3RD) stay uppercase.
 */
const KEEP_UPPER = new Set([
  "NE","NW","SE","SW","N","S","E","W",
  "ST","AVE","DR","RD","PL","CT","LN","WAY","BLVD","PKWY","TER","CIR","LOOP","HWY","FWY",
]);
const ORDINAL_RE = /^\d+(ST|ND|RD|TH)$/i;

function toTitleCaseAddress(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((word) => {
      const up = word.toUpperCase();
      if (KEEP_UPPER.has(up)) return up;
      if (ORDINAL_RE.test(up)) return up;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// PropertyInfo helpers (King County GIS)
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
  // Point query first — fastest path when the lat/lng lands inside a parcel polygon.
  const pointParams = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    f: "json",
    ...extraParams,
  });
  let res: Response;
  try {
    res = await fetch(`${KC_PROPERTY_INFO}/${layerId}/query?${pointParams}`);
  } catch (err) {
    await sendAlert("⚠️ KC GIS layer " + layerId + " network error: " + (err as Error).message + ". Property data may be unavailable.");
    return [];
  }
  if (!res.ok) {
    if (res.status >= 500) {
      await sendAlert("⚠️ KC GIS layer " + layerId + " returned HTTP " + res.status + ". Property data may be unavailable.");
    }
    return [];
  }
  const data = await res.json();
  const direct = (data.features ?? []).map((f: PropertyInfoFeature) => f.attributes);
  if (direct.length > 0) return direct;

  // Buffered retry: ~30m envelope around the point. Catches the case where
  // the geocoded lat/lng lands a few feet outside the parcel polygon (common
  // for properties with set-back houses, large lots, or coordinate-precision
  // drift between Google geocoder and KC GIS parcel boundaries). Returns the
  // nearest parcel by area-weighted intersection.
  // See: the Medina 304 Upland Rd case where the point query missed but a
  // 30m envelope found the single-family parcel.
  const dLat = 30 / 111_111;
  const dLng = 30 / (111_111 * Math.cos((lat * Math.PI) / 180));
  const envParams = new URLSearchParams({
    geometry: [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: "false",
    resultRecordCount: "1",
    f: "json",
    ...extraParams,
  });
  try {
    const res2 = await fetch(`${KC_PROPERTY_INFO}/${layerId}/query?${envParams}`);
    if (!res2.ok) return [];
    const data2 = await res2.json();
    return (data2.features ?? []).map((f: PropertyInfoFeature) => f.attributes);
  } catch {
    return [];
  }
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
  subjectCity: string | null,
  isKingCounty: boolean = true,
  subjectState: string = "WA"
): Promise<NeighborhoodData> {
  // ── KC-only: parcel typology + raw sales layer ──────────────────────────
  let parcelSamples: ParcelSample[] = [];
  let salesRaw: RawSale[] = [];
  let radiusM = ADAPTIVE_RADII_M[ADAPTIVE_RADII_M.length - 1];

  if (isKingCounty) {
    // 1. Adaptive radius for typology (parcels)
    let parcels: RawParcel[] = [];
    for (const r of ADAPTIVE_RADII_M) {
      parcels = (await queryNearbyParcels(lat, lng, r)) as RawParcel[];
      if (parcels.length >= MIN_PARCELS_FOR_TYPOLOGY) {
        radiusM = r;
        break;
      }
      radiusM = r;
    }

    const otherParcels = subjectPin
      ? parcels.filter((p) => p.PIN && p.PIN !== subjectPin)
      : parcels;

    parcelSamples = otherParcels.map((p): ParcelSample => ({
      pin: p.PIN,
      address: p.ADDR_FULL ?? null,
      presentUse: p.PREUSE_DESC ?? null,
      typology: bucketParcelByPreuse(p.PREUSE_DESC),
      lotSizeSqft: typeof p.LOTSQFT === "number" ? p.LOTSQFT : undefined,
      sourceUrl: KC_ASSESSOR_DETAIL(p.PIN),
    }));

    // 2. Sales — adaptive radius for KC fallback comp pool.
    salesRaw = ((await queryNearbySales(lat, lng, 800)) as RawSale[]).filter(
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
  }

  const typology = computeTypologyDistribution(parcelSamples);
  const topSales = salesRaw.slice(0, 20);

  // 3. APIllow comps — primary source of $/sqft data (has real sqft + yearBuilt).
  //    KC Assessor HTML can't be scraped; KC layer 3 sales lack sqft. APIllow it is.
  const apiillowResult = await fetchApiillowSoldComps(lat, lng, subjectCity, subjectState);
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

  // ── 1. Try King County GIS first ─────────────────────────────────────────
  const parcelResults = (await queryPropertyInfoPoint(
    2,
    lat,
    lng,
    "PIN,ADDR_FULL,CTYNAME,POSTALCTYNAME,LOTSQFT,APPRLNDVAL,APPR_IMPR,KCA_ZONING,KCA_ACRES,PREUSE_CODE,PREUSE_DESC,PROPTYPE"
  )) as Array<Record<string, unknown>>;
  const kcParcel = parcelResults[0] ?? null;
  const isKingCounty = kcParcel !== null;

  // ── 2a. King County path ──────────────────────────────────────────────────
  if (isKingCounty) {
    const subjectPin = (kcParcel!.PIN as string) ?? null;
    const subjectCity =
      ((kcParcel!.CTYNAME as string)?.trim() ||
        (kcParcel!.POSTALCTYNAME as string)?.trim()) ?? null;

    // Build a full address string for the subject so we can look it up on
    // APIllow and get the live listing price (or Zestimate). KC GIS returns
    // addresses in ALL CAPS ("17426 SE 60TH ST", "BELLEVUE") — normalise to
    // title case so APIllow/Zillow matching works reliably.
    const kcStreetAddr = (kcParcel!.ADDR_FULL as string)?.trim() ?? null;
    const subjectFullAddress =
      kcStreetAddr && subjectCity
        ? `${toTitleCaseAddress(kcStreetAddr)}, ${toTitleCaseAddress(subjectCity)}, WA`
        : null;

    const [assessor, neighborhood, subjectApiillow, hazards, history] = await Promise.all([
      subjectPin ? getAssessorDetails(subjectPin) : Promise.resolve(null),
      buildNeighborhood(lat, lng, subjectPin, subjectCity, true, "WA"),
      subjectFullAddress
        ? lookupApiillowByAddress(subjectFullAddress)
        : Promise.resolve(null),
      // KC GIS hazard overlay — 26 layers queried in parallel. Failures degrade
      // gracefully; the report always includes a severity bucket + caveats.
      fetchKcHazards(lat, lng).catch((e) => {
        console.warn("hazard fetch failed:", e instanceof Error ? e.message : e);
        return null;
      }),
      // Sale + permit history for the subject parcel.
      subjectPin
        ? fetchKcHistory(subjectPin).catch((e) => {
            console.warn("history fetch failed:", e instanceof Error ? e.message : e);
            return null;
          })
        : Promise.resolve(null),
    ]);

    // subjectListPrice: pick the BEST signal for "what is this property listed at TODAY".
    //
    // The hierarchy (most-to-least reliable):
    //   1. Most recent "Listed for sale" / "Price changed" event in price_history
    //      within the last 180 days. This is the actual MLS list price, not a guess.
    //   2. subjectApiillow.price — APIllow's headline price; usually current list but
    //      sometimes returns the last sold price instead. Less reliable than #1.
    //   3. subjectApiillow.zestimate — Zillow's estimate. NOT a list price; only
    //      use when we have nothing else.
    //
    // We also surface the listing date so the UI can show "Listed 17 days ago"
    // and the user can sanity-check against Redfin.
    const recentListing = findMostRecentListEvent(subjectApiillow?.price_history);
    const subjectListPrice: number | null =
      recentListing?.price ??
      (subjectApiillow?.price && subjectApiillow.price > 50000 ? subjectApiillow.price : null) ??
      (subjectApiillow?.zestimate && subjectApiillow.zestimate > 50000 ? subjectApiillow.zestimate : null) ??
      null;
    const subjectListDate: string | null = recentListing?.date ?? null;

    const priceSource: "apillow_listing" | "apillow_zestimate" | "neighborhood_median" | "appraised" | "estimate" =
      recentListing
        ? "apillow_listing"
        : subjectApiillow?.price && subjectApiillow.price > 50000
        ? "apillow_listing"
        : subjectApiillow?.zestimate && subjectApiillow.zestimate > 50000
        ? "apillow_zestimate"
        : "neighborhood_median";

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
      isKingCounty: true,
      subjectListPrice,
      priceSource,
      subjectListDate,
      // Full price signals so the UI can show "Listed at $X · Zest $Y · Last sold $Z".
      subjectZestimate: subjectApiillow?.zestimate ?? null,
      subjectLastSoldPrice: subjectApiillow?.last_sold_price ?? null,
      parcel: {
        pin: kcParcel!.PIN,
        address: kcParcel!.ADDR_FULL,
        city: subjectCity,
        lotSizeSqft:
          (kcParcel!.LOTSQFT as number) ||
          Math.round(((kcParcel!.KCA_ACRES as number) || 0) * 43560),
        appraisedLandValue: (kcParcel!.APPRLNDVAL as number) || 0,
        appraisedImpValue: (kcParcel!.APPR_IMPR as number) || 0,
        appraisedTotal:
          ((kcParcel!.APPRLNDVAL as number) || 0) +
          ((kcParcel!.APPR_IMPR as number) || 0),
        zoningCode: (kcParcel!.KCA_ZONING as string)?.trim() || null,
        presentUseCode: kcParcel!.PREUSE_CODE,
        presentUse: (kcParcel!.PREUSE_DESC as string)?.trim() || null,
        propertyType: kcParcel!.PROPTYPE,
        assessorUrl: subjectPin ? KC_ASSESSOR_DETAIL(subjectPin) : null,
        parcelViewerUrl: subjectPin ? KC_PARCEL_VIEWER(subjectPin) : null,
      },
      sales: neighborhood.sales.slice(0, 5).map((c) => ({
        address: c.address,
        salePrice: c.salePrice,
        saleDate: c.saleDate,
        principalUse: c.principalUse,
      })),
      marketEstimate,
      assessor,
      neighborhood,
      hazards,
      history,
    });
  }

  // ── 2b. Non-KC fallback: Nominatim reverse geocode + APIllow property lookup
  const geo = await reverseGeocode(lat, lng);
  const addr = geo?.address ?? {};
  const subjectCity = addr.city ?? addr.town ?? addr.village ?? null;
  const subjectState = addr.state ?? null;
  const postcode = addr.postcode ?? null;
  const streetAddress =
    addr.house_number && addr.road
      ? `${addr.house_number} ${addr.road}`
      : null;
  const fullAddress =
    streetAddress && subjectCity && subjectState
      ? `${streetAddress}, ${subjectCity}, ${subjectState} ${postcode ?? ""}`.trim()
      : null;

  // APIllow detail lookup for the subject property itself (sqft, beds, year, etc.)
  let apiillowDetail: ApiillowPropertyDetail | null = null;
  if (fullAddress) {
    apiillowDetail = await lookupApiillowByAddress(fullAddress);
  }

  // Synthetic parcel — shape matches the KC parcel payload so consumers don't branch
  const syntheticParcel = {
    pin: null,
    address: fullAddress ?? geo?.display_name ?? null,
    city: subjectCity,
    state: subjectState,
    zipCode: postcode,
    lotSizeSqft: apiillowDetail?.lot_size ?? null,
    appraisedLandValue: null,
    appraisedImpValue: null,
    appraisedTotal: apiillowDetail?.zestimate ?? null,
    zoningCode: null,
    presentUseCode: null,
    presentUse: apiillowDetail?.property_type ?? null,
    propertyType: apiillowDetail?.property_type ?? null,
    assessorUrl: null,
    parcelViewerUrl: null,
  };

  // Synthetic assessor from APIllow
  const assessor: AssessorBits | null = apiillowDetail
    ? {
        sqftLiving: apiillowDetail.living_area ?? 0,
        yearBuilt: apiillowDetail.year_built ?? 0,
        bedrooms: apiillowDetail.bedrooms ?? 0,
        bathrooms: apiillowDetail.bathrooms ?? 0,
        stories: 1,
      }
    : null;

  // Neighborhood: skip KC GIS, still run APIllow comps
  const neighborhood = await buildNeighborhood(
    lat,
    lng,
    null,
    subjectCity,
    false,
    subjectState ?? "US"
  );

  const marketEstimate =
    neighborhood.sales.length > 0
      ? (() => {
          const prices = neighborhood.sales
            .map((s) => s.salePrice)
            .sort((a, b) => a - b);
          return prices[Math.floor(prices.length / 2)];
        })()
      : null;

  // Non-KC: subject price from APIllow direct lookup (same logic as KC path).
  const nonKcSubjectListPrice: number | null =
    (apiillowDetail?.price && apiillowDetail.price > 50000
      ? apiillowDetail.price
      : null) ??
    (apiillowDetail?.zestimate && apiillowDetail.zestimate > 50000
      ? apiillowDetail.zestimate
      : null) ??
    null;

  const nonKcPriceSource =
    apiillowDetail?.price && apiillowDetail.price > 50000
      ? "apillow_listing"
      : apiillowDetail?.zestimate && apiillowDetail.zestimate > 50000
      ? "apillow_zestimate"
      : "neighborhood_median";

  return NextResponse.json({
    isKingCounty: false,
    subjectListPrice: nonKcSubjectListPrice,
    priceSource: nonKcPriceSource,
    parcel: syntheticParcel,
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
