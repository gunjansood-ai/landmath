"use client";

/**
 * LenderReport — a full-page, print-ready deal package.
 *
 * Rendered off-screen (hidden div) then captured by html2canvas → jsPDF.
 * Also renders visually on /report/[id] for shareable web view.
 */

import React from "react";
import type { AnalysisResult } from "@/store/useStore";
import { STRATEGIES, QUALITY_TIERS } from "@/lib/calculations";
import {
  buildReportData,
  type ReportData,
  type SensitivityRow,
  formatCurrency,
  formatPercent,
} from "@/lib/report";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  brand: "#16a34a",       // green-600
  brandDark: "#14532d",   // green-900
  bg: "#ffffff",
  surface: "#f9fafb",
  border: "#e5e7eb",
  text: "#111827",
  muted: "#6b7280",
  green: "#dcfce7",
  greenText: "#15803d",
  amber: "#fef9c3",
  amberText: "#92400e",
  red: "#fee2e2",
  redText: "#991b1b",
};

// ─── Mini building blocks ────────────────────────────────────────────────────

function Section({
  title,
  children,
  number,
}: {
  title: string;
  children: React.ReactNode;
  number: number;
}) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: `2px solid ${C.border}`,
          paddingBottom: 6,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: C.brand,
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {number}
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.brandDark, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function KV({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "green" | "red" | "amber";
}) {
  const bg = highlight === "green" ? C.green : highlight === "red" ? C.red : highlight === "amber" ? C.amber : "transparent";
  const color = highlight === "green" ? C.greenText : highlight === "red" ? C.redText : highlight === "amber" ? C.amberText : C.text;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 8px",
        background: bg,
        borderRadius: 4,
        marginBottom: 3,
      }}
    >
      <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

// ─── Sensitivity table ───────────────────────────────────────────────────────

function SensTable({ rows }: { rows: SensitivityRow[] }) {
  const cols = ["Scenario", "Sale Price", "Profit", "ROI", "Ann. ROI", "Verdict"];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ background: C.brandDark }}>
          {cols.map((c) => (
            <th
              key={c}
              style={{
                padding: "5px 8px",
                color: "#fff",
                fontWeight: 600,
                textAlign: c === "Scenario" ? "left" : "right",
                fontSize: 10,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const bg =
            r.saleChange === 0
              ? "#f0fdf4"
              : i % 2 === 0
              ? "#fff"
              : C.surface;
          const verdictColor =
            r.verdict === "strong" ? C.greenText : r.verdict === "marginal" ? C.amberText : C.redText;
          return (
            <tr key={i} style={{ background: bg }}>
              <td style={{ padding: "5px 8px", fontWeight: r.saleChange === 0 ? 700 : 400 }}>
                {r.label}
              </td>
              <td style={{ padding: "5px 8px", textAlign: "right" }}>
                {formatCurrency(r.profit + (/* totalProjectCost */ 0))}
              </td>
              <td
                style={{
                  padding: "5px 8px",
                  textAlign: "right",
                  color: r.profit < 0 ? C.redText : C.greenText,
                  fontWeight: 600,
                }}
              >
                {formatCurrency(r.profit)}
              </td>
              <td style={{ padding: "5px 8px", textAlign: "right" }}>
                {formatPercent(r.roi)}
              </td>
              <td style={{ padding: "5px 8px", textAlign: "right" }}>
                {formatPercent(r.annualizedRoi)}
              </td>
              <td
                style={{
                  padding: "5px 8px",
                  textAlign: "right",
                  color: verdictColor,
                  fontWeight: 600,
                  textTransform: "capitalize",
                }}
              >
                {r.verdict}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Timeline bar ─────────────────────────────────────────────────────────────

function TimelineBar({ analysis }: { analysis: AnalysisResult }) {
  const total = analysis.timelineMonths;
  const segments = [
    { label: "Permit", months: analysis.permitMonths, color: "#fbbf24" },
    { label: "Build", months: analysis.buildMonths, color: C.brand },
    { label: "Sell", months: analysis.sellMonths, color: "#60a5fa" },
  ];
  return (
    <div>
      <div style={{ display: "flex", height: 24, borderRadius: 4, overflow: "hidden", border: `1px solid ${C.border}` }}>
        {segments.map((s) => (
          <div
            key={s.label}
            style={{
              width: `${(s.months / total) * 100}%`,
              background: s.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            {s.months >= 2 ? `${s.months}mo` : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
        {segments.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <span style={{ fontSize: 10, color: C.muted }}>
              {s.label}: {s.months} mo
            </span>
          </div>
        ))}
        <span style={{ fontSize: 10, color: C.muted, marginLeft: "auto" }}>
          Total: <strong>{total} months</strong>
        </span>
      </div>
    </div>
  );
}

// ─── Comp table ───────────────────────────────────────────────────────────────

function CompsTable({ analysis }: { analysis: AnalysisResult }) {
  const comps = analysis.property.neighborhood?.sales?.slice(0, 8) ?? [];
  if (comps.length === 0) {
    return <p style={{ fontSize: 11, color: C.muted }}>No comparable sales data available.</p>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ background: C.surface }}>
          {["Address", "Sale Date", "Sale Price", "Sqft", "$/Sqft"].map((h) => (
            <th
              key={h}
              style={{
                padding: "4px 8px",
                borderBottom: `1px solid ${C.border}`,
                textAlign: h === "Address" ? "left" : "right",
                fontWeight: 600,
                color: C.muted,
                fontSize: 10,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {comps.map((c, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : C.surface }}>
            <td style={{ padding: "4px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.address.split(",")[0]}
            </td>
            <td style={{ padding: "4px 8px", textAlign: "right", color: C.muted }}>
              {c.saleDate ? new Date(c.saleDate).toLocaleDateString("en-US", { year: "numeric", month: "short" }) : "—"}
            </td>
            <td style={{ padding: "4px 8px", textAlign: "right", fontWeight: 600 }}>
              {formatCurrency(c.salePrice)}
            </td>
            <td style={{ padding: "4px 8px", textAlign: "right" }}>
              {c.sqftLiving ? c.sqftLiving.toLocaleString() : "—"}
            </td>
            <td style={{ padding: "4px 8px", textAlign: "right", color: C.brand }}>
              {c.pricePerSqft ? `$${c.pricePerSqft.toLocaleString()}` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Risk matrix ──────────────────────────────────────────────────────────────

function RiskMatrix({ analysis }: { analysis: AnalysisResult }) {
  type Risk = { category: string; risk: string; severity: "low" | "medium" | "high"; mitigation: string };

  const risks: Risk[] = [];

  // Feasibility risk
  if (analysis.feasibility === "conditional") {
    risks.push({
      category: "Regulatory",
      risk: "Strategy requires conditional approval or special permit",
      severity: "high",
      mitigation: "Consult city planning dept before making offer; budget 4–8 mo. for approval",
    });
  }

  // Market risk
  if (analysis.expectedSalePrice > 1500000) {
    risks.push({
      category: "Market",
      risk: "Luxury price point narrows buyer pool and increases days-on-market risk",
      severity: "medium",
      mitigation: "Stage professionally; price within 3–5% of comps; be prepared to hold",
    });
  }

  // Construction risk
  risks.push({
    category: "Construction",
    risk: "Material/labor cost overruns (historically 10–20% over budget)",
    severity: "medium",
    mitigation: "12% contingency already modeled; use fixed-price GC contract",
  });

  // Timeline risk
  if (analysis.timelineMonths > 24) {
    risks.push({
      category: "Timeline",
      risk: "Long timeline (>24 mo) increases exposure to interest rate and market shifts",
      severity: "medium",
      mitigation: "Lock financing early; phase construction if possible",
    });
  }

  // Capital risk
  risks.push({
    category: "Capital",
    risk: "Project requires significant upfront capital before any return",
    severity: "low",
    mitigation: "Model hard money + construction loan draw schedule to minimize cash drag",
  });

  // Zoning caveats
  if (analysis.caveats && analysis.caveats.some((c) => c.severity === "block")) {
    risks.push({
      category: "Zoning",
      risk: "Zoning data has gaps — subdivision or ADU rules not fully verified",
      severity: "high",
      mitigation: "Verify with city/county planning before committing capital",
    });
  }

  const sevColor = (s: Risk["severity"]) =>
    s === "high" ? C.red : s === "medium" ? C.amber : C.green;
  const sevTextColor = (s: Risk["severity"]) =>
    s === "high" ? C.redText : s === "medium" ? C.amberText : C.greenText;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ background: C.surface }}>
          {["Category", "Risk", "Severity", "Mitigation"].map((h) => (
            <th
              key={h}
              style={{
                padding: "4px 8px",
                borderBottom: `1px solid ${C.border}`,
                textAlign: "left",
                fontWeight: 600,
                color: C.muted,
                fontSize: 10,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {risks.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : C.surface }}>
            <td style={{ padding: "5px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{r.category}</td>
            <td style={{ padding: "5px 8px" }}>{r.risk}</td>
            <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
              <span
                style={{
                  background: sevColor(r.severity),
                  color: sevTextColor(r.severity),
                  padding: "2px 6px",
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: 10,
                  textTransform: "capitalize",
                }}
              >
                {r.severity}
              </span>
            </td>
            <td style={{ padding: "5px 8px", color: C.muted }}>{r.mitigation}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface LenderReportProps {
  analysis: AnalysisResult;
  aiNarrative?: string;
}

export default function LenderReport({ analysis, aiNarrative }: LenderReportProps) {
  const data: ReportData = buildReportData(analysis);
  const { property } = analysis;
  const strategy = STRATEGIES[analysis.strategy];
  const tier = QUALITY_TIERS[analysis.qualityTier];
  const isProfit = analysis.profit > 0;
  const roiColor = analysis.roi > 20 ? C.greenText : analysis.roi > 10 ? C.amberText : C.redText;

  return (
    <div
      id="lender-report"
      style={{
        fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
        background: C.bg,
        color: C.text,
        width: 750,
        padding: "32px 40px",
        boxSizing: "border-box",
        fontSize: 12,
        lineHeight: 1.5,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          borderBottom: `3px solid ${C.brand}`,
          paddingBottom: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.brandDark, letterSpacing: "-0.02em" }}>
            LandMath
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Investment Analysis Report</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{property.address}</div>
          <div style={{ fontSize: 11, color: C.muted }}>
            {property.city}, {property.state} {property.zip}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
            Generated: {data.generatedAt}
          </div>
        </div>
      </div>

      {/* ── 1. Executive Summary ─────────────────────────────────────────────── */}
      <Section title="Executive Summary" number={1}>
        <div
          style={{
            background: isProfit ? C.green : C.red,
            border: `1px solid ${isProfit ? "#86efac" : "#fca5a5"}`,
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recommended Strategy
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.brandDark, marginTop: 2 }}>
                {strategy.label}
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>{strategy.tagline}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: isProfit ? C.greenText : C.redText }}>
                {formatCurrency(analysis.profit)}
              </div>
              <div style={{ fontSize: 11, color: C.muted }}>Projected Profit</div>
            </div>
          </div>
        </div>

        <TwoCol>
          <Card>
            <CardTitle>Returns</CardTitle>
            <KV label="ROI" value={formatPercent(analysis.roi)} highlight={analysis.roi > 15 ? "green" : analysis.roi > 0 ? "amber" : "red"} />
            <KV label="Annualized ROI" value={formatPercent(analysis.annualizedRoi)} />
            <KV label="Total Project Cost" value={formatCurrency(analysis.totalProjectCost)} />
            <KV label="Expected Sale Price" value={formatCurrency(analysis.expectedSalePrice)} />
          </Card>
          <Card>
            <CardTitle>Project Specs</CardTitle>
            <KV label="Quality Tier" value={tier.label} />
            <KV label="Build Sqft" value={`${analysis.buildSqft.toLocaleString()} sqft`} />
            <KV label="Timeline" value={`${analysis.timelineMonths} months`} />
            <KV label="Feasibility" value={analysis.feasibility === "permitted" ? "✓ Permitted" : analysis.feasibility === "conditional" ? "⚠ Conditional" : "✗ Not Allowed"} highlight={analysis.feasibility === "permitted" ? "green" : analysis.feasibility === "conditional" ? "amber" : "red"} />
          </Card>
        </TwoCol>

        {aiNarrative && (
          <div
            style={{
              marginTop: 12,
              background: "#f0fdf4",
              border: `1px solid #86efac`,
              borderRadius: 6,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: C.brand, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
              AI Deal Analysis
            </div>
            <p style={{ fontSize: 11, color: C.text, margin: 0, lineHeight: 1.6 }}>{aiNarrative}</p>
          </div>
        )}
      </Section>

      {/* ── 2. Property Overview ─────────────────────────────────────────────── */}
      <Section title="Property Overview" number={2}>
        <TwoCol>
          <Card>
            <CardTitle>Subject Property</CardTitle>
            <KV label="Address" value={property.address} />
            <KV label="City / State" value={`${property.city}, ${property.state}`} />
            <KV label="ZIP" value={property.zip} />
            <KV label="County" value={property.county} />
            <KV label="Zoning" value={property.zoningCode || "Unknown"} />
            <KV label="Lot Size" value={`${property.lotSizeSqft.toLocaleString()} sqft`} />
          </Card>
          <Card>
            <CardTitle>Current Structure</CardTitle>
            <KV label="Beds / Baths" value={`${property.beds}bd / ${property.baths}ba`} />
            <KV label="Current Sqft" value={`${property.currentSqft.toLocaleString()} sqft`} />
            <KV label="Year Built" value={property.yearBuilt ? String(property.yearBuilt) : "—"} />
            <KV label="Listing Price" value={formatCurrency(property.listingPrice)} />
            <KV label="Tax Assessed" value={formatCurrency(property.taxAssessedValue)} />
            <KV label="Annual Taxes" value={formatCurrency(property.annualPropertyTax)} />
          </Card>
        </TwoCol>
      </Section>

      {/* ── 3. Financial Waterfall ───────────────────────────────────────────── */}
      <Section title="Financial Waterfall" number={3}>
        <TwoCol>
          <Card>
            <CardTitle>Costs</CardTitle>
            <KV label="Purchase Price" value={formatCurrency(property.listingPrice)} />
            <KV label="Closing Costs (~2.5%)" value={formatCurrency(analysis.acquisitionCost - property.listingPrice)} />
            <KV label="Construction" value={formatCurrency(analysis.constructionCost)} />
            <KV label="Holding Costs" value={formatCurrency(analysis.totalHoldingCost)} />
            <KV label="Selling Costs" value={formatCurrency(analysis.sellingCosts)} />
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 4 }}>
              <KV label="Total Project Cost" value={formatCurrency(analysis.totalProjectCost)} highlight="amber" />
            </div>
          </Card>
          <Card>
            <CardTitle>Returns</CardTitle>
            <KV label="Expected Sale Price" value={formatCurrency(analysis.expectedSalePrice)} />
            <KV label="Less: Selling Costs" value={`(${formatCurrency(analysis.sellingCosts)})`} />
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 4 }}>
              <KV label="Net Profit / (Loss)" value={formatCurrency(analysis.profit)} highlight={isProfit ? "green" : "red"} />
              <KV label="ROI" value={formatPercent(analysis.roi)} highlight={analysis.roi > 15 ? "green" : analysis.roi > 0 ? "amber" : "red"} />
              <KV label="Annualized ROI" value={formatPercent(analysis.annualizedRoi)} />
            </div>
            <div style={{ marginTop: 8 }}>
              <CardTitle>Financing</CardTitle>
              <KV label="Down Payment" value={`${analysis.financing.downPaymentPct}%`} />
              <KV label="Interest Rate" value={`${analysis.financing.interestRate}%`} />
              <KV label="Monthly Holding" value={`${formatCurrency(analysis.holdingCostMonthly)}/mo`} />
            </div>
          </Card>
        </TwoCol>
      </Section>

      {/* ── 4. Project Timeline ──────────────────────────────────────────────── */}
      <Section title="Project Timeline" number={4}>
        <Card>
          <TimelineBar analysis={analysis} />
        </Card>
      </Section>

      {/* ── 5. Sensitivity Analysis ──────────────────────────────────────────── */}
      <Section title="Sensitivity Analysis — Sale Price" number={5}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
          How does profit change if the final sale price varies from the base case? Construction costs held constant.
        </div>
        <SensTable rows={data.sensitivity} />
      </Section>

      {/* ── 6. Comparable Sales ──────────────────────────────────────────────── */}
      <Section title="Comparable Sales" number={6}>
        <CompsTable analysis={analysis} />
      </Section>

      {/* ── 7. Risk Matrix ───────────────────────────────────────────────────── */}
      <Section title="Risk Matrix" number={7}>
        <RiskMatrix analysis={analysis} />
      </Section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: `1px solid ${C.border}`,
          paddingTop: 12,
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 10, color: C.muted }}>
          Powered by <strong>LandMath</strong> · A tool by SNK Investments
        </span>
        <span style={{ fontSize: 10, color: C.muted }}>
          ⚠ Projections only. Not financial advice. Consult professionals before investing.
        </span>
      </div>
    </div>
  );
}
