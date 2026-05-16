"use client";

import { useRouter } from "next/navigation";
import { MapPin, Clock, Trash2, TrendingUp } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore } from "@/store/useStore";
import { formatCurrency, STRATEGIES } from "@/lib/calculations";

export default function SavedProperties() {
  const router = useRouter();
  const savedAnalyses = useStore((s) => s.savedAnalyses);
  const deleteAnalysis = useStore((s) => s.deleteAnalysis);
  const setCurrentProperty = useStore((s) => s.setCurrentProperty);

  const uniqueProperties = savedAnalyses.filter(
    (a, i, arr) => arr.findIndex((b) => b.propertyId === a.propertyId) === i
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Navigation />

      <main className="flex-1 px-4 py-8 pb-24 md:pb-8 max-w-4xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          My Properties
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          {uniqueProperties.length} saved {uniqueProperties.length === 1 ? "analysis" : "analyses"} on this device
        </p>

        {uniqueProperties.length === 0 ? (
          <div className="text-center py-16">
            <MapPin size={40} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 mb-4">No analyses saved yet</p>
            <button
              onClick={() => router.push("/")}
              className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-medium"
            >
              Analyze Your First Property
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {uniqueProperties.map((analysis) => (
              <div
                key={analysis.id}
                className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <button
                    onClick={() => {
                      setCurrentProperty(analysis.property);
                      router.push(`/property/${analysis.propertyId}`);
                    }}
                    className="flex items-start gap-3 text-left flex-1"
                  >
                    <div className="w-10 h-10 bg-green-50 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                      <MapPin size={18} className="text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {analysis.property.address}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {analysis.property.city}, {analysis.property.state} | {analysis.property.lotSizeSqft.toLocaleString()} sqft | {analysis.property.zoningCode}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                          <TrendingUp size={10} />
                          {STRATEGIES[analysis.strategy].label}
                        </span>
                        <span className={`text-sm font-bold ${analysis.profit > 0 ? "text-green-600" : "text-red-500"}`}>
                          {formatCurrency(analysis.profit)}
                        </span>
                        <span className={`text-xs font-medium ${analysis.roi > 15 ? "text-green-600" : "text-amber-600"}`}>
                          {analysis.roi.toFixed(1)}% ROI
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock size={10} />
                          {analysis.timelineMonths}mo
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => deleteAnalysis(analysis.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
