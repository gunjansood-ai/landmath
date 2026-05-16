import {
  Strategy,
  QualityTier,
  FinancingConfig,
  PropertyData,
  AnalysisResult,
} from "@/store/useStore";

// Cost per sqft by quality tier (WA state defaults)
export const DEFAULT_COST_PER_SQFT: Record<QualityTier, number> = {
  standard: 220,
  premium: 300,
  luxury: 425,
  ultra_luxury: 650,
};

// Quality tier display info
export const QUALITY_TIERS: Record<
  QualityTier,
  { label: string; description: string; timeMultiplier: number }
> = {
  standard: {
    label: "Standard",
    description: "Builder-grade finishes, basic systems",
    timeMultiplier: 1.0,
  },
  premium: {
    label: "Premium",
    description: "Upgraded finishes, hardwood, quartz, energy efficient",
    timeMultiplier: 1.2,
  },
  luxury: {
    label: "Luxury",
    description: "High-end finishes, smart home, designer touches",
    timeMultiplier: 1.5,
  },
  ultra_luxury: {
    label: "Ultra-Luxury",
    description: "Fully custom, imported materials, architectural",
    timeMultiplier: 2.0,
  },
};

// Strategy display info
export const STRATEGIES: Record<
  Strategy,
  { label: string; tagline: string; icon: string }
> = {
  fresh_build: {
    label: "Fresh Build",
    tagline: "Tear it down, start from scratch",
    icon: "building",
  },
  split_build: {
    label: "Split & Build",
    tagline: "Divide the lot, multiply the profit",
    icon: "scissors",
  },
  main_adu: {
    label: "Main + ADU",
    tagline: "Primary home plus income units",
    icon: "home",
  },
  flip_fix: {
    label: "Flip & Fix",
    tagline: "Renovate and cash out",
    icon: "wrench",
  },
  pass: {
    label: "Pass",
    tagline: "The math doesn't work",
    icon: "x",
  },
};

// Zoning feasibility check (simplified for MVP)
export function checkFeasibility(
  property: PropertyData,
  strategy: Strategy
): "permitted" | "conditional" | "not_allowed" {
  const lotSize = property.lotSizeSqft;

  switch (strategy) {
    case "fresh_build":
      return "permitted"; // Almost always allowed in residential zones
    case "split_build":
      // Need minimum lot size for subdivision (typically 2x minimum)
      if (lotSize >= 10000) return "permitted";
      if (lotSize >= 7500) return "conditional";
      return "not_allowed";
    case "main_adu":
      // ADUs broadly permitted in WA since 2023
      if (lotSize >= 5000) return "permitted";
      if (lotSize >= 4000) return "conditional";
      return "not_allowed";
    case "flip_fix":
      return "permitted";
    default:
      return "not_allowed";
  }
}

// Calculate maximum buildable sqft based on lot and FAR
function getMaxBuildableSqft(property: PropertyData, strategy: Strategy): number {
  const lotSize = property.lotSizeSqft;
  const far = 0.5; // Default FAR for residential zones
  const maxCoverage = 0.35;
  const maxFootprint = lotSize * maxCoverage;

  switch (strategy) {
    case "fresh_build":
      return Math.min(lotSize * far, maxFootprint * 2.5); // up to 2.5 stories
    case "split_build": {
      const lotsCount = lotSize >= 12000 ? 2 : 1;
      const perLotSize = lotSize / lotsCount;
      return perLotSize * far * lotsCount;
    }
    case "main_adu": {
      const mainSqft = Math.min(lotSize * far * 0.7, 3500);
      const aduSqft = Math.min(1000, lotSize * 0.1);
      const aduCount = lotSize >= 8000 ? 2 : 1;
      return mainSqft + aduSqft * aduCount;
    }
    case "flip_fix":
      return property.currentSqft + Math.min(500, lotSize * 0.05);
    default:
      return 0;
  }
}

// Estimate permit timeline by strategy
function getPermitMonths(strategy: Strategy): number {
  switch (strategy) {
    case "fresh_build":
      return 6;
    case "split_build":
      return 10; // Short plat adds time
    case "main_adu":
      return 5;
    case "flip_fix":
      return 2;
    default:
      return 0;
  }
}

// Estimate build time
function getBuildMonths(strategy: Strategy, tier: QualityTier, sqft: number): number {
  const baseMonths = Math.ceil(sqft / 400); // ~400 sqft per month base
  const multiplier = QUALITY_TIERS[tier].timeMultiplier;
  const strategyMultiplier = strategy === "split_build" ? 1.3 : 1.0;
  return Math.ceil(baseMonths * multiplier * strategyMultiplier);
}

// Estimate days on market → months
function getSellMonths(tier: QualityTier, price: number): number {
  if (price > 2000000) return 4;
  if (price > 1000000) return 3;
  if (tier === "standard") return 2;
  return 2.5;
}

// Monthly mortgage payment (P&I)
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number,
  interestOnly: boolean = false
): number {
  if (principal <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (interestOnly) {
    return principal * monthlyRate;
  }
  const numPayments = termYears * 12;
  if (monthlyRate === 0) return principal / numPayments;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1)
  );
}

// Estimate sale price based on area comps (simplified)
function estimateSalePrice(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  buildSqft: number
): number {
  // Base comp price per sqft (varies by tier and area)
  const baseCompPricePerSqft: Record<QualityTier, number> = {
    standard: 350,
    premium: 500,
    luxury: 700,
    ultra_luxury: 1000,
  };

  const pricePerSqft = baseCompPricePerSqft[tier];

  switch (strategy) {
    case "fresh_build":
      return buildSqft * pricePerSqft;
    case "split_build": {
      const homes = property.lotSizeSqft >= 12000 ? 2 : 1;
      return (buildSqft / homes) * pricePerSqft * homes;
    }
    case "main_adu": {
      const mainValue = buildSqft * 0.75 * pricePerSqft;
      const aduRentalValue = buildSqft * 0.25 * pricePerSqft * 0.85;
      return mainValue + aduRentalValue;
    }
    case "flip_fix": {
      // Renovated homes sell at slight discount to new
      return buildSqft * pricePerSqft * 0.8;
    }
    default:
      return 0;
  }
}

// Default sale price per sqft by tier (exported for UI hints)
export const DEFAULT_SELL_PRICE_PER_SQFT: Record<QualityTier, number> = {
  standard: 350,
  premium: 500,
  luxury: 700,
  ultra_luxury: 1000,
};

// Get the default buildable sqft for a strategy (exported for UI hints)
export function getDefaultBuildSqft(property: PropertyData, strategy: Strategy): number {
  return Math.round(getMaxBuildableSqft(property, strategy));
}

// Per-strategy overrides
export interface StrategyOverrides {
  buildSqft?: number;
  sellPricePerSqft?: number;
}

// Main analysis calculation
export function calculateAnalysis(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  overrides?: StrategyOverrides
): AnalysisResult {
  const feasibility = checkFeasibility(property, strategy);
  const buildSqft = overrides?.buildSqft ?? getMaxBuildableSqft(property, strategy);
  const permitMonths = getPermitMonths(strategy);
  const buildMonths = getBuildMonths(strategy, tier, buildSqft);
  const expectedSalePrice = overrides?.sellPricePerSqft
    ? buildSqft * overrides.sellPricePerSqft
    : estimateSalePrice(property, strategy, tier, buildSqft);
  const sellMonths = Math.ceil(getSellMonths(tier, expectedSalePrice));
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // Acquisition costs
  const purchasePrice = property.listingPrice;
  const closingCosts = purchasePrice * 0.025; // 2.5%
  const downPayment = purchasePrice * (financing.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const acquisitionCost = purchasePrice + closingCosts;

  // Construction costs
  const demolitionCost = strategy !== "flip_fix" ? 20000 : 0;
  const architectFees = strategy !== "flip_fix" ? buildSqft * costPerSqft * 0.05 : 0;
  const permitFees = strategy === "split_build" ? 35000 : strategy === "flip_fix" ? 5000 : 20000;
  const contingency = buildSqft * costPerSqft * 0.12;
  const landscaping = strategy !== "flip_fix" ? 25000 : 5000;
  const constructionCost =
    buildSqft * costPerSqft +
    demolitionCost +
    architectFees +
    permitFees +
    contingency +
    landscaping;

  // Monthly holding costs
  const monthlyMortgage = calculateMonthlyPayment(
    loanAmount,
    financing.interestRate,
    financing.loanTermYears,
    financing.type === "interest_only"
  );
  const monthlyTax = property.annualPropertyTax / 12;
  const monthlyInsurance = (purchasePrice * 0.004) / 12; // ~0.4% annually
  const monthlyHoa = property.hoaMonthly || 0;
  const monthlyUtilities = 300;
  const holdingCostMonthly =
    monthlyMortgage + monthlyTax + monthlyInsurance + monthlyHoa + monthlyUtilities;
  const totalHoldingCost = holdingCostMonthly * timelineMonths;

  // Selling costs
  const agentCommission = expectedSalePrice * 0.05;
  const exciseTax = expectedSalePrice * 0.018; // WA excise tax ~1.8%
  const sellerConcessions = expectedSalePrice * 0.01;
  const stagingCosts = strategy !== "flip_fix" ? 5000 : 3000;
  const sellingCosts = agentCommission + exciseTax + sellerConcessions + stagingCosts;

  // Totals
  const totalProjectCost = acquisitionCost + constructionCost + totalHoldingCost + sellingCosts;
  const profit = expectedSalePrice - totalProjectCost;
  const totalCashInvested = downPayment + constructionCost + totalHoldingCost + closingCosts;
  const roi = totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0;
  const annualizedRoi = timelineMonths > 0 ? roi * (12 / timelineMonths) : 0;

  // Generate recommendation text
  let recommendation = "";
  if (feasibility === "not_allowed") {
    recommendation = `Not feasible: ${STRATEGIES[strategy].label} is not permitted under current zoning (${property.zoningCode}).`;
  } else if (profit > 0 && roi > 15) {
    recommendation = `Strong opportunity. ${STRATEGIES[strategy].label} projects ${formatCurrency(profit)} profit (${roi.toFixed(1)}% ROI) over ${timelineMonths} months.`;
  } else if (profit > 0) {
    recommendation = `Marginal deal. ${formatCurrency(profit)} profit but ${roi.toFixed(1)}% ROI may not justify the risk and effort over ${timelineMonths} months.`;
  } else {
    recommendation = `Not viable. Projects a ${formatCurrency(Math.abs(profit))} loss. Consider a different strategy or pass on this property.`;
  }

  return {
    id: `${property.id}-${strategy}-${Date.now()}`,
    propertyId: property.id,
    property,
    strategy,
    qualityTier: tier,
    costPerSqft,
    buildSqft: Math.round(buildSqft),
    financing,
    acquisitionCost: Math.round(acquisitionCost),
    constructionCost: Math.round(constructionCost),
    holdingCostMonthly: Math.round(holdingCostMonthly),
    totalHoldingCost: Math.round(totalHoldingCost),
    sellingCosts: Math.round(sellingCosts),
    totalProjectCost: Math.round(totalProjectCost),
    expectedSalePrice: Math.round(expectedSalePrice),
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    annualizedRoi: Math.round(annualizedRoi * 10) / 10,
    timelineMonths,
    permitMonths,
    buildMonths,
    sellMonths,
    feasibility,
    recommendation,
    createdAt: new Date().toISOString(),
  };
}

// Run all strategies and find best
export function analyzeAllStrategies(
  property: PropertyData,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  strategyOverrides?: Partial<Record<Strategy, StrategyOverrides>>
): { analyses: AnalysisResult[]; recommended: Strategy } {
  const strategies: Strategy[] = ["fresh_build", "split_build", "main_adu", "flip_fix"];
  const analyses = strategies.map((s) =>
    calculateAnalysis(property, s, tier, costPerSqft, financing, strategyOverrides?.[s])
  );

  // Score and rank
  const scored = analyses
    .filter((a) => a.feasibility !== "not_allowed")
    .map((a) => {
      const roiScore = a.roi * 0.3;
      const annualizedScore = a.annualizedRoi * 0.25;
      const riskScore =
        (a.feasibility === "permitted" ? 10 : 5) *
        (a.strategy === "flip_fix" ? 1.2 : 1) *
        0.2;
      const capitalScore = (1 - a.totalProjectCost / 5000000) * 10 * 0.15;
      const certaintyScore = (a.feasibility === "permitted" ? 10 : 5) * 0.1;
      return { ...a, score: roiScore + annualizedScore + riskScore + capitalScore + certaintyScore };
    })
    .sort((a, b) => b.score - a.score);

  const recommended: Strategy =
    scored.length > 0 && scored[0].profit > 0 ? scored[0].strategy : "pass";

  return { analyses, recommended };
}

// Utility
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
