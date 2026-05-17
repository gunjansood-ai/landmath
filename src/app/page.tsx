"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, TrendingUp, MapPin, Clock, Loader2 } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore } from "@/store/useStore";
import { formatCurrency } from "@/lib/calculations";
import {
  getAddressSuggestions,
  geocodePlace,
  type PlacePrediction,
} from "@/lib/api/google-places";

export default function Home() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [sessionToken] = useState(() => crypto.randomUUID());
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(undefined);
  const savedAnalyses = useStore((s) => s.savedAnalyses);
  const setCurrentProperty = useStore((s) => s.setCurrentProperty);

  // Fetch suggestions with debounce
  const fetchSuggestions = useCallback(
    (input: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (input.length < 3) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        const results = await getAddressSuggestions(input, sessionToken);
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setSelectedIndex(-1);
      }, 300);
    },
    [sessionToken]
  );

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelectSuggestion = async (prediction: PlacePrediction) => {
    setAddress(prediction.description);
    setShowSuggestions(false);
    setSuggestions([]);
    await analyzeProperty(prediction.placeId, prediction.description);
  };

  const analyzeProperty = async (placeId: string, displayAddress: string) => {
    setIsAnalyzing(true);

    try {
      // Step 1: Geocode the place to get lat/lng and parsed address
      const geo = await geocodePlace(placeId);

      if (!geo) {
        alert("Could not geocode that address. Please try again.");
        setIsAnalyzing(false);
        return;
      }

      // Condo/unit detection — skip these, they don't work for land/build analysis
      const isCondo =
        !!geo.unit || // has apt/unit number
        geo.placeTypes?.includes("subpremise") ||
        /\b(apt|unit|suite|ste|#)\b/i.test(displayAddress);

      if (isCondo) {
        alert(
          "This looks like a condo or apartment unit. LandMath is designed for houses and land — condo analysis isn't supported yet."
        );
        setIsAnalyzing(false);
        return;
      }

      // Step 2: Fetch property data from County GIS (PropertyInfo service)
      const propertyRes = await fetch(
        `/api/property?lat=${geo.lat}&lng=${geo.lng}`
      );
      const propertyData = await propertyRes.json();

      // Step 3: Build property object merging all sources
      const parcel = propertyData.parcel;
      const assessor = propertyData.assessor;
      const marketEstimate = propertyData.marketEstimate;

      // Server-side present use check — skip non-residential
      if (parcel?.presentUse) {
        const use = parcel.presentUse.toLowerCase();
        const nonResidential =
          use.includes("condo") ||
          use.includes("apartment") ||
          use.includes("office") ||
          use.includes("commercial") ||
          use.includes("industrial") ||
          use.includes("retail") ||
          use.includes("parking");
        if (nonResidential) {
          alert(
            `This property is classified as "${parcel.presentUse}". LandMath is designed for single-family residential and land — this use type isn't supported.`
          );
          setIsAnalyzing(false);
          return;
        }
      }

      // Determine best market price: nearby sales median > appraised total > estimate
      const appraisedTotal = parcel?.appraisedTotal || 0;
      const bestListPrice =
        marketEstimate ||
        (appraisedTotal > 0 ? Math.round(appraisedTotal * 1.1) : null) || // Appraised × 1.1 approximates market
        estimateValue(geo.city, assessor?.sqftLiving || 1500);

      const property = {
        id: `prop-${Date.now()}`,
        address: geo.streetNumber
          ? `${geo.streetNumber} ${geo.street}`
          : parcel?.address || displayAddress.split(",")[0],
        city: parcel?.city || geo.city || "Unknown",
        state: geo.state || "WA",
        zip: geo.zip || "00000",
        county: geo.county || "King",
        lotSizeSqft:
          parcel?.lotSizeSqft ||
          estimateLotSize(parcel?.zoningCode),
        zoningCode: parcel?.zoningCode || "Unknown",
        beds: assessor?.bedrooms || 3,
        baths: assessor?.bathrooms || 2,
        currentSqft: assessor?.sqftLiving || 1500,
        yearBuilt: assessor?.yearBuilt || 1970,
        listingPrice: bestListPrice,
        taxAssessedValue: appraisedTotal,
        annualPropertyTax: estimateTax(appraisedTotal || bestListPrice, geo.county),
        stories: assessor?.stories || 1,
        garage: true,
        hoaMonthly: 0,
        floodZone: false,
        neighborhood: propertyData.neighborhood ?? undefined,
        subjectAssessorUrl: parcel?.assessorUrl ?? null,
        subjectParcelViewerUrl: parcel?.parcelViewerUrl ?? null,
        isKingCounty: propertyData.isKingCounty ?? false,
        lat: geo.lat,
        lng: geo.lng,
      };

      setCurrentProperty(property);
      router.push(`/property/${property.id}`);
    } catch (err) {
      console.error("Analysis failed:", err);
      alert("Something went wrong fetching property data. Please try again.");
      setIsAnalyzing(false);
    }
  };

  const handleAnalyze = async () => {
    if (!address.trim()) return;

    // If we have a selected suggestion, use it
    if (suggestions.length > 0 && selectedIndex >= 0) {
      await handleSelectSuggestion(suggestions[selectedIndex]);
      return;
    }

    // If we have suggestions but none selected, use the first one
    if (suggestions.length > 0) {
      await handleSelectSuggestion(suggestions[0]);
      return;
    }

    // Fallback: try fetching suggestions for the current input and use first result
    setIsAnalyzing(true);
    const results = await getAddressSuggestions(address, sessionToken);
    if (results.length > 0) {
      await handleSelectSuggestion(results[0]);
    } else {
      alert("Could not find that address. Please enter a valid US address.");
      setIsAnalyzing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions) {
      if (e.key === "Enter") handleAnalyze();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        } else if (suggestions.length > 0) {
          handleSelectSuggestion(suggestions[0]);
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        break;
    }
  };

  const recentProperties = savedAnalyses
    .filter(
      (a, i, arr) => arr.findIndex((b) => b.propertyId === a.propertyId) === i
    )
    .slice(0, 6);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 flex flex-col items-center px-4 pb-24 md:pb-8">
        {/* Hero */}
        <div className="w-full max-w-2xl mx-auto pt-16 md:pt-24 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-900/30 rounded-full mb-6">
            <TrendingUp size={14} className="text-green-600" />
            <span className="text-xs font-medium text-green-700 dark:text-green-400">
              Real estate investment analysis
            </span>
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-3 tracking-tight">
            Enter an address.
            <br />
            <span className="text-green-600">Get the math.</span>
          </h1>

          <p className="text-gray-500 dark:text-gray-400 text-lg mb-10 max-w-md mx-auto">
            Instantly analyze any property across four investment strategies.
            Know your ROI before you commit.
          </p>

          {/* Search input with autocomplete */}
          <div className="relative w-full max-w-xl mx-auto">
            <div className="relative flex items-center">
              <MapPin
                size={20}
                className="absolute left-4 text-gray-400 dark:text-gray-500 z-10"
              />
              <input
                ref={inputRef}
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  fetchSuggestions(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Enter a property address..."
                className="w-full pl-12 pr-32 py-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl text-gray-900 dark:text-white placeholder-gray-400 text-base focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-shadow shadow-sm focus:shadow-lg"
                autoComplete="off"
              />
              <button
                onClick={handleAnalyze}
                disabled={!address.trim() || isAnalyzing}
                className="absolute right-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all active:scale-95"
              >
                {isAnalyzing ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Analyzing
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Search size={16} />
                    Analyze
                  </span>
                )}
              </button>
            </div>

            {/* Autocomplete dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-elevated overflow-hidden z-50"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.placeId}
                    onClick={() => handleSelectSuggestion(s)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                      i === selectedIndex
                        ? "bg-green-50 dark:bg-green-900/20"
                        : "hover:bg-gray-50 dark:hover:bg-slate-700/50"
                    }`}
                  >
                    <MapPin
                      size={16}
                      className={`mt-0.5 flex-shrink-0 ${
                        i === selectedIndex
                          ? "text-green-600"
                          : "text-gray-400"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {s.mainText}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {s.secondaryText}
                      </p>
                    </div>
                  </button>
                ))}
                <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-700">
                  <p className="text-[10px] text-gray-400 flex items-center gap-1">
                    <span>Powered by Google</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Quick examples */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {[
              "1234 Oak St, Bellevue, WA",
              "567 Pine Ave, Kirkland, WA",
              "890 Cedar Ln, Renton, WA",
            ].map((example) => (
              <button
                key={example}
                onClick={() => {
                  setAddress(example);
                  fetchSuggestions(example);
                }}
                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 rounded-full hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        {/* Recent analyses */}
        {recentProperties.length > 0 && (
          <div className="w-full max-w-4xl mx-auto mt-16">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4 px-1">
              Recent Analyses
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {recentProperties.map((analysis) => (
                <button
                  key={analysis.id}
                  onClick={() => {
                    setCurrentProperty(analysis.property);
                    router.push(`/property/${analysis.propertyId}`);
                  }}
                  className="flex items-start gap-3 p-4 bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl text-left hover:shadow-md transition-shadow"
                >
                  <div className="w-10 h-10 bg-green-50 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
                    <MapPin size={18} className="text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {analysis.property.address}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-xs font-semibold ${
                          analysis.roi > 15
                            ? "text-green-600"
                            : analysis.roi > 0
                            ? "text-amber-600"
                            : "text-red-500"
                        }`}
                      >
                        {analysis.roi > 0 ? "+" : ""}
                        {analysis.roi.toFixed(1)}% ROI
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatCurrency(analysis.profit)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                      <Clock size={10} />
                      {analysis.timelineMonths}mo
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="hidden md:block text-center py-6 text-xs text-gray-400 dark:text-gray-600 border-t border-gray-50 dark:border-slate-800">
        A tool by SNK Investments | LandMath v1.0
      </footer>
    </div>
  );
}

// --- Helper estimation functions (fallbacks when assessor data is unavailable) ---

function estimateLotSize(zoningCode?: string): number {
  if (!zoningCode) return 7500;
  // Parse common King County zoning codes
  const match = zoningCode.match(/(\d+)/);
  if (match) {
    const num = parseInt(match[1]);
    // SF-5000, R-4, etc.
    if (num < 100) return num * 1000; // R-4 → 4000 sqft (acres assumption)
    return num; // SF-5000 → 5000 sqft
  }
  return 7500;
}

function estimateValue(city: string, sqft: number): number {
  // Rough $/sqft by city (2024 WA market)
  const pricePerSqft: Record<string, number> = {
    Seattle: 550,
    Bellevue: 650,
    Kirkland: 580,
    Redmond: 560,
    Renton: 450,
    Kent: 380,
    Auburn: 350,
    Federal_Way: 340,
    Tacoma: 320,
    Everett: 380,
    Bothell: 500,
    Sammamish: 580,
    Issaquah: 550,
    Mercer_Island: 850,
  };

  const cityKey = city.replace(/\s+/g, "_");
  const ppsf = pricePerSqft[cityKey] || 450;
  return Math.round(ppsf * sqft);
}

function estimateTax(assessedValue: number, county: string): number {
  // WA property tax rates by county (approximate)
  const rates: Record<string, number> = {
    King: 0.0092,
    Pierce: 0.0112,
    Snohomish: 0.0098,
    Kitsap: 0.0105,
  };
  const rate = rates[county] || 0.01;
  return Math.round(assessedValue * rate);
}
