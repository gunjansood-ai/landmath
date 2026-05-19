import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Caveat,
  NeighborhoodData,
  TypologyFit,
} from "@/lib/buildability";

export type Strategy = "fresh_build" | "split_build" | "main_adu" | "flip_fix" | "townhome" | "multifamily" | "pass";

// ─── Townhome / Row House inputs ──────────────────────────────────────────────
export interface TownhomeInputs {
  unitCount: number;
  avgUnitSqft: number;
  hoaSetupCost: number;
  sharedInfraCost: number;
  salePricePerUnit: number;  // pulled from comps or user-entered
}

export const DEFAULT_TOWNHOME_INPUTS: TownhomeInputs = {
  unitCount: 4,
  avgUnitSqft: 1400,
  hoaSetupCost: 18000,
  sharedInfraCost: 25000,
  salePricePerUnit: 0,  // 0 = will be estimated from comps
};

// ─── Multi-Family / Condo inputs ──────────────────────────────────────────────
export type MFExitType = "rent" | "sell";

export interface MultiFamilyInputs {
  exitType: MFExitType;
  studioCount: number;
  oneBrCount: number;
  twoBrCount: number;
  avgUnitSqft: number;
  studioRent: number;       // monthly, 0 = fetch from APIllow
  oneBrRent: number;
  twoBrRent: number;
  vacancyRate: number;      // 0–1 (e.g. 0.05 = 5%)
  operatingExpenseRatio: number; // 0–1 (e.g. 0.35 = 35%)
  condoConversionCost: number;  // per unit, for sell exit
  salePricePerUnit: number;     // for sell exit
}

// National baseline — overridden by ZIP lookup or APIllow when available
export const DEFAULT_MF_INPUTS: MultiFamilyInputs = {
  exitType: "rent",
  studioCount: 2,
  oneBrCount: 4,
  twoBrCount: 2,
  avgUnitSqft: 800,
  studioRent: 1400,
  oneBrRent: 1800,
  twoBrRent: 2300,
  vacancyRate: 0.05,
  operatingExpenseRatio: 0.35,
  condoConversionCost: 8000,
  salePricePerUnit: 0,
};
export type QualityTier = "standard" | "premium" | "luxury" | "ultra_luxury";
export type FinancingType = "traditional" | "interest_only" | "hard_money" | "cash";

export interface PropertyData {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  lotSizeSqft: number;
  zoningCode: string;
  beds: number;
  baths: number;
  currentSqft: number;
  yearBuilt: number;
  listingPrice: number;
  taxAssessedValue: number;
  annualPropertyTax: number;
  stories: number;
  garage: boolean;
  hoaMonthly: number;
  floodZone: boolean;
  /** Neighborhood guardrail data (typology + cited comps). Optional for back-compat with persisted state. */
  neighborhood?: NeighborhoodData;
  /** Subject parcel assessor drill-in URL (KC for now). */
  subjectAssessorUrl?: string | null;
  /** Subject parcel viewer URL (KC for now). */
  subjectParcelViewerUrl?: string | null;
  /** True when the property is inside King County WA (full GIS data available).
   *  False for all other areas — uses Nominatim + APIllow fallback only. */
  isKingCounty?: boolean;
  /** Geocoded coordinates — used for Permit Radar and map features. */
  lat?: number;
  lng?: number;
  /** Where the listingPrice came from. Shown in the UI so users can gauge confidence. */
  priceSource?: "apillow_listing" | "apillow_zestimate" | "neighborhood_median" | "appraised" | "estimate";
  /** Multi-signal price evidence for the subject — surfaced in the UI so
   *  the user can sanity-check the headline list price against Zestimate /
   *  last sold / list date. All optional; populated only for KC properties. */
  subjectListDate?: string | null;
  subjectZestimate?: number | null;
  subjectLastSoldPrice?: number | null;
  /** King County GIS hazard overlay (flood / landslide / wetland / seismic / etc.).
   *  Loaded only when isKingCounty=true. Optional for back-compat with persisted state. */
  hazards?: import("@/lib/hazards/kc-gis").HazardReport | null;
  /** Sale + permit history for the subject parcel (KC only). */
  history?: import("@/lib/history/kc-history").PropertyHistory | null;
}

/** How construction is financed. Drives the draw-schedule cash-flow model. */
export type ConstructionFinancing = "cash" | "hard_money" | "bank_construction" | "custom";

export interface FinancingConfig {
  type: FinancingType;
  downPaymentPct: number;
  interestRate: number;
  loanTermYears: number;
  points: number; // for hard money

  /** ── Construction financing (separate loan, drawn per S-curve) ──
   *
   * Models the most common WA developer pattern: hard money or bank
   * construction loan funds 75-85% of construction; the rest is investor
   * cash. Loan is interest-only on drawn balance during build; paid off at
   * sale (or refi'd to permanent at completion for hold-rent exits).
   *
   * Default: hard money at 80% LTC, 10% APR, 2 points up-front.
   * Set constructionLtcPct = 0 to model an all-cash build. */
  constructionFinancing?: ConstructionFinancing;
  /** Fraction of construction cost financed by the loan (0 = all cash, 0.85 = 85% LTC). */
  constructionLtcPct?: number;
  /** Annual interest rate on the construction loan (percent, e.g. 10 for 10%). */
  constructionRate?: number;
  /** One-time origination cost as % of construction loan (e.g. 2 for 2 points). */
  constructionPoints?: number;
}

export interface AnalysisResult {
  id: string;
  propertyId: string;
  property: PropertyData;
  strategy: Strategy;
  qualityTier: QualityTier;
  costPerSqft: number;
  buildSqft: number;
  financing: FinancingConfig;
  // Calculated
  acquisitionCost: number;
  constructionCost: number;
  holdingCostMonthly: number;
  totalHoldingCost: number;
  sellingCosts: number;
  totalProjectCost: number;
  expectedSalePrice: number;
  profit: number;
  roi: number;
  annualizedRoi: number;
  timelineMonths: number;
  permitMonths: number;
  buildMonths: number;
  sellMonths: number;
  feasibility: "permitted" | "conditional" | "not_allowed";
  recommendation: string;
  createdAt: string;
  // Architect-mode additions (all optional for back-compat):
  confidence?: number;                  // 0–100
  confidenceLabel?: "High" | "Moderate" | "Low" | "Speculative";
  caveats?: Caveat[];
  typologyFit?: TypologyFit;
  typologyShare?: number;
  trendBumpApplied?: boolean;
  safeMaxSqft?: number;                 // size guardrail output (when comps allow)
  isTopRecommendation?: boolean;        // true for the top-2 visible cards
  /** Itemized renovation cost breakdown for flip_fix strategy. */
  flipRenovationBreakdown?: import("@/lib/calculations").FlipRenovationBreakdown;
  /** Stress-test results: profit under interest-rate / build-cost / sale-price
   *  / timeline shocks plus stacked bear/bull cases. */
  sensitivity?: import("@/lib/sensitivity").SensitivityReport;
  /** Construction draw schedule + cash-flow series. Drives the "your cash
   *  isn't deployed all at once" visualization and lower ROI denominator. */
  drawSchedule?: import("@/lib/draw-schedule").DrawScheduleResult;
  /** Peak cash deployed at any single month — sizing for bankroll planning. */
  peakCashDeployed?: number;

  // ── Townhome / Multi-family specific (optional — only set for those strategies) ──
  unitCount?: number;
  exitType?: MFExitType;
  // Rental exit metrics
  grossRentalIncome?: number;
  effectiveGrossIncome?: number;
  noi?: number;
  capRate?: number;          // percentage, e.g. 7.2
  grm?: number;              // gross rent multiplier, e.g. 11.4
  cashOnCash?: number;       // percentage
  breakEvenOccupancy?: number; // percentage
  debtService?: number;      // annual
  // Per-unit metrics (both exits)
  profitPerUnit?: number;
  costPerUnit?: number;
  revenuePerUnit?: number;
}

export interface Settings {
  theme: "light" | "dark";
  defaultState: string;
  defaultCounty: string;
  defaultQualityTier: QualityTier;
  defaultFinancingType: FinancingType;
  defaultDownPaymentPct: number;
  defaultInterestRate: number;
  customCostPerSqft: Record<QualityTier, number>;
}

interface AppState {
  // Current analysis in progress
  currentProperty: PropertyData | null;
  currentAnalyses: AnalysisResult[];
  recommendedStrategy: Strategy | null;

  // Saved analyses
  savedAnalyses: AnalysisResult[];

  // Settings
  settings: Settings;

  // Actions
  setCurrentProperty: (property: PropertyData | null) => void;
  setCurrentAnalyses: (analyses: AnalysisResult[]) => void;
  setRecommendedStrategy: (strategy: Strategy | null) => void;
  saveAnalysis: (analysis: AnalysisResult) => void;
  deleteAnalysis: (id: string) => void;
  updateSettings: (settings: Partial<Settings>) => void;
}

const defaultSettings: Settings = {
  theme: "light",
  defaultState: "WA",
  defaultCounty: "King",
  defaultQualityTier: "premium",
  defaultFinancingType: "traditional",
  defaultDownPaymentPct: 20,
  defaultInterestRate: 6.75,
  customCostPerSqft: {
    standard: 220,
    premium: 300,
    luxury: 425,
    ultra_luxury: 650,
  },
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      currentProperty: null,
      currentAnalyses: [],
      recommendedStrategy: null,
      savedAnalyses: [],
      settings: defaultSettings,

      setCurrentProperty: (property) => set({ currentProperty: property }),
      setCurrentAnalyses: (analyses) => set({ currentAnalyses: analyses }),
      setRecommendedStrategy: (strategy) => set({ recommendedStrategy: strategy }),

      saveAnalysis: (analysis) =>
        set((state) => ({
          savedAnalyses: [
            analysis,
            ...state.savedAnalyses.filter((a) => a.id !== analysis.id),
          ].slice(0, 100), // Keep last 100
        })),

      deleteAnalysis: (id) =>
        set((state) => ({
          savedAnalyses: state.savedAnalyses.filter((a) => a.id !== id),
        })),

      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),
    }),
    {
      name: "landmath-storage",
    }
  )
);
