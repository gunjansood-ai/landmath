import { NextRequest, NextResponse } from "next/server";

const APILLOW_KEY = process.env.APILLOW_API_KEY;
const APILLOW_BASE = "https://api.apillow.co/v1";

// ─── Haversine distance ───────────────────────────────────────────────────────

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

// ─── APIllow types ────────────────────────────────────────────────────────────

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

// ─── APIllow async helpers ────────────────────────────────────────────────────

async function submitJob(payload: object, apiKey: string): Promise<string> {
  const res = await fetch(`${APILLOW_BASE}/properties`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`APIllow submit error: ${res.status}`);
  const data = await res.json();
  return data.job_id as string;
}

async function pollJob(
  jobId: string,
  apiKey: string,
  timeoutMs = 20000
): Promise<ApiillowProperty[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${APILLOW_BASE}/results/${jobId}`, {
      headers: { "X-API-Key": apiKey },
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

function extractSoldDate(
  priceHistory?: Array<{ date?: string; event?: string }>
): string {
  if (!priceHistory) return "";
  const soldEvent = [...priceHistory]
    .reverse()
    .find((e) => e.event?.toLowerCase().includes("sold"));
  return soldEvent?.date?.slice(0, 10) ?? "";
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const latitude = parseFloat(searchParams.get("latitude") ?? "");
  const longitude = parseFloat(searchParams.get("longitude") ?? "");
  const radiusMiles = parseFloat(searchParams.get("radius") ?? "1.5");

  if (isNaN(latitude) || isNaN(longitude)) {
    return NextResponse.json(
      { error: "latitude and longitude required" },
      { status: 400 }
    );
  }

  if (!APILLOW_KEY || APILLOW_KEY === "your_apillow_api_key_here") {
    return NextResponse.json({
      comps: [],
      note: "APIllow API key not configured — using estimates",
    });
  }

  try {
    // APIllow searches by city/zip, not lat/lng. Use the city param if provided,
    // otherwise fall back to a ZIP-level search using any ZIP in the query.
    const city = searchParams.get("city") ?? "";
    const zip = searchParams.get("zip") ?? "";

    const payload = zip
      ? { zipcodes: [parseInt(zip)], type: "sold", property_type: "house", max_items: 80 }
      : {
          search: city ? `${city} WA` : `${latitude.toFixed(3)},${longitude.toFixed(3)}`,
          type: "sold",
          property_type: "house",
          max_items: 80,
        };

    const jobId = await submitJob(payload, APILLOW_KEY);
    const properties = await pollJob(jobId, APILLOW_KEY);

    // Filter by distance from subject lat/lng and normalize to CompSale shape.
    const comps = properties
      .filter(
        (p) =>
          p.latitude &&
          p.longitude &&
          (p.last_sold_price ?? p.price ?? 0) > 100000
      )
      .map((p) => {
        const dist = haversineMiles(latitude, longitude, p.latitude!, p.longitude!);
        const price = p.last_sold_price ?? p.price ?? 0;
        const sqft = p.living_area ?? 0;
        return {
          address: p.street_address ?? "",
          city: p.city ?? "",
          state: p.state ?? "",
          zip: p.zipcode ?? "",
          price,
          sqft,
          pricePerSqft: sqft > 0 ? Math.round(price / sqft) : 0,
          beds: p.bedrooms ?? 0,
          baths: p.bathrooms ?? 0,
          yearBuilt: p.year_built ?? 0,
          soldDate: extractSoldDate(p.price_history),
          distance: Math.round(dist * 100) / 100,
          propertyType: p.property_type ?? "Single Family",
          _dist: dist,
        };
      })
      .filter((c) => c._dist <= radiusMiles)
      .sort((a, b) => a._dist - b._dist)
      .map(({ _dist, ...c }) => c)
      .slice(0, 20);

    return NextResponse.json({ comps });
  } catch (err) {
    console.error("APIllow comps fetch failed:", err);
    return NextResponse.json({ comps: [] });
  }
}
