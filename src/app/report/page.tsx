"use client";

/**
 * Carfax-style property investment report. Print-optimized layout — user
 * generates a PDF by hitting File → Print → Save as PDF in any browser.
 *
 * Usage: /report?lat=47.6378&lng=-122.1797
 *
 * Sections:
 *   1. Header banner with recommendation & severity badges
 *   2. Property identity
 *   3. Zoning verdict (city + state law)
 *   4. Hazard profile
 *   5. Sale & permit history
 *   6. Market context
 *   7. 6 strategies side-by-side
 *   8. Sensitivity / stress test (top strategy)
 *   9. Recommendation + red flags
 *  10. Footer with sources + disclaimer
 */

import { useEffect, useState } from "react";
import type { CarfaxReport } from "@/lib/report/build-report";

const fmtUsd = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
};
const fmtSqft = (n: number | null | undefined) => (n ? `${n.toLocaleString()} sqft` : "—");
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const fmtDate = (s: string | null | undefined) => (s ? s : "—");

function SeverityBadge({ label }: { label: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    clear: { bg: "#DFF3E5", fg: "#1B5A39" },
    low: { bg: "#E6F1FB", fg: "#0C447C" },
    moderate: { bg: "#FCE9C7", fg: "#7A4A07" },
    high: { bg: "#FAE0D7", fg: "#92341A" },
    severe: { bg: "#F8D9D8", fg: "#7A1A1A" },
  };
  const c = map[label] ?? map.clear;
  return (
    <span style={{ background: c.bg, color: c.fg, padding: "2px 10px", borderRadius: 11, fontSize: 11, fontWeight: 500 }}>
      {label.toUpperCase()}
    </span>
  );
}

function FeasibilityPill({ v }: { v: "permitted" | "conditional" | "not_allowed" }) {
  const styles: Record<string, { bg: string; fg: string; label: string }> = {
    permitted: { bg: "#DFF3E5", fg: "#1B5A39", label: "Permitted" },
    conditional: { bg: "#FCE9C7", fg: "#7A4A07", label: "Conditional" },
    not_allowed: { bg: "#F8D9D8", fg: "#7A1A1A", label: "Not allowed" },
  };
  const c = styles[v];
  return (
    <span style={{ background: c.bg, color: c.fg, padding: "2px 8px", borderRadius: 11, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
      {c.label}
    </span>
  );
}

export default function ReportPage() {
  const [report, setReport] = useState<CarfaxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lat = params.get("lat");
    const lng = params.get("lng");
    if (!lat || !lng) {
      setError("Missing lat,lng in URL.");
      setLoading(false);
      return;
    }
    fetch(`/api/report?lat=${lat}&lng=${lng}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setReport(d))
      .catch((e) => setError(e instanceof Error ? e.message : "fetch failed"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 40, fontFamily: "-apple-system, system-ui, sans-serif" }}>Loading report…</div>;
  if (error || !report) return <div style={{ padding: 40, fontFamily: "-apple-system, system-ui, sans-serif", color: "#7A1A1A" }}>Error: {error ?? "no report"}</div>;

  const r = report;

  return (
    <>
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 11pt; }
          .page-break { page-break-before: always; }
        }
        @page { margin: 0.5in; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; color: #1a1a1a; background: #fff; margin: 0; }
      `}</style>

      <div style={{ maxWidth: 840, margin: "0 auto", padding: "24px 32px", lineHeight: 1.55, fontSize: 14 }}>
        {/* Print bar */}
        <div className="no-print" style={{ background: "#E6F1FB", padding: "10px 14px", borderRadius: 8, marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#0C447C" }}>This is a print-optimized report. Use File → Print → Save as PDF.</span>
          <button onClick={() => window.print()} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#0C447C", color: "#fff", cursor: "pointer", fontSize: 13 }}>Print / Save PDF</button>
        </div>

        {/* HEADER */}
        <div style={{ borderBottom: "2px solid #1a1a1a", paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#5a6270", letterSpacing: "0.08em", textTransform: "uppercase" }}>LandMath · Property Investment Report</div>
          <h1 style={{ fontSize: 24, margin: "4px 0 8px", fontWeight: 500 }}>{r.identity.address || "(unnamed parcel)"}</h1>
          <div style={{ fontSize: 13, color: "#5a6270" }}>
            {r.identity.city}, {r.identity.state} {r.identity.zip} · PIN {r.identity.pin || "—"} · Generated {r.generatedAt.slice(0, 10)}
          </div>
        </div>

        {/* RECOMMENDATION BANNER */}
        <div style={{ background: r.recommendation.topStrategy ? "#DFF3E5" : "#F8D9D8", padding: 18, borderRadius: 10, marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: r.recommendation.topStrategy ? "#1B5A39" : "#7A1A1A", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>Recommendation</div>
          <div style={{ fontSize: 20, fontWeight: 500, color: r.recommendation.topStrategy ? "#1B5A39" : "#7A1A1A", margin: "4px 0 8px" }}>
            {r.recommendation.topStrategyLabel}
          </div>
          {r.recommendation.reasoning.map((line, i) => (
            <div key={i} style={{ fontSize: 13, color: r.recommendation.topStrategy ? "#1B5A39" : "#7A1A1A", marginBottom: 4 }}>
              {line}
            </div>
          ))}
        </div>

        {/* QUICK SCAN GRID */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
          <div style={{ border: "0.5px solid rgba(0,0,0,0.10)", padding: "10px 12px", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#5a6270" }}>Lot</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{fmtSqft(r.identity.lotSqft)}</div>
          </div>
          <div style={{ border: "0.5px solid rgba(0,0,0,0.10)", padding: "10px 12px", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#5a6270" }}>Zoning</div>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{r.zoning.code}</div>
          </div>
          <div style={{ border: "0.5px solid rgba(0,0,0,0.10)", padding: "10px 12px", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#5a6270" }}>Hazards</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
              {r.hazards ? <SeverityBadge label={r.hazards.severityLabel} /> : "—"}
            </div>
          </div>
          <div style={{ border: "0.5px solid rgba(0,0,0,0.10)", padding: "10px 12px", borderRadius: 8 }}>
            <div style={{ fontSize: 11, color: "#5a6270" }}>Last sale</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{r.history?.lastSalePrice ? fmtUsd(r.history.lastSalePrice) : "—"}</div>
            <div style={{ fontSize: 11, color: "#5a6270" }}>{r.history?.lastSaleDate ?? ""}</div>
          </div>
        </div>

        {/* SECTION: ZONING */}
        <Section title="1 · Zoning verdict">
          <KV label="Code">{r.zoning.code} {r.zoning.citySection ? <span style={{ color: "#5a6270" }}>· {r.zoning.citySection}</span> : null}</KV>
          <KV label="Minimum lot">{r.zoning.minLotSqft ? fmtSqft(r.zoning.minLotSqft) : "—"}</KV>
          <KV label="Max density">{r.zoning.maxDuPerAcre != null ? `${r.zoning.maxDuPerAcre} DU/acre` : "—"}</KV>
          <KV label="Use class">{r.zoning.kind || "—"}</KV>
          <KV label="Short plat allowed">{r.zoning.allowsShortPlat == null ? "—" : r.zoning.allowsShortPlat ? "yes" : "no"}</KV>
          <KV label="State-law overlay">
            {r.zoning.stateLawCitations.length === 0 ? <span style={{ color: "#5a6270" }}>none</span> : (
              <span>
                Effective max <strong>{r.zoning.effectiveMaxUnits} units</strong> per lot via:&nbsp;
                {r.zoning.stateLawCitations.map((c, i) => (
                  <span key={c.label}>
                    {i > 0 ? " · " : ""}
                    <a href={c.url} style={{ color: "#0C447C" }}>{c.label}</a>
                  </span>
                ))}
              </span>
            )}
          </KV>
          {r.zoning.note && <div style={{ fontSize: 12, color: "#5a6270", marginTop: 8 }}>{r.zoning.note}</div>}
        </Section>

        {/* SECTION: HAZARDS */}
        {r.hazards && (
          <Section title={`2 · Hazard profile — `} titleExtra={<SeverityBadge label={r.hazards.severityLabel} />}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              Composite severity {r.hazards.severityScore}/100 from KC GIS sensitive-areas, flood, landslide, and groundwater layers.
              {r.hazards.failureCount > 0 && <span style={{ color: "#7A4A07" }}> {r.hazards.failureCount} layer(s) failed — see full record.</span>}
            </div>
            {r.hazards.topCaveats.length === 0 ? (
              <div style={{ fontSize: 13, color: "#5a6270" }}>No hazard layers triggered on this parcel.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {r.hazards.topCaveats.map((c, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ color: c.severity === "block" ? "#7A1A1A" : c.severity === "warning" ? "#7A4A07" : "#5a6270", fontWeight: 500 }}>
                      [{c.severity}]
                    </span>{" "}
                    {c.text}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {/* SECTION: HISTORY */}
        {r.history && (
          <Section title="3 · Sale &amp; permit history">
            <KV label="Last sale">{r.history.badge || "—"}</KV>
            <KV label="Last buyer">{r.history.lastBuyerName?.trim() || "—"} {r.history.lastBuyerLooksInvestor && <span style={{ background: "#FCE9C7", color: "#7A4A07", padding: "1px 6px", borderRadius: 8, fontSize: 11, marginLeft: 6 }}>investor</span>}</KV>
            <KV label="Sales in last 3 yr">{r.history.recentSaleCount}</KV>
            {r.history.drillInUrl && (
              <div style={{ fontSize: 12, marginTop: 8 }}>
                <a href={r.history.drillInUrl} style={{ color: "#0C447C" }}>Full record at KC eRealProperty →</a>
              </div>
            )}
          </Section>
        )}

        {/* SECTION: MARKET */}
        <Section title="4 · Market context">
          <KV label="Neighborhood sample">{r.market.neighborhoodCount} parcels</KV>
          <KV label="Median home size">{fmtSqft(r.market.medianHomeSqft)}</KV>
          <KV label="Median lot size">{fmtSqft(r.market.medianLotSqft)}</KV>
          <KV label="Dominant typology">
            {r.market.typologyCommonest || "—"}
            {r.market.typologyShare != null && <span style={{ color: "#5a6270" }}> · {(r.market.typologyShare * 100).toFixed(0)}% of nearby parcels</span>}
          </KV>
          <KV label="Recent sales found">{r.market.recentSaleCount}</KV>
        </Section>

        {/* SECTION: STRATEGIES */}
        <Section title="5 · Strategy scores">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>Strategy</th>
                <th style={th}>Feasibility</th>
                <th style={th}>Profit</th>
                <th style={th}>ROI</th>
                <th style={th}>Annualized</th>
                <th style={th}>Months</th>
                <th style={th}>Confidence</th>
                <th style={th}>Range (bear→bull)</th>
              </tr>
            </thead>
            <tbody>
              {r.strategies.map((s) => (
                <tr key={s.strategy}>
                  <td style={td}><strong>{s.label}</strong></td>
                  <td style={td}><FeasibilityPill v={s.feasibility} /></td>
                  <td style={td}>{fmtUsd(s.projectedProfit)}</td>
                  <td style={td}>{fmtPct(s.roi)}</td>
                  <td style={td}>{fmtPct(s.annualizedRoi)}</td>
                  <td style={td}>{s.timelineMonths || "—"}</td>
                  <td style={td}>{s.confidenceScore != null ? `${Math.round(s.confidenceScore)} · ${s.confidenceLabel}` : "—"}</td>
                  <td style={td}>{s.profitRange ? `${fmtUsd(s.profitRange.min)} → ${fmtUsd(s.profitRange.max)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* SECTION: SENSITIVITY (top pick) */}
        {(() => {
          const top = r.strategies.find((s) => s.strategy === r.recommendation.topStrategy);
          if (!top || !top.profitRange) return null;
          return (
            <Section title={`6 · Stress test for "${top.label}"`}>
              <div style={{ fontSize: 13, marginBottom: 10 }}>{top.summary}</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  <tr><td style={td}>Bear case (rate +200, build +20%, sale -15%, +6mo)</td><td style={tdR}>{fmtUsd(top.bearProfit)}</td></tr>
                  <tr><td style={td}>Median scenario</td><td style={tdR}>{fmtUsd(top.profitRange.median)}</td></tr>
                  <tr><td style={td}>Baseline</td><td style={tdR}>{fmtUsd(top.projectedProfit)}</td></tr>
                  <tr><td style={td}>Bull case (rate -100, build -10%, sale +10%, on-time)</td><td style={tdR}>{fmtUsd(top.bullProfit)}</td></tr>
                  <tr><td style={td}>Breakeven sale price</td><td style={tdR}>{top.breakevenSalePct != null ? `${(top.breakevenSalePct * 100).toFixed(0)}% of baseline` : "—"}</td></tr>
                </tbody>
              </table>
            </Section>
          );
        })()}

        {/* SECTION: RED FLAGS */}
        {r.recommendation.redFlags.length > 0 && (
          <Section title="7 · Strategies to AVOID">
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {r.recommendation.redFlags.map((rf) => (
                <li key={rf.strategy} style={{ marginBottom: 6 }}>
                  <strong>{rf.label}</strong> — {rf.why}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* DISCLAIMER */}
        <div style={{ marginTop: 32, paddingTop: 14, borderTop: "0.5px solid rgba(0,0,0,0.10)", fontSize: 11, color: "#5a6270" }}>
          <strong>Disclaimer:</strong> This report aggregates public data (King County GIS, FEMA, APIllow, municipal codes) and runs financial scenarios for educational purposes. It is not a substitute for a licensed real-estate appraisal, geotechnical study, title report, or legal advice. Always verify zoning, easements, and hazards with the city or county before committing capital. Sale-price projections depend on neighborhood comp pools that vary in quality; treat all ranges as directional.
        </div>
      </div>
    </>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "0.5px solid rgba(0,0,0,0.15)", color: "#5a6270", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "0.5px solid rgba(0,0,0,0.06)", verticalAlign: "top" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };

function Section({ title, titleExtra, children }: { title: string; titleExtra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22, pageBreakInside: "avoid" }}>
      <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 8px", paddingBottom: 4, borderBottom: "0.5px solid rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: 8 }}>
        {title}
        {titleExtra}
      </h2>
      {children}
    </div>
  );
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, padding: "4px 0", fontSize: 13 }}>
      <div style={{ color: "#5a6270" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
