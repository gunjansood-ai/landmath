import { NextRequest, NextResponse } from "next/server";
import { sendAlert } from "@/lib/notify";

const APILLOW_KEY = process.env.APILLOW_API_KEY;
const APILLOW_BASE = "https://api.apillow.co/v1";

// ─── APIllow async helpers (same pattern as /api/comps) ───────────────────────

interface ApiillowRentalProperty {
  street_address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  price?: number;           // monthly rent
  living_area?: number;
  bedrooms?: number;
  bathrooms?: number;
  property_type?: string;
}

async function submitRentalJob(payload: object, apiKey: string): Promise<string> {
  const res = await fetch(`${APILLOW_BASE}/properties`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      await sendAlert(
        "🚨 APIllow API key rejected (/api/rent-comps) — HTTP " +
          res.status +
          ". Rent comps endpoint down."
      );
    } else if (res.status >= 500) {
      await sendAlert(
        "⚠️ APIllow rent-comps returned " + res.status + " — service may be down."
      );
    }
    throw new Error(`APIllow rent submit error: ${res.status}`);
  }
  const data = await res.json();
  return data.job_id as string;
}

async function pollRentalJob(
  jobId: string,
  apiKey: string,
  timeoutMs = 20000
): Promise<ApiillowRentalProperty[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${APILLOW_BASE}/results/${jobId}`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!res.ok) throw new Error(`APIllow rent poll error: ${res.status}`);
    const data = await res.json();
    if (data.status === "complete") {
      return (data.results ?? [])
        .filter((r: { success: boolean }) => r.success)
        .map((r: { property: ApiillowRentalProperty }) => r.property);
    }
    if (data.status === "failed") throw new Error("APIllow rental job failed");
  }
  throw new Error("APIllow rental poll timeout");
}

// Compute median of a numeric array
function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const city = searchParams.get("city") ?? "";
  const zip = searchParams.get("zip") ?? "";

  if (!city && !zip) {
    return NextResponse.json({ error: "city or zip required" }, { status: 400 });
  }

  if (!APILLOW_KEY || APILLOW_KEY === "your_apillow_api_key_here") {
    return NextResponse.json({
      studioRent: null,
      oneBrRent: null,
      twoBrRent: null,
      comps: [],
      note: "APIllow API key not configured — enter rents manually",
    });
  }

  try {
    // Search for rental listings by zip or city
    const payload = zip
      ? { zipcodes: [parseInt(zip)], type: "for_rent", property_type: "Apartment", max_items: 60 }
      : {
          search: city ? `${city}` : "",
          type: "for_rent",
          property_type: "Apartment",
          max_items: 60,
        };

    const jobId = await submitRentalJob(payload, APILLOW_KEY);
    const properties = await pollRentalJob(jobId, APILLOW_KEY);

    // Group by bedroom count and compute median rent
    const byBeds: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [] };

    const comps = properties
      .filter((p) => (p.price ?? 0) >= 500 && (p.price ?? 0) <= 15000)
      .map((p) => ({
        address: p.street_address ?? "",
        city: p.city ?? "",
        beds: p.bedrooms ?? 0,
        sqft: p.living_area ?? 0,
        monthlyRent: p.price ?? 0,
        propertyType: p.property_type ?? "",
      }));

    for (const c of comps) {
      const beds = Math.min(c.beds, 3);
      if (byBeds[beds]) byBeds[beds].push(c.monthlyRent);
    }

    // Fallback: if we don't have enough per-bedroom data, distribute all
    const allRents = comps.map((c) => c.monthlyRent).filter((r) => r > 0);
    const overallMedian = median(allRents);

    // Use conservative fallback ratios if APIllow doesn't return enough segmented data
    // Studio ~65%, 1BR ~100%, 2BR ~140% of 1BR median (typical US multifamily ratios)
    const studioRent =
      byBeds[0].length >= 2 ? median(byBeds[0]) : overallMedian > 0 ? Math.round(overallMedian * 0.65) : null;
    const oneBrRent =
      byBeds[1].length >= 2 ? median(byBeds[1]) : overallMedian > 0 ? overallMedian : null;
    const twoBrRent =
      byBeds[2].length >= 2 ? median(byBeds[2]) : overallMedian > 0 ? Math.round(overallMedian * 1.4) : null;

    return NextResponse.json({
      studioRent,
      oneBrRent,
      twoBrRent,
      comps: comps.slice(0, 20),
      source: "apillow",
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("APIllow rent comps failed:", msg);
    if (msg.includes("timeout")) {
      await sendAlert("⚠️ APIllow rent comps job timed out (>20s).");
    } else if (!msg.includes("submit error")) {
      await sendAlert("🚨 APIllow rent comps threw: " + msg);
    }
    return NextResponse.json({
      studioRent: null,
      oneBrRent: null,
      twoBrRent: null,
      comps: [],
    });
  }
}
