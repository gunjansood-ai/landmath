/**
 * APIllow — Zillow property data API for comparable sales
 *
 * Pricing: Free (50 req/mo), Pro $9.99/mo (3,333 req), Ultra $29.99/mo (10k req)
 * Docs: https://apillow.co/docs.html
 */

export interface CompSale {
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  sqft: number;
  pricePerSqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  soldDate: string;
  distance: number;
  propertyType: string;
}

/**
 * Get comparable recent sales near a location.
 * Uses the server-side /api/comps route to protect the API key.
 * Optionally pass a city name to improve result quality (APIllow searches by
 * city/zip rather than lat/lng radius).
 */
export async function getComparableSales(
  lat: number,
  lng: number,
  radius: number = 1.5,
  beds?: number,
  propertyType: string = "Single Family",
  city?: string
): Promise<CompSale[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    radius: radius.toString(),
    propertyType,
    ...(beds && { bedrooms: beds.toString() }),
    ...(city && { city }),
  });

  try {
    const res = await fetch(`/api/comps?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.comps ?? [];
  } catch {
    console.error("APIllow comps lookup failed");
    return [];
  }
}
