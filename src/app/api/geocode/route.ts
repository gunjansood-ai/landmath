import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId");
  const address = req.nextUrl.searchParams.get("address");

  if (!placeId && !address) {
    return NextResponse.json({ error: "placeId or address required" }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 });
  }

  // Direct-address path bypasses autocomplete entirely. We use this when the
  // user types a specific address and we want the literal interpretation —
  // not Google's best-guess prediction (which on rare street names like
  // "Upland Rd Medina" can substitute a more common nearby street like
  // "Midland Road").
  const url = placeId
    ? `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${API_KEY}`
    : `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address!)}&key=${API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.[0]) {
      return NextResponse.json({ result: null });
    }

    const result = data.results[0];
    const components = result.address_components ?? [];

    const getComponent = (type: string, useShort = false): string => {
      const c = components.find((c: { types: string[]; long_name: string; short_name: string }) =>
        c.types.includes(type)
      );
      return useShort ? c?.short_name ?? "" : c?.long_name ?? "";
    };

    const parsed = {
      formattedAddress: result.formatted_address,
      streetNumber: getComponent("street_number"),
      street: getComponent("route"),
      unit: getComponent("subpremise"), // apt/unit number — indicates condo/multi-unit
      city: getComponent("locality") || getComponent("sublocality"),
      county: getComponent("administrative_area_level_2").replace(" County", ""),
      state: getComponent("administrative_area_level_1", true),
      zip: getComponent("postal_code"),
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      placeTypes: result.types ?? [], // e.g. ["subpremise", "premise"]
    };

    return NextResponse.json({ result: parsed });
  } catch (err) {
    console.error("Geocode failed:", err);
    return NextResponse.json({ result: null });
  }
}
