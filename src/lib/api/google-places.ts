/**
 * Google Places Autocomplete + Geocoding — client-side helpers
 * These call our Next.js API routes (which proxy to Google) to keep the API key server-side.
 */

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface GeocodedAddress {
  formattedAddress: string;
  streetNumber: string;
  street: string;
  unit: string; // apt/unit number — non-empty means condo/multi-unit
  city: string;
  county: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  placeTypes: string[];
}

/** Autocomplete address suggestions */
export async function getAddressSuggestions(
  input: string,
  sessionToken?: string
): Promise<PlacePrediction[]> {
  if (input.length < 3) return [];

  const params = new URLSearchParams({
    input,
    ...(sessionToken && { sessionToken }),
  });

  const res = await fetch(`/api/places?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return data.predictions ?? [];
}

/** Geocode a place by its placeId */
export async function geocodePlace(placeId: string): Promise<GeocodedAddress | null> {
  const res = await fetch(`/api/geocode?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return null;

  const data = await res.json();
  return data.result ?? null;
}
