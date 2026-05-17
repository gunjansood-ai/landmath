/**
 * Sensitivity analysis on the financial pro forma.
 *
 * Takes a "base case" projected profit for a strategy and reruns it under
 * stress scenarios so the investor sees a RANGE rather than a single
 * point estimate. Carfax-style: tell people the downside before they buy.
 *
 * Stresses applied (each in isolation, then together as the bear case):
 *   - Interest rate ±200 bps
 *   - Build cost ±20%
 *   - Sale price ±15% (proxy for comp $/sqft variance)
 *   - Timeline +6 months (carry-cost stress)
 *
 * The functions here are PURE — they don't fetch anything. They take a
 * `baselineRun(inputs) → ProfitResult` thunk supplied by the caller so we
 * can reuse the existing calculateAnalysis() without coupling.
 */

export interface ScenarioInputs {
  /** Annual loan interest rate (percent, e.g. 7.5 for 7.5%). */
  interestRatePct: number;
  /** Per-sqft construction cost. */
  costPerSqft: number;
  /** Multiplier on baseline sale price (1.0 = no change, 0.85 = -15%). */
  salePriceMultiplier: number;
  /** Additional months added to the timeline (0 = baseline). */
  extraMonths: number;
}

export interface ScenarioResult {
  label: string;
  description: string;
  inputs: ScenarioInputs;
  /** Total projected profit dollars after this scenario. */
  profit: number;
  /** Profit as % of total invested capital. */
  roi: number;
}

export interface SensitivityReport {
  /** Strategy this report covers (label only). */
  strategyLabel: string;
  /** The baseline run — what the user sees in the main UI. */
  base: ScenarioResult;
  /** All single-variable stress scenarios. */
  scenarios: ScenarioResult[];
  /** Bear case: every stress applied together. */
  bear: ScenarioResult;
  /** Bull case: every favorable move applied together. */
  bull: ScenarioResult;
  /** Profit range across all scenarios incl. bear/bull. */
  profitRange: { min: number; median: number; max: number };
  /** Probability-of-loss heuristic: % of scenarios where profit < 0. */
  lossProbability: number;
  /** Breakeven analysis — what sale price multiplier reduces profit to 0? */
  breakevenSaleMultiplier: number;
  /** Short narrative summary for the UI. */
  summary: string;
}

export interface BaselineRun {
  (inputs: ScenarioInputs): { profit: number; investedCapital: number };
}

const SCENARIOS: Array<{
  label: string;
  description: string;
  delta: (b: ScenarioInputs) => ScenarioInputs;
}> = [
  {
    label: "Rate +200 bps",
    description: "Mortgage rate rises 2 percentage points — typical Fed-cycle move.",
    delta: (b) => ({ ...b, interestRatePct: b.interestRatePct + 2 }),
  },
  {
    label: "Rate -100 bps",
    description: "Rate eases by 1 point — favorable refi window mid-build.",
    delta: (b) => ({ ...b, interestRatePct: Math.max(0, b.interestRatePct - 1) }),
  },
  {
    label: "Build cost +20%",
    description: "Materials/labor inflation overrun — typical for delayed projects.",
    delta: (b) => ({ ...b, costPerSqft: b.costPerSqft * 1.2 }),
  },
  {
    label: "Build cost -10%",
    description: "Favorable bids, GC discount, off-peak labor.",
    delta: (b) => ({ ...b, costPerSqft: b.costPerSqft * 0.9 }),
  },
  {
    label: "Sale price -15%",
    description: "Comps soften by 15% — proxy for buyer-pool weakness or rate-driven correction.",
    delta: (b) => ({ ...b, salePriceMultiplier: b.salePriceMultiplier * 0.85 }),
  },
  {
    label: "Sale price +10%",
    description: "Hot market, multiple offers, premium finishes lift comps.",
    delta: (b) => ({ ...b, salePriceMultiplier: b.salePriceMultiplier * 1.10 }),
  },
  {
    label: "Timeline +6 months",
    description: "Permit delay or weather slip — carry costs balloon.",
    delta: (b) => ({ ...b, extraMonths: b.extraMonths + 6 }),
  },
];

/**
 * Run the full sensitivity matrix. Caller supplies the baseline inputs and
 * a thunk that re-runs the financial model with arbitrary inputs.
 */
export function runSensitivity(args: {
  strategyLabel: string;
  base: ScenarioInputs;
  baselineRun: BaselineRun;
}): SensitivityReport {
  const { strategyLabel, base, baselineRun } = args;

  const score = (label: string, description: string, inputs: ScenarioInputs): ScenarioResult => {
    const { profit, investedCapital } = baselineRun(inputs);
    return {
      label, description, inputs, profit,
      roi: investedCapital > 0 ? profit / investedCapital : 0,
    };
  };

  const baseResult = score("Baseline", "Inputs as currently configured.", base);
  const scenarios = SCENARIOS.map((s) => score(s.label, s.description, s.delta(base)));

  // Bear: every adverse move stacked.
  const bear = score(
    "Bear case",
    "All adverse moves stacked: rate +200 bps, build +20%, sale -15%, timeline +6 mo.",
    {
      interestRatePct: base.interestRatePct + 2,
      costPerSqft: base.costPerSqft * 1.2,
      salePriceMultiplier: base.salePriceMultiplier * 0.85,
      extraMonths: base.extraMonths + 6,
    },
  );

  // Bull: every favorable move stacked.
  const bull = score(
    "Bull case",
    "Favorable moves stacked: rate -100 bps, build -10%, sale +10%, on-time.",
    {
      interestRatePct: Math.max(0, base.interestRatePct - 1),
      costPerSqft: base.costPerSqft * 0.9,
      salePriceMultiplier: base.salePriceMultiplier * 1.10,
      extraMonths: 0,
    },
  );

  const all = [baseResult, ...scenarios, bear, bull];
  const profits = all.map((s) => s.profit).sort((a, b) => a - b);
  const profitRange = {
    min: profits[0],
    median: profits[Math.floor(profits.length / 2)],
    max: profits[profits.length - 1],
  };
  const lossProbability = all.filter((s) => s.profit < 0).length / all.length;

  // Breakeven: binary search for the sale multiplier that zeroes profit.
  // Assumes monotonic profit-vs-salePrice (true for our linear model).
  const breakevenSaleMultiplier = findBreakeven(base, baselineRun);

  // Narrative summary
  const baseProfit = baseResult.profit;
  const downside = bear.profit;
  const upside = bull.profit;
  const profitable = baseProfit > 0;
  const robustness = downside > 0
    ? "Stays profitable in the bear case."
    : downside > -baseProfit
    ? "Bear case turns negative; loss capped at less than the baseline profit."
    : "Bear case turns negative; loss could exceed the baseline profit.";
  const summary = profitable
    ? `Baseline profit $${Math.round(baseProfit / 1000)}k. Range across stresses: ` +
      `$${Math.round(profitRange.min / 1000)}k → $${Math.round(profitRange.max / 1000)}k. ${robustness} ` +
      `Sale price would need to drop ${Math.round((1 - breakevenSaleMultiplier) * 100)}% to hit breakeven.`
    : `Baseline shows a LOSS of $${Math.abs(Math.round(baseProfit / 1000))}k under current inputs. ` +
      `Upside scenario only reaches $${Math.round(upside / 1000)}k. Reconsider the strategy or inputs.`;

  return {
    strategyLabel,
    base: baseResult,
    scenarios,
    bear, bull,
    profitRange,
    lossProbability,
    breakevenSaleMultiplier,
    summary,
  };
}

/**
 * Binary search for the sale-price multiplier where profit crosses zero.
 * Returns 0.0 (sale price has to drop to zero) when even baseline shows a loss.
 * Returns 1.5 (cap) when even halving the sale doesn't break even — sentinel
 * meaning "structurally unprofitable, sale price is not the driver".
 */
function findBreakeven(base: ScenarioInputs, run: BaselineRun): number {
  const baseProfit = run(base).profit;
  if (baseProfit <= 0) return 0;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = run({ ...base, salePriceMultiplier: base.salePriceMultiplier * mid }).profit;
    if (p > 0) hi = mid;
    else lo = mid;
  }
  // Return the multiplier *of baseline sale* at which we break even.
  return Math.max(0, Math.min(1, hi)) * base.salePriceMultiplier;
}
