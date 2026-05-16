/**
 * RentCast API — comparable sales & rent estimates
 *
 * Free tier: 50 API calls/month
 * Docs: https://developers.rentcast.io/reference
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

export interface RentEstimate {
  rentEstimate: number;
  rentRangeLow: number;
  rentRangeHigh: number;
}

export interface MarketStats {
  medianPrice: number;
  medianPricePerSqft: number;
  medianRent: number;
  averageDaysOnMarket: number;
}

/**
 * Get comparable recent sales near a location.
 * Uses server-side API route to protect the API key.
 */
export async function getComparableSales(
  lat: number,
  lng: number,
  radius: number = 1, // miles
  beds?: number,
  propertyType: string = "Single Family"
): Promise<CompSale[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    radius: radius.toString(),
    propertyType,
    ...(beds && { bedrooms: beds.toString() }),
    status: "Sold",
    limit: "10",
    daysOld: "180",
  });

  try {
    const res = await fetch(`/api/comps?${params}`);
    if (!res.ok) return [];

    const data = await res.json();
    return data.comps ?? [];
  } catch {
    console.error("RentCast comps lookup failed");
    return [];
  }
}

/**
 * Get rent estimate for a property.
 */
export async function getRentEstimate(
  address: string,
  beds: number,
  baths: number,
  sqft: number
): Promise<RentEstimate | null> {
  const params = new URLSearchParams({
    address,
    bedrooms: beds.toString(),
    bathrooms: baths.toString(),
    squareFootage: sqft.toString(),
    propertyType: "Single Family",
  });

  try {
    const res = await fetch(`/api/rent-estimate?${params}`);
    if (!res.ok) return null;

    return await res.json();
  } catch {
    console.error("RentCast rent estimate failed");
    return null;
  }
}
