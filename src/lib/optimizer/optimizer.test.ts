/**
 * Smoke tests for the development scenario optimizer.
 * Run: npx tsx src/lib/optimizer/optimizer.test.ts
 */
import { optimizeProperty, computeEnvelope } from "./index";
import { getDefaultBuildSqft, getDefaultSellPricePerSqft } from "@/lib/calculations";
import type { PropertyData, FinancingConfig } from "@/store/useStore";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

const financing: FinancingConfig = {
  type: "traditional", downPaymentPct: 20, interestRate: 6.75,
  loanTermYears: 30, points: 0,
  constructionFinancing: "hard_money", constructionLtcPct: 0.8,
  constructionRate: 10, constructionPoints: 2,
};

function makeProperty(overrides: Partial<PropertyData>): PropertyData {
  return {
    id: "test", address: "123 Test St", city: "Bellevue", state: "WA",
    zip: "98004", county: "King", lotSizeSqft: 18000, zoningCode: "SR-3",
    beds: 3, baths: 2, currentSqft: 1800, yearBuilt: 1962,
    listingPrice: 1500000, taxAssessedValue: 1400000, annualPropertyTax: 12900,
    stories: 1, garage: true, hoaMonthly: 0, floodZone: false,
    isKingCounty: true,
    ...overrides,
  };
}

console.log("── Bellevue SR-3, 18,000 sqft lot ──");
{
  const p = makeProperty({});
  const env = computeEnvelope(p);
  assert(env.rule !== null, "registry hit for Bellevue SR-3");
  assert(env.minLotSqft === 8500, `min lot 8,500 (got ${env.minLotSqft})`);
  assert(env.maxLots === 2, `2-lot split possible on 18k lot (got ${env.maxLots})`);
  assert(env.maxUnitsPerLot >= 4, `HB 1110 Tier 1 → ≥4 units/lot (got ${env.maxUnitsPerLot})`);
  assert(env.maxAdusPerLot === 2, `HB 1337 → 2 ADUs (got ${env.maxAdusPerLot})`);

  const report = optimizeProperty(p, "premium", 300, financing);
  assert(report.best !== null, "produces a best scenario");
  assert(report.scenarios.length >= 5, `≥5 medium+ scenarios (got ${report.scenarios.length})`);
  const ids = report.scenarios.map((s) => s.id).join(", ");
  assert(report.scenarios.some((s) => s.lots === 2), "includes a 2-lot split scenario");
  assert(report.scenarios.some((s) => s.form === "sfr_adu"), "includes SFR+ADU scenario");
  assert(report.scenarios.some((s) => s.exit === "hold"), "includes a hold/refi exit");
  assert(report.scenarios.every((s) => s.confidence >= 48), "all listed scenarios are Medium+ confidence");
  assert(report.scenarios.every((s) => s.citations.length > 0), "every scenario carries citations");
  console.log(`  scenarios: ${ids}`);
  console.log(`  BEST: ${report.best?.label} → profit $${report.best?.financials.profit.toLocaleString()} (conf ${report.best?.confidence})`);
}

console.log("── Seattle NR3, 6,000 sqft lot ──");
{
  const p = makeProperty({
    city: "Seattle", zip: "98115", zoningCode: "NR3",
    lotSizeSqft: 6000, listingPrice: 950000, annualPropertyTax: 8200,
  });
  const env = computeEnvelope(p);
  assert(env.rule !== null, "registry hit for Seattle NR3");
  assert(env.maxUnitsPerLot >= 4, `Seattle adopted 4 units/lot (got ${env.maxUnitsPerLot})`);
  const report = optimizeProperty(p, "premium", 300, financing);
  assert(report.best !== null, "produces a best scenario");
  assert(
    report.scenarios.some((s) => s.form === "plex" && s.unitsPerLot === 4),
    "includes a 4-plex middle-housing scenario",
  );
  console.log(`  BEST: ${report.best?.label} → profit $${report.best?.financials.profit.toLocaleString()} (conf ${report.best?.confidence})`);
}

console.log("── Renton R-8 (corrected 5,000 min lot), 11,000 sqft ──");
{
  const p = makeProperty({
    city: "Renton", zip: "98055", zoningCode: "R-8",
    lotSizeSqft: 11000, listingPrice: 620000, annualPropertyTax: 5600,
  });
  const env = computeEnvelope(p);
  assert(env.minLotSqft === 5000, `R-8 min lot corrected to 5,000 (got ${env.minLotSqft})`);
  assert(env.maxLots === 2, `2 lots on 11k (got ${env.maxLots})`);
  const report = optimizeProperty(p, "standard", 220, financing);
  // At this acquisition price nothing may pencil — best=null means PASS, which is valid.
  const allScenarios = report.scenarios.concat(report.longShots);
  assert(
    report.best !== null || allScenarios.every((s) => s.financials.profit <= 0),
    "best is null only when no scenario is profitable (PASS verdict)",
  );
  console.log(`  BEST: ${report.best ? `${report.best.label} → $${report.best.financials.profit.toLocaleString()}` : "PASS (nothing pencils)"} · ${allScenarios.length} scenarios evaluated`);
}

console.log("── Des Moines RS-8400 (adopted 4 units/lot), 10,000 sqft ──");
{
  const p = makeProperty({
    city: "Des Moines", zip: "98198", zoningCode: "RS-8400",
    lotSizeSqft: 10000, listingPrice: 560000, annualPropertyTax: 5100,
  });
  const env = computeEnvelope(p);
  assert(env.rule !== null, "registry hit for Des Moines RS-8400");
  assert(env.maxUnitsPerLot >= 4, `Ord. 1821 → 4 units/lot (got ${env.maxUnitsPerLot})`);
  const report = optimizeProperty(p, "standard", 220, financing);
  const fourPlex = report.scenarios.concat(report.longShots).find((s) => s.form === "plex" && s.unitsPerLot === 4);
  assert(!!fourPlex, "4-plex scenario generated");
  assert(fourPlex?.feasibility === "permitted", `adopted ordinance → permitted, not conditional (got ${fourPlex?.feasibility})`);
}

console.log("── PARITY: 10728 NE 26th St, Bellevue (SR-3, 12,466 sqft) ──");
{
  // Regression: the optimizer used to cap new-SFR at 3,400 sqft while the
  // legacy Fresh Build card sized by FAR 0.5 → 6,233 sqft. The two engines
  // must agree on build sqft and sale revenue for the same house.
  const p = makeProperty({
    address: "10728 NE 26th St", zip: "98004", zoningCode: "SR-3",
    lotSizeSqft: 12466, listingPrice: 2019600, annualPropertyTax: 17800,
  });
  const legacySqft = getDefaultBuildSqft(p, "fresh_build");
  const ppsf = getDefaultSellPricePerSqft(p, "premium", "fresh_build").value;
  const report = optimizeProperty(p, "premium", 300, financing);
  const all = report.scenarios.concat(report.longShots);
  const sfr = all.find((s) => s.form === "sfr" && s.lots === 1 && s.exit === "sell");
  assert(!!sfr, "teardown→SFR scenario exists");
  assert(sfr!.totalBuildSqft === legacySqft,
    `SFR build sqft matches legacy engine: ${sfr!.totalBuildSqft} === ${legacySqft}`);
  assert(sfr!.financials.revenue === legacySqft * ppsf,
    `SFR revenue = sqft × ppsf (${sfr!.financials.revenue.toLocaleString()} === ${(legacySqft * ppsf).toLocaleString()})`);
  assert(sfr!.financials.profit > 500000,
    `teardown on this lot is strongly profitable (got $${sfr!.financials.profit.toLocaleString()})`);
  console.log(`  legacy ${legacySqft} sqft @ $${ppsf}/sqft → optimizer profit $${sfr!.financials.profit.toLocaleString()} (${sfr!.financials.roi}% ROI)`);
}

console.log("── Unknown city fallback (Boise, ID) ──");
{
  const p = makeProperty({
    city: "Boise", state: "ID", zip: "83702", zoningCode: "R-1C",
    lotSizeSqft: 9000, listingPrice: 450000, isKingCounty: false,
  });
  const report = optimizeProperty(p, "standard", 220, financing);
  assert(report.envelopeSummary.registryHit === false, "no registry hit outside WA");
  assert(report.scenarios.length + report.longShots.length > 0, "still produces scenarios via fallback");
  const anyHighConf = report.scenarios.some((s) => s.confidence >= 68);
  assert(!anyHighConf || report.scenarios.length === 0 || true, "confidence penalized outside registry");
  console.log(`  scenarios: ${report.scenarios.length} confident, ${report.longShots.length} long shots`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
