/**
 * GET /api/history?pin=...
 *
 * Returns the sale + (eventually) permit history for a King County parcel.
 * Currently returns last-3-year sales from the KC PropertyInfo sales layer
 * plus drill-in links to eRealProperty, parcel viewer, and the Recorder.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchKcHistory } from "@/lib/history/kc-history";

export const runtime = "nodejs";
export const revalidate = 86_400;

export async function GET(req: NextRequest) {
  const pin = new URL(req.url).searchParams.get("pin");
  if (!pin) {
    return NextResponse.json({ error: "pin required" }, { status: 400 });
  }
  const history = await fetchKcHistory(pin);
  return NextResponse.json(history);
}
