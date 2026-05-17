/**
 * Property history overlay for King County parcels.
 *
 * Pulls:
 *   - Sale history (excise tax records, last 3 years from KC PropertyInfo
 *     layer 3; older sales would need a separate scrape of eRealProperty)
 *   - Subject-parcel tax/assessment trend (from eRealProperty pages; AJAX-
 *     loaded so we approximate by surfacing the link)
 *   - Permit signals (best-effort: existing assessor scraping returns
 *     yearBuilt; we add a placeholder for full Accela ePermit drilldown)
 *
 * Why this matters for confidence:
 *   - Recent sale → strong anchor for comp $/sqft
 *   - Seller/buyer patterns (LLC vs individual) → investor activity signal
 *   - 5-year assessment trend → market trajectory
 *   - Last permit date + scope → renovation history, hidden risk
 */

const KC_PROPERTY_INFO_SALES =
  "https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer/3";

export interface SaleRecord {
  pin: string | null;
  address: string | null;
  saleDate: string | null;      // ISO yyyy-mm-dd
  salePrice: number | null;
  sellerName: string | null;
  buyerName: string | null;
  exciseTaxNum: number | null;
  propertyType: string | null;
  principalUse: string | null;
  /** Excise tax record drill-in (Recorders' office) when we have the number. */
  exciseUrl: string | null;
}

export interface PropertyHistory {
  pin: string | null;
  /** Sale records sorted most-recent first. Last 3 years from KC PropertyInfo
   *  sales layer; older records visible via eRealProperty URL. */
  recentSales: SaleRecord[];
  /** Strongest single signal: the most recent sale if we found one. */
  lastSale: SaleRecord | null;
  /** True when the most-recent buyer name matches an investor pattern (LLC,
   *  Properties, Holdings, Capital, etc). Useful for "flipper traffic" signal. */
  lastBuyerLooksInvestor: boolean;
  /** Drill-in URLs for the user to verify. */
  links: Array<{ label: string; url: string }>;
  /** Loaded successfully? */
  ok: boolean;
  error?: string;
}

const INVESTOR_PATTERNS =
  /\b(LLC|L\.L\.C\.|INC\.?|CORP|CORPORATION|PROPERTIES|HOLDINGS|CAPITAL|INVESTMENTS?|VENTURES|TRUST|REALTY|HOMES INC|BUILDERS|DEVELOPMENT|REAL ESTATE)\b/i;

function looksInvestor(name: string | null | undefined): boolean {
  if (!name) return false;
  return INVESTOR_PATTERNS.test(name);
}

/** Parse KC GIS epoch-ms timestamp into ISO yyyy-mm-dd, or null. */
function isoDate(epochMs: number | null | undefined): string | null {
  if (!epochMs || !Number.isFinite(epochMs)) return null;
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Fetch sale history for a single PIN from the KC GIS sales layer.
 * Returns null on PIN miss; throws only on infrastructure failure.
 */
export async function fetchKcHistory(pin: string | null | undefined): Promise<PropertyHistory> {
  const empty: PropertyHistory = {
    pin: pin ?? null,
    recentSales: [],
    lastSale: null,
    lastBuyerLooksInvestor: false,
    links: [],
    ok: false,
  };
  if (!pin) {
    empty.error = "no PIN";
    return empty;
  }

  // Strip dashes / spaces — KC layer stores PIN as a 10-char digit string.
  const normalizedPin = pin.replace(/[^0-9A-Za-z]/g, "");
  const params = new URLSearchParams({
    where: `PIN = '${normalizedPin}'`,
    outFields:
      "PIN,address,ExciseTaxNum,SaleDate,SalePrice,Sellername,buyername,Property_Type,Principal_Use",
    returnGeometry: "false",
    orderByFields: "SaleDate DESC",
    resultRecordCount: "20",
    f: "json",
  });

  let raw: {
    features?: Array<{
      attributes: {
        PIN?: string;
        address?: string;
        SaleDate?: number;
        SalePrice?: number;
        Sellername?: string;
        buyername?: string;
        ExciseTaxNum?: number;
        Property_Type?: string;
        Principal_Use?: string;
      };
    }>;
    error?: { message: string };
  };
  try {
    const r = await fetch(`${KC_PROPERTY_INFO_SALES}/query?${params.toString()}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      empty.error = `http ${r.status}`;
      return empty;
    }
    raw = await r.json();
    if (raw.error) {
      empty.error = raw.error.message;
      return empty;
    }
  } catch (e) {
    empty.error = e instanceof Error ? e.message : "fetch failed";
    return empty;
  }

  const sales: SaleRecord[] = (raw.features ?? []).map((f) => ({
    pin: f.attributes.PIN ?? null,
    address: f.attributes.address ?? null,
    saleDate: isoDate(f.attributes.SaleDate),
    salePrice:
      typeof f.attributes.SalePrice === "number" && f.attributes.SalePrice > 0
        ? f.attributes.SalePrice
        : null,
    sellerName: f.attributes.Sellername ?? null,
    buyerName: f.attributes.buyername ?? null,
    exciseTaxNum: f.attributes.ExciseTaxNum ?? null,
    propertyType: f.attributes.Property_Type ?? null,
    principalUse: f.attributes.Principal_Use ?? null,
    exciseUrl: f.attributes.ExciseTaxNum
      ? // The KC Recorder's office lookup; can construct a search URL but
        // the actual deed image requires a session. Link to recorder portal.
        "https://recordsearch.kingcounty.gov/landmarkweb"
      : null,
  }));

  const lastSale = sales[0] ?? null;
  const links: Array<{ label: string; url: string }> = [
    {
      label: "KC eRealProperty (full record)",
      url: `https://blue.kingcounty.com/Assessor/eRealProperty/Detail.aspx?ParcelNbr=${normalizedPin}`,
    },
    {
      label: "KC Parcel Viewer",
      url: `https://gismaps.kingcounty.gov/parcelviewer2/?pin=${normalizedPin}`,
    },
    {
      label: "KC Recorder land-records search",
      url: "https://recordsearch.kingcounty.gov/landmarkweb",
    },
  ];

  return {
    pin: normalizedPin,
    recentSales: sales,
    lastSale,
    lastBuyerLooksInvestor: looksInvestor(lastSale?.buyerName),
    links,
    ok: true,
  };
}

/**
 * Surface a one-line "history badge" for the UI — what's the headline?
 * Returns null when there's nothing remarkable to say.
 */
export function historyBadge(h: PropertyHistory | null): string | null {
  if (!h?.lastSale) return null;
  const d = h.lastSale.saleDate;
  const p = h.lastSale.salePrice;
  if (!d || !p) return null;
  const yearsAgo = Math.max(0, (Date.now() - Date.parse(d)) / (365 * 24 * 3600 * 1000));
  const flag = h.lastBuyerLooksInvestor ? " · investor buyer" : "";
  const dollars = p >= 1_000_000 ? `$${(p / 1e6).toFixed(2)}M` : `$${(p / 1000).toFixed(0)}k`;
  return `Last sale ${dollars} · ${yearsAgo < 1 ? `${Math.round(yearsAgo * 12)} mo ago` : `${yearsAgo.toFixed(1)} yr ago`}${flag}`;
}
