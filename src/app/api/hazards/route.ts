/**
 * GET /api/hazards?lat=...&lng=...
 *
 * Returns the full King County GIS hazard report for a point: FEMA flood
 * zones, landslide / steep slope / rock fall, seismic + coal mine, wetlands,
 * streams, aquifer protection, and any recorded Sensitive Area Notice on
 * title. Each layer is queried in parallel and degrades gracefully on
 * individual layer failures.
 *
 * Cached at the CDN for 24 hours per lat/lng pair — hazard layers update
 * infrequently and the queries are non-trivial to run live.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchKcHazards } from "@/lib/hazards/kc-gis";

export const runtime = "nodejs";
export const revalidate = 86_400; // 24 hours

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const latStr = url.searchParams.get("lat");
  const lngStr = url.searchParams.get("lng");

  if (!latStr || !lngStr) {
    return NextResponse.json(
      { error: "Missing required params: lat, lng" },
      { status: 400 },
    );
  }
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng must be numeric" },
      { status: 400 },
    );
  }

  // Rough King County bounding box — we don't run KC-only queries on points
  // hundreds of miles away. Outside this box every layer would return zero.
  const inKcBox =
    lat >= 47.05 && lat <= 47.80 && lng >= -122.55 && lng <= -121.05;
  if (!inKcBox) {
    return NextResponse.json({
      point: { lat, lng },
      outOfRegion: true,
      severityScore: 0,
      severityLabel: "clear",
      caveats: [],
      failures: ["point outside King County GIS coverage"],
    });
  }

  try {
    const report = await fetchKcHazards(lat, lng);
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      {
        error: "hazard query failed",
        detail: e instanceof Error ? e.message : "unknown error",
      },
      { status: 502 },
    );
  }
}
