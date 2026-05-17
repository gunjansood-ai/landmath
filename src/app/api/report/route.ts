/**
 * GET /api/report?lat=...&lng=...
 *
 * Builds the full Carfax-style property investment report:
 *   - Pulls the property bundle from /api/property (zoning, hazards, history,
 *     neighborhood)
 *   - Runs the financial model + sensitivity for all 6 strategies
 *   - Produces a single JSON document the report page renders top-to-bottom
 *
 * Cached at the CDN for 1 hour — the underlying property pull is the
 * expensive part and changes rarely.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildCarfaxReport } from "@/lib/report/build-report";
import type { PropertyData, FinancingConfig } from "@/store/useStore";

export const runtime = "nodejs";
export const revalidate = 3_600;

const DEFAULT_FINANCING: FinancingConfig = {
  type: "traditional",
  downPaymentPct: 25,
  interestRate: 7.0,
  loanTermYears: 30,
  points: 0,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") ?? "");
  const lng = parseFloat(url.searchParams.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat,lng required" }, { status: 400 });
  }

  // Re-use the property aggregator to get a fully hydrated PropertyData.
  // We use absolute URL so server-side fetch works in Vercel / Node runtime.
  const base = process.env.NEXT_PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
  const r = await fetch(`${base}/api/property?lat=${lat}&lng=${lng}`, {
    headers: { "user-agent": "landmath-report-builder" },
  });
  if (!r.ok) {
    return NextResponse.json(
      { error: "property fetch failed", status: r.status },
      { status: 502 },
    );
  }
  const propJson = await r.json();

  // Re-shape into the PropertyData our report builder expects.
  const property: PropertyData = {
    id: `${lat.toFixed(4)},${lng.toFixed(4)}`,
    address: propJson.parcel?.address ?? "",
    city: propJson.parcel?.city ?? "",
    state: propJson.parcel?.state ?? "WA",
    zip: propJson.parcel?.zipCode ?? "",
    county: "King",
    lotSizeSqft: propJson.parcel?.lotSizeSqft ?? 0,
    zoningCode: propJson.parcel?.zoningCode ?? "Unknown",
    beds: 0, baths: 0, currentSqft: propJson.assessor?.totalSqft ?? 0,
    yearBuilt: propJson.assessor?.yearBuilt ?? 0,
    listingPrice: propJson.subjectListPrice ?? propJson.marketEstimate ?? 0,
    taxAssessedValue: propJson.parcel?.appraisedTotal ?? 0,
    annualPropertyTax: 0,
    stories: propJson.assessor?.stories ?? 1,
    garage: false, hoaMonthly: 0, floodZone: false,
    neighborhood: propJson.neighborhood,
    isKingCounty: propJson.isKingCounty,
    lat, lng,
    priceSource: propJson.priceSource,
    hazards: propJson.hazards,
    history: propJson.history,
    subjectAssessorUrl: propJson.parcel?.assessorUrl ?? null,
    subjectParcelViewerUrl: propJson.parcel?.parcelViewerUrl ?? null,
  };

  const report = buildCarfaxReport({
    property,
    financing: DEFAULT_FINANCING,
    tier: "standard",
  });
  return NextResponse.json(report);
}
