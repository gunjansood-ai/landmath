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

/**
 * Geocode a literal address string — bypasses autocomplete predictions. Use
 * when the user has typed a specific address and you want the LITERAL match,
 * not Google's "did you mean" substitution. Returns null if Google can't
 * find an exact match.
 */
export async function geocodeLiteralAddress(address: string): Promise<GeocodedAddress | null> {
  const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.result ?? null;
}

/**
 * True when the autocomplete prediction's street name plausibly matches what
 * the user typed. This prevents Google from silently substituting a similarly-
 * named-but-different street ("Upland" → "Midland"). Heuristic:
 *   - Extract the longest word from the typed input that isn't a number,
 *     state code, "rd"/"st"/"ave", or a city name.
 *   - Require that word (or its first 4 letters) appears in the prediction's
 *     description.
 */
const STREET_TYPE_RE = /^(rd|st|ave|blvd|ln|dr|ct|way|pl|hwy|pkwy|cir|ter|loop|trl|aly|sq|row|run)\.?$/i;
const STATE_CODE_RE = /^(WA|OR|CA|ID|NY|TX|FL|AZ|NV|UT|CO|MT|ND|SD|NE|KS|OK|AR|LA|MS|AL|GA|SC|NC|TN|KY|VA|WV|OH|MI|IN|IL|WI|MN|IA|MO|ME|VT|NH|MA|RI|CT|NJ|PA|DE|MD|DC|HI|AK)$/i;

export function predictionMatchesInput(input: string, prediction: PlacePrediction): boolean {
  const tokens = input
    .toLowerCase()
    .replace(/[,#]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !/^\d+$/.test(t) && !STREET_TYPE_RE.test(t) && !STATE_CODE_RE.test(t));
  // Find the meaningful street name — usually the longest non-trivial token.
  const meaningful = tokens.sort((a, b) => b.length - a.length)[0];
  if (!meaningful || meaningful.length < 3) return true; // can't disambiguate, trust prediction
  const haystack = prediction.description.toLowerCase();
  // Require the first 4 chars (or full word if shorter) to appear in the prediction.
  const probe = meaningful.slice(0, Math.max(4, Math.floor(meaningful.length * 0.7)));
  return haystack.includes(probe);
}
