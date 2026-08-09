import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisResult, PropertyData } from "@/store/useStore";
import type { ScenarioResult } from "@/lib/optimizer";
import { formatCurrency, formatPercent, STRATEGIES, QUALITY_TIERS } from "@/lib/calculations";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(): string {
  return `You are a seasoned real estate investment analyst at LandMath. You give direct, data-driven deal analysis — like a smart investing partner who speaks in numbers, not platitudes.

Your tone: confident, direct, specific. Never vague. Reference specific numbers from the deal. Flag real risks, not generic disclaimers. Keep it concise — investors are busy.

When generating a narrative:
- Lead with the most important insight about this specific deal
- Reference actual numbers (profit, ROI, lot size, zoning, timeline)
- Name the #1 risk specific to this deal
- End with one concrete next step the investor should take

When answering a follow-up question:
- Stay tightly focused on the question
- Reference the deal data provided
- Give a direct answer, not "it depends"`;
}

/**
 * Deal context from the OPTIMIZER's winning scenario — this is what the user
 * sees as "Best play for this land", so the narrative must describe THIS,
 * not the legacy 6-strategy card.
 */
function buildScenarioContext(scenario: ScenarioResult, property: PropertyData): string {
  const f = scenario.financials;
  const comps = property.neighborhood?.sales?.slice(0, 5) ?? [];
  return `
DEAL SUMMARY
============
Property: ${property.address}, ${property.city}, ${property.state} ${property.zip}
Lot Size: ${property.lotSizeSqft.toLocaleString()} sqft
Zoning: ${property.zoningCode || "Unknown"}
Current Structure: ${property.beds}bd/${property.baths}ba, ${property.currentSqft.toLocaleString()} sqft, built ${property.yearBuilt || "unknown"}
Listing Price: ${formatCurrency(property.listingPrice)}
Annual Property Tax: ${formatCurrency(property.annualPropertyTax)}
Flood Zone: ${property.floodZone ? "Yes" : "No"}

RECOMMENDED PLAY (scenario optimizer's #1 of all legal development combos)
==========================================================================
${scenario.label}
Form: ${scenario.form} · Exit: ${scenario.exit} · ${scenario.lots} lot(s) · ${scenario.totalUnits} unit(s) · ${scenario.totalBuildSqft.toLocaleString()} sqft new construction
Feasibility: ${scenario.feasibility}
Confidence: ${scenario.confidence}/100 (${scenario.confidenceLabel})

FINANCIAL MODEL
===============
${scenario.exit === "hold" ? "Stabilized Value" : "Sale Revenue"}: ${formatCurrency(f.revenue)}
Total Project Cost: ${formatCurrency(f.totalProjectCost)}
  - Acquisition (incl. closing): ${formatCurrency(f.acquisitionCost)}
  - Construction (all-in): ${formatCurrency(f.constructionCost)}
  - Holding + Loan Costs: ${formatCurrency(f.holdingCost)}
  ${scenario.exit === "sell" ? `- Selling Costs: ${formatCurrency(f.sellingCosts)}` : ""}
${scenario.exit === "hold" ? "Equity Created" : "Projected Profit"}: ${formatCurrency(f.profit)}
ROI (on avg cash deployed): ${f.roi}%
Annualized ROI: ${f.annualizedRoi}%
Peak Cash Required: ${formatCurrency(f.totalCashInvested)}
Avg Cash Deployed: ${formatCurrency(f.avgCashDeployed ?? f.totalCashInvested)}
Timeline: ${f.timelineMonths} months
${scenario.exit === "hold" ? `NOI: ${formatCurrency(f.noi ?? 0)} @ ${f.capRate}% cap · Refi Loan: ${formatCurrency(f.refiLoan ?? 0)} · Cash Left In: ${formatCurrency(f.cashLeftInDeal ?? 0)} · Annual Cash Flow: ${formatCurrency(f.annualCashFlow ?? 0)}` : ""}

WHY THIS WINS (optimizer reasoning)
===================================
${scenario.why.map((w) => `  - ${w}`).join("\n")}

LEGAL BASIS
===========
${scenario.citations.map((c) => `  - ${c.label}`).join("\n") || "  (none)"}

CAVEATS / VERIFICATION FLAGS
============================
${scenario.notes.map((n) => `  - ${n}`).join("\n") || "  (none)"}

NEIGHBORHOOD CONTEXT
====================
${property.neighborhood ? `Nearby comps (${property.neighborhood.sales.length} total):
${comps.map((c) => `  - ${c.address.split(",")[0]}: ${formatCurrency(c.salePrice)}${c.sqftLiving ? ` (${c.sqftLiving.toLocaleString()} sqft, $${c.pricePerSqft}/sqft)` : ""} sold ${c.saleDate || "recently"}`).join("\n")}
Neighborhood median home sqft: ${property.neighborhood.medianHomeSqft ? property.neighborhood.medianHomeSqft.toLocaleString() : "unknown"}
Recent multi-unit permits nearby: ${property.neighborhood.recentMultiUnitCount}` : "No neighborhood data available."}
`.trim();
}

function buildDealContext(analysis: AnalysisResult): string {
  const { property } = analysis;
  const strategy = STRATEGIES[analysis.strategy];
  const tier = QUALITY_TIERS[analysis.qualityTier];
  const comps = property.neighborhood?.sales?.slice(0, 5) ?? [];

  return `
DEAL SUMMARY
============
Property: ${property.address}, ${property.city}, ${property.state} ${property.zip}
Lot Size: ${property.lotSizeSqft.toLocaleString()} sqft
Zoning: ${property.zoningCode || "Unknown"}
Current Structure: ${property.beds}bd/${property.baths}ba, ${property.currentSqft.toLocaleString()} sqft, built ${property.yearBuilt || "unknown"}
Listing Price: ${formatCurrency(property.listingPrice)}
Annual Property Tax: ${formatCurrency(property.annualPropertyTax)}
Flood Zone: ${property.floodZone ? "Yes" : "No"}

RECOMMENDED STRATEGY: ${strategy.label}
Tagline: ${strategy.tagline}
Quality Tier: ${tier.label}
Feasibility: ${analysis.feasibility}
Build Sqft: ${analysis.buildSqft.toLocaleString()} sqft

FINANCIAL MODEL
===============
Total Project Cost: ${formatCurrency(analysis.totalProjectCost)}
  - Acquisition: ${formatCurrency(analysis.acquisitionCost)}
  - Construction: ${formatCurrency(analysis.constructionCost)}
  - Holding Costs: ${formatCurrency(analysis.totalHoldingCost)} (${formatCurrency(analysis.holdingCostMonthly)}/mo)
  - Selling Costs: ${formatCurrency(analysis.sellingCosts)}

Expected Sale Price: ${formatCurrency(analysis.expectedSalePrice)}
Projected Profit: ${formatCurrency(analysis.profit)}
ROI: ${formatPercent(analysis.roi)}
Annualized ROI: ${formatPercent(analysis.annualizedRoi)}

TIMELINE
========
Permit: ${analysis.permitMonths} months
Build: ${analysis.buildMonths} months
Sell: ${analysis.sellMonths} months
Total: ${analysis.timelineMonths} months

FINANCING
=========
Type: ${analysis.financing.type}
Down Payment: ${analysis.financing.downPaymentPct}%
Interest Rate: ${analysis.financing.interestRate}%

NEIGHBORHOOD CONTEXT
====================
${property.neighborhood ? `Nearby comps (${property.neighborhood.sales.length} total):
${comps.map((c) => `  - ${c.address.split(",")[0]}: ${formatCurrency(c.salePrice)}${c.sqftLiving ? ` (${c.sqftLiving.toLocaleString()} sqft, $${c.pricePerSqft}/sqft)` : ""} sold ${c.saleDate || "recently"}`).join("\n")}

Neighborhood median home sqft: ${property.neighborhood.medianHomeSqft ? property.neighborhood.medianHomeSqft.toLocaleString() : "unknown"}
Recent multi-unit permits nearby: ${property.neighborhood.recentMultiUnitCount}` : "No neighborhood data available."}

CONFIDENCE SCORE: ${analysis.confidence ?? "N/A"}/100 (${analysis.confidenceLabel ?? "N/A"})
${analysis.caveats && analysis.caveats.length > 0 ? `\nKEY CAVEATS:\n${analysis.caveats.map((c) => `  [${c.severity.toUpperCase()}] ${c.text}`).join("\n")}` : ""}
`.trim();
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured. Add it to .env.local and Vercel." },
      { status: 503 }
    );
  }

  let body: {
    analysis?: AnalysisResult;
    scenario?: ScenarioResult;
    property?: PropertyData;
    question?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { analysis, scenario, property, question, history = [] } = body;
  if (!analysis && !(scenario && property)) {
    return NextResponse.json({ error: "analysis or scenario+property required" }, { status: 400 });
  }

  // Prefer the optimizer's best play — that's the verdict the user is looking at.
  const dealContext =
    scenario && property
      ? buildScenarioContext(scenario, property)
      : buildDealContext(analysis!);

  // First call: generate the narrative (no question = initial analysis)
  // Follow-up calls: answer a specific question using the deal context
  const userMessage = question
    ? `Based on this deal, answer the following question concisely:\n\n${question}\n\nDeal context:\n${dealContext}`
    : `Generate a deal narrative for this investment. Write 2-3 focused paragraphs: (1) the deal thesis — why this specific strategy makes sense here, referencing exact numbers; (2) the key risks specific to this property and market; (3) the single most important action the investor should take next. Be direct and specific.\n\nDeal context:\n${dealContext}`;

  // Build message history for follow-ups
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history,
    { role: "user", content: userMessage },
  ];

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: buildSystemPrompt(),
      messages,
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    return NextResponse.json({ narrative: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Claude API error:", msg);
    return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 500 });
  }
}
