/**
 * Redfin scraper — DISABLED.
 *
 * Live testing confirmed Redfin's CloudFront blocks server-originated
 * requests (both the location-autocomplete API and direct slug URLs) with
 * a 403 from any non-residential IP. This file is kept as a stub so its
 * import doesn't break, but the function returns null immediately.
 *
 * If we ever route through a residential-IP proxy or sign up for a public
 * scraping API, restore the implementation from git history.
 */

export interface RedfinPriceSignals {
  listPrice: number | null;
  status: "for_sale" | "pending" | "sold" | "off_market" | null;
  beds?: number;
  baths?: number;
  sqft?: number;
  propertyUrl: string | null;
  description?: string;
  error?: string;
}

export async function fetchRedfinSignals(_address: string): Promise<RedfinPriceSignals> {
  return {
    listPrice: null,
    status: null,
    propertyUrl: null,
    error: "redfin scraper disabled (cloudfront blocks server IPs)",
  };
}
