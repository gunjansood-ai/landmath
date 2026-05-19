/**
 * Construction draw schedule + financed cash-flow model.
 *
 * Models how capital actually gets deployed over a multi-month residential
 * development project — not all at once on day 1.
 *
 * Phase breakdown (months 1..T):
 *   permit  (1..P)              soft costs only: architect, permits, surveys (~10% of constructionCost)
 *   build   (P+1..P+B)          hard costs drawn per AIA G702 S-curve
 *   sell    (P+B+1..T)          no new draws; loan balance held flat
 *
 * Default S-curve approximation: Hermite cubic g(τ) = 3τ² − 2τ³
 *   - slow start (mobilization)
 *   - heavy middle (rough-in, drywall)
 *   - slow finish (closeout, punch)
 * Matches the industry-standard 10/15/15/15/15/20/10 monthly draw pattern
 * within ~5% accumulated draw at any point.
 *
 * Two model knobs the caller picks:
 *   - constructionLtcPct  (0..1): fraction of construction financed by the
 *     loan. Cash-funded build = 0. Typical hard-money = 0.80.
 *   - constructionRate (annual %): interest rate on the drawn balance.
 *
 * Outputs the caller cares about:
 *   - totalInterestPaid      : sum of monthly interest on drawn balance
 *   - originationFees        : one-time points × loanSize at closing
 *   - cashDeployedAtMonth(t) : equity tied up at end of month t
 *   - weightedAvgCashDeployed: mean of cashDeployed across all T months
 *
 * Why weighted-avg matters: the ROI denominator should reflect what was
 * actually tied up over the project life, not peak deployment. For a
 * 27-month spec build, weighted-avg can be 60-70% of peak — meaningful.
 */

export interface DrawScheduleInput {
  /** Construction cost (hard + soft). */
  constructionCost: number;
  /** Permit months. */
  permitMonths: number;
  /** Active build months. */
  buildMonths: number;
  /** Sell months (loan held flat, no new draws). */
  sellMonths: number;
  /** % of construction cost classified as "soft" (drawn during permit phase). */
  softCostPct?: number;        // default 0.10
  /** % of construction financed by the loan (0 = all cash). */
  constructionLtcPct: number;
  /** Annual interest rate on the construction loan (e.g. 10 for 10%). */
  constructionRate: number;
  /** Origination fee — % of loan size, one-time at closing. */
  constructionPoints?: number; // default 0
  /** Downpayment + closing costs paid at acquisition (day 0). */
  upfrontEquity: number;
  /** Acquisition mortgage balance — held flat through the project. */
  acquisitionLoanBalance: number;
  /** Acquisition mortgage monthly payment (separate from construction loan). */
  acquisitionMonthlyPayment: number;
}

export interface DrawScheduleResult {
  /** Total interest paid on the construction loan, summed across all months. */
  totalConstructionInterest: number;
  /** One-time origination fee (loanSize × points). Deducted from equity. */
  originationFees: number;
  /** Acquisition mortgage P&I paid over the timeline. */
  totalAcquisitionPayments: number;
  /** Per-month series for charts / debugging. */
  monthly: Array<{
    month: number;
    phase: "permit" | "build" | "sell";
    cumulativeDraw: number;        // cumulative construction $ drawn
    loanBalance: number;           // outstanding construction loan only
    monthlyInterest: number;       // construction-loan interest this month
    cashDeployed: number;          // cumulative equity tied up (incl. cash-funded build portion)
  }>;
  /** Peak equity deployed (max of cashDeployed across all months). */
  peakCashDeployed: number;
  /** Weighted-average equity deployed — use this as the ROI denominator. */
  weightedAvgCashDeployed: number;
  /** Total construction-loan principal drawn by end of build (= loan size). */
  totalLoanSize: number;
}

/** Hermite cubic S-curve: smooth ease-in/out, 0 at τ=0, 1 at τ=1. */
function sCurve(tau: number): number {
  const x = Math.max(0, Math.min(1, tau));
  return 3 * x * x - 2 * x * x * x;
}

/**
 * Compute the full month-by-month draw schedule, interest, and equity
 * deployment. Pure function — no side effects, no fetches.
 */
export function computeDrawSchedule(input: DrawScheduleInput): DrawScheduleResult {
  const softCostPct = input.softCostPct ?? 0.10;
  const points = input.constructionPoints ?? 0;
  const T = Math.max(1, Math.round(input.permitMonths + input.buildMonths + input.sellMonths));
  const P = Math.max(0, Math.round(input.permitMonths));
  const B = Math.max(1, Math.round(input.buildMonths));
  // S = T - P - B (derived, ensures consistency)

  const softCosts = input.constructionCost * softCostPct;
  const hardCosts = input.constructionCost - softCosts;
  const totalLoanSize = input.constructionCost * input.constructionLtcPct;
  const monthlyRate = input.constructionRate / 100 / 12;
  const originationFees = totalLoanSize * (points / 100);

  const monthly: DrawScheduleResult["monthly"] = [];
  let totalInterest = 0;
  let cumulativeDraw = 0;

  for (let t = 1; t <= T; t++) {
    let phase: "permit" | "build" | "sell";
    let newDraw = 0;

    if (t <= P) {
      // Permit phase — soft costs drawn linearly.
      phase = "permit";
      const prevSoft = ((t - 1) / Math.max(1, P)) * softCosts;
      const currSoft = (t / Math.max(1, P)) * softCosts;
      newDraw = currSoft - prevSoft;
    } else if (t <= P + B) {
      // Build phase — hard costs drawn per S-curve.
      phase = "build";
      const prevTau = (t - 1 - P) / B;
      const currTau = (t - P) / B;
      const prevFrac = sCurve(prevTau);
      const currFrac = sCurve(currTau);
      newDraw = (currFrac - prevFrac) * hardCosts;
    } else {
      // Sell phase — no new draws; loan balance held flat.
      phase = "sell";
      newDraw = 0;
    }

    cumulativeDraw += newDraw;
    // Construction loan balance grows with each draw (proportional to LTC).
    const loanBalance = cumulativeDraw * input.constructionLtcPct;
    // Interest charged on the AVERAGE of last-month and this-month loan
    // balance — standard mid-month convention.
    const prevLoan =
      monthly.length > 0 ? monthly[monthly.length - 1].loanBalance : 0;
    const avgBalance = (prevLoan + loanBalance) / 2;
    const monthlyInterest = avgBalance * monthlyRate;
    totalInterest += monthlyInterest;

    // Equity deployed = upfront equity
    //                 + cumulative cash portion of construction
    //                 + cumulative origination fees (paid at closing)
    //                 + cumulative interest paid (cash out of pocket)
    //                 + cumulative acquisition P&I paid
    const cashPortionOfDraw = cumulativeDraw * (1 - input.constructionLtcPct);
    const acquisitionPaidToDate = input.acquisitionMonthlyPayment * t;
    const interestPaidToDate = totalInterest;
    const cashDeployed =
      input.upfrontEquity +
      originationFees +
      cashPortionOfDraw +
      interestPaidToDate +
      acquisitionPaidToDate;

    monthly.push({
      month: t,
      phase,
      cumulativeDraw: Math.round(cumulativeDraw),
      loanBalance: Math.round(loanBalance),
      monthlyInterest: Math.round(monthlyInterest),
      cashDeployed: Math.round(cashDeployed),
    });
  }

  const peakCashDeployed = monthly.reduce(
    (m, r) => Math.max(m, r.cashDeployed),
    0,
  );
  const weightedAvgCashDeployed =
    monthly.reduce((s, r) => s + r.cashDeployed, 0) / Math.max(1, monthly.length);

  return {
    totalConstructionInterest: Math.round(totalInterest),
    originationFees: Math.round(originationFees),
    totalAcquisitionPayments: Math.round(input.acquisitionMonthlyPayment * T),
    monthly,
    peakCashDeployed: Math.round(peakCashDeployed),
    weightedAvgCashDeployed: Math.round(weightedAvgCashDeployed),
    totalLoanSize: Math.round(totalLoanSize),
  };
}

/** Convenience: defaults for the four financing presets. */
export const FINANCING_PRESETS = {
  cash: {
    label: "All Cash",
    constructionLtcPct: 0,
    constructionRate: 0,
    constructionPoints: 0,
    description: "No construction loan. Maximum equity, no interest cost.",
  },
  hard_money: {
    label: "Hard Money",
    constructionLtcPct: 0.80,
    constructionRate: 10,
    constructionPoints: 2,
    description: "80% LTC, 10% interest-only, 2 points up-front. Typical for WA spec builds.",
  },
  bank_construction: {
    label: "Bank Construction",
    constructionLtcPct: 0.80,
    constructionRate: 8,
    constructionPoints: 1,
    description: "80% LTC, 8% interest-only, 1 point. Requires established LLC + track record.",
  },
  custom: {
    label: "Custom",
    constructionLtcPct: 0.75,
    constructionRate: 9,
    constructionPoints: 1.5,
    description: "User-edited rates.",
  },
} as const;
