import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("input");
  const sessionToken = req.nextUrl.searchParams.get("sessionToken");

  if (!input || input.length < 3) {
    return NextResponse.json({ predictions: [] });
  }

  if (!API_KEY) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    input,
    types: "address",
    components: "country:us",
    key: API_KEY,
    ...(sessionToken && { sessiontoken: sessionToken }),
  });

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`
    );
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("Places API error:", data.status, data.error_message);
      return NextResponse.json({ predictions: [] });
    }

    const predictions = (data.predictions ?? []).map(
      (p: {
        place_id: string;
        description: string;
        structured_formatting: {
          main_text: string;
          secondary_text: string;
        };
      }) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text ?? p.description,
        secondaryText: p.structured_formatting?.secondary_text ?? "",
      })
    );

    return NextResponse.json({ predictions });
  } catch (err) {
    console.error("Places autocomplete failed:", err);
    return NextResponse.json({ predictions: [] });
  }
}
