"use client";

import { useState } from "react";
import { Sun, Moon, Download, Trash2, Check } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useStore, QualityTier, FinancingType } from "@/store/useStore";
import { QUALITY_TIERS } from "@/lib/calculations";

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const savedAnalyses = useStore((s) => s.savedAnalyses);
  const [showSaved, setShowSaved] = useState(false);
  const [showCleared, setShowCleared] = useState(false);

  const toggleTheme = () => {
    const newTheme = settings.theme === "light" ? "dark" : "light";
    updateSettings({ theme: newTheme });
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const exportData = () => {
    const data = JSON.stringify(savedAnalyses, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `landmath-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const clearAllData = () => {
    if (confirm("This will delete all saved analyses from this device. Are you sure?")) {
      localStorage.removeItem("landmath-storage");
      setShowCleared(true);
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <Navigation />

      <main className="flex-1 px-4 py-8 pb-24 md:pb-8 max-w-2xl mx-auto w-full">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-8">
          Settings
        </h1>

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Appearance
          </h2>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {settings.theme === "light" ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-blue-400" />}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Theme</p>
                  <p className="text-xs text-gray-500">{settings.theme === "light" ? "Light mode" : "Dark mode"}</p>
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className={`relative w-12 h-7 rounded-full transition-colors ${settings.theme === "dark" ? "bg-green-600" : "bg-gray-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${settings.theme === "dark" ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Default Location */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Default Location
          </h2>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">State</label>
              <select
                value={settings.defaultState}
                onChange={(e) => updateSettings({ defaultState: e.target.value })}
                className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="WA">Washington</option>
                <option value="OR">Oregon</option>
                <option value="CA">California</option>
                <option value="TX">Texas</option>
                <option value="FL">Florida</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">County</label>
              <select
                value={settings.defaultCounty}
                onChange={(e) => updateSettings({ defaultCounty: e.target.value })}
                className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="King">King County</option>
                <option value="Pierce">Pierce County</option>
                <option value="Snohomish">Snohomish County</option>
                <option value="Kitsap">Kitsap County</option>
              </select>
            </div>
          </div>
        </section>

        {/* Default Analysis Preferences */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Analysis Defaults
          </h2>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-4">
            <div>
              <label className="text-sm text-gray-700 dark:text-gray-300 mb-2 block">Construction Quality</label>
              <div className="flex gap-1 bg-gray-100 dark:bg-slate-700 p-1 rounded-xl">
                {(["standard", "premium", "luxury", "ultra_luxury"] as QualityTier[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => updateSettings({ defaultQualityTier: t })}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      settings.defaultQualityTier === t
                        ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-white shadow-sm"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {QUALITY_TIERS[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">Financing Type</label>
              <select
                value={settings.defaultFinancingType}
                onChange={(e) => updateSettings({ defaultFinancingType: e.target.value as FinancingType })}
                className="px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white"
              >
                <option value="traditional">Traditional 30yr</option>
                <option value="interest_only">Interest Only</option>
                <option value="hard_money">Hard Money</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">Down Payment %</label>
              <input
                type="number"
                value={settings.defaultDownPaymentPct}
                onChange={(e) => updateSettings({ defaultDownPaymentPct: Number(e.target.value) })}
                className="w-20 px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-right text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm text-gray-700 dark:text-gray-300">Interest Rate %</label>
              <input
                type="number"
                step="0.125"
                value={settings.defaultInterestRate}
                onChange={(e) => updateSettings({ defaultInterestRate: Number(e.target.value) })}
                className="w-20 px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-right text-gray-900 dark:text-white"
              />
            </div>
          </div>
        </section>

        {/* Cost Per Sqft Overrides */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Cost Per Sqft Defaults
          </h2>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
            {(["standard", "premium", "luxury", "ultra_luxury"] as QualityTier[]).map((tier) => (
              <div key={tier} className="flex items-center justify-between">
                <label className="text-sm text-gray-700 dark:text-gray-300">{QUALITY_TIERS[tier].label}</label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    value={settings.customCostPerSqft[tier]}
                    onChange={(e) =>
                      updateSettings({
                        customCostPerSqft: {
                          ...settings.customCostPerSqft,
                          [tier]: Number(e.target.value),
                        },
                      })
                    }
                    className="w-20 px-3 py-1.5 text-sm bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 rounded-lg text-right text-gray-900 dark:text-white"
                  />
                  <span className="text-xs text-gray-400">/sqft</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Data Management */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">
            Data Management
          </h2>
          <div className="bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Export Data</p>
                <p className="text-xs text-gray-500">{savedAnalyses.length} analyses saved on this device</p>
              </div>
              <button
                onClick={exportData}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
              >
                {showSaved ? <Check size={16} className="text-green-600" /> : <Download size={16} />}
                {showSaved ? "Exported!" : "Export JSON"}
              </button>
            </div>
            <div className="border-t border-gray-100 dark:border-slate-700 pt-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-red-600">Clear All Data</p>
                <p className="text-xs text-gray-500">Permanently delete all saved analyses</p>
              </div>
              <button
                onClick={clearAllData}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                {showCleared ? <Check size={16} /> : <Trash2 size={16} />}
                {showCleared ? "Cleared!" : "Clear"}
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="text-center pt-4 pb-8 text-xs text-gray-400 dark:text-gray-600 space-y-1">
          <p>LandMath v1.0</p>
          <p>A tool by SNK Investments</p>
          <p>All projections are estimates. Not financial advice.</p>
        </div>
      </main>
    </div>
  );
}
