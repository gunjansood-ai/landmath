import { NextRequest, NextResponse } from "next/server";

const RENTCAST_KEY = process.env.RENTCAST_API_KEY;

export async function GET(req: NextRequest) {
  const latitude = req.nextUrl.searchParams.get("latitude");
  const longitude = req.nextUrl.searchParams.get("longitude");

  if (!latitude || !longitude) {
    return NextResponse.json({ error: "latitude and longitude required" }, { status: 400 });
  }

  if (!RENTCAST_KEY || RENTCAST_KEY === "your_rentcast_api_key_here") {
    // Return mock data when key isn't configured
    return NextResponse.json({
      comps: [],
      note: "RentCast API key not configured — using estimates",
    });
  }

  const params = new URLSearchParams();
  // Forward all relevant params
  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    params.set(key, value);
  }

  try {
    const res = await fetch(
      `https://api.rentcast.io/v1/listings/sale?${params}`,
      {
        headers: {
          accept: "application/json",
          "X-Api-Key": RENTCAST_KEY,
        },
      }
    );

    if (!res.ok) {
      console.error("RentCast error:", res.status, await res.text());
      return NextResponse.json({ comps: [] });
    }

    const listings = await res.json();

    const comps = (Array.isArray(listings) ? listings : []).map(
      (l: {
        formattedAddress?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        price?: number;
        squareFootage?: number;
        bedrooms?: number;
        bathrooms?: number;
        yearBuilt?: number;
        listedDate?: string;
        distance?: number;
        propertyType?: string;
      }) => ({
        address: l.formattedAddress ?? "",
        city: l.city ?? "",
        state: l.state ?? "",
        zip: l.zipCode ?? "",
        price: l.price ?? 0,
        sqft: l.squareFootage ?? 0,
        pricePerSqft:
          l.price && l.squareFootage
            ? Math.round(l.price / l.squareFootage)
            : 0,
        beds: l.bedrooms ?? 0,
        baths: l.bathrooms ?? 0,
        yearBuilt: l.yearBuilt ?? 0,
        soldDate: l.listedDate ?? "",
        distance: l.distance ?? 0,
        propertyType: l.propertyType ?? "Single Family",
      })
    );

    return NextResponse.json({ comps });
  } catch (err) {
    console.error("RentCast fetch failed:", err);
    return NextResponse.json({ comps: [] });
  }
}
