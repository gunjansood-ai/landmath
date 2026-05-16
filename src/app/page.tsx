"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, TrendingUp, MapPin, Clock } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore } from "@/store/useStore";
import { formatCurrency } from "@/lib/calculations";

export default function Home() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const savedAnalyses = useStore((s) => s.savedAnalyses);
  const setCurrentProperty = useStore((s) => s.setCurrentProperty);

  const handleAnalyze = () => {
    if (!address.trim()) return;
    setIsAnalyzing(true);

    // Create a property from the address (in production, this would call MLS API)
    const property = {
      id: `prop-${Date.now()}`,
      address: address.trim(),
      city: "Seattle",
      state: "WA",
      zip: "98101",
      county: "King",
      lotSizeSqft: 8500,
      zoningCode: "SF-5000",
      beds: 3,
      baths: 2,
      currentSqft: 1650,
      yearBuilt: 1965,
      listingPrice: 850000,
      taxAssessedValue: 720000,
      annualPropertyTax: 8400,
      stories: 1,
      garage: true,
      hoaMonthly: 0,
      floodZone: false,
    };

    setCurrentProperty(property);
    setTimeout(() => {
      router.push(`/property/${property.id}`);
    }, 800);
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

          {/* Search input */}
          <div className="relative w-full max-w-xl mx-auto">
            <div className="relative flex items-center">
              <MapPin
                size={20}
                className="absolute left-4 text-gray-400 dark:text-gray-500"
              />
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                placeholder="Enter a property address..."
                className="w-full pl-12 pr-32 py-4 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl text-gray-900 dark:text-white placeholder-gray-400 text-base focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-shadow shadow-sm focus:shadow-lg"
              />
              <button
                onClick={handleAnalyze}
                disabled={!address.trim() || isAnalyzing}
                className="absolute right-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-all active:scale-95"
              >
                {isAnalyzing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
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
          </div>

          {/* Quick examples */}
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {["1234 Oak St, Bellevue, WA", "567 Pine Ave, Kirkland, WA", "890 Cedar Ln, Renton, WA"].map((example) => (
              <button
                key={example}
                onClick={() => setAddress(example)}
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
                      <span className={`text-xs font-semibold ${analysis.roi > 15 ? "text-green-600" : analysis.roi > 0 ? "text-amber-600" : "text-red-500"}`}>
                        {analysis.roi > 0 ? "+" : ""}{analysis.roi.toFixed(1)}% ROI
                      </span>
                      <span className="text-xs text-gray-400">{formatCurrency(analysis.profit)}</span>
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
