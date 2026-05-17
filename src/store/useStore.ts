import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Caveat,
  NeighborhoodData,
  TypologyFit,
} from "@/lib/buildability";

export type Strategy = "fresh_build" | "split_build" | "main_adu" | "flip_fix" | "pass";
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
}

export interface FinancingConfig {
  type: FinancingType;
  downPaymentPct: number;
  interestRate: number;
  loanTermYears: number;
  points: number; // for hard money
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
