"use client";

import { useState, useEffect } from "react";
import {
  Radar,
  Building2,
  Home,
  Wrench,
  Hammer,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  TrendingUp,
  MapPin,
  RefreshCw,
} from "lucide-react";
import type { PermitRadarResult, PermitRecord } from "@/app/api/permits/route";

interface PermitRadarProps {
  lat: number;
  lng: number;
  address: string;
}

const CATEGORY_CONFIG: Record<
  PermitRecord["category"],
  { label: string; icon: React.ReactNode; color: string; bgColor: string }
> = {
  new_construction: {
    label: "New Construction",
    icon: <Building2 size={13} />,
    color: "text-blue-700 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
  },
  adu: {
    label: "ADU",
    icon: <Home size={13} />,
    color: "text-purple-700 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-900/20",
  },
  addition: {
    label: "Addition",
    icon: <TrendingUp size={13} />,
    color: "text-indigo-700 dark:text-indigo-400",
    bgColor: "bg-indigo-50 dark:bg-indigo-900/20",
  },
  renovation: {
    label: "Renovation",
    icon: <Wrench size={13} />,
    color: "text-amber-700 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
  },
  demo: {
    label: "Demo",
    icon: <Hammer size={13} />,
    color: "text-red-700 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-900/20",
  },
  other: {
    label: "Other",
    icon: <Wrench size={13} />,
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-900/20",
  },
};

function SupplyScoreMeter({ score, label }: { score: number; label: string }) {
  const color =
    label === "Low"
      ? "bg-green-500"
      : label === "Medium"
      ? "bg-amber-500"
      : "bg-red-500";
  const textColor =
    label === "Low"
      ? "text-green-700 dark:text-green-400"
      : label === "Medium"
      ? "text-amber-700 dark:text-amber-400"
      : "text-red-700 dark:text-red-400";
  const bgColor =
    label === "Low"
      ? "bg-green-50 dark:bg-green-900/20"
      : label === "Medium"
      ? "bg-amber-50 dark:bg-amber-900/20"
      : "bg-red-50 dark:bg-red-900/20";

  return (
    <div className={`rounded-lg p-3 ${bgColor} border border-current/10`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Competitive Supply Score
        </span>
        <span className={`text-sm font-bold ${textColor}`}>{label}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-gray-400">Low competition</span>
        <span className="text-xs text-gray-400">{score}/100</span>
        <span className="text-xs text-gray-400">High competition</span>
      </div>
    </div>
  );
}

function PermitCategoryPill({ category, count }: { category: PermitRecord["category"]; count: number }) {
  if (count === 0) return null;
  const cfg = CATEGORY_CONFIG[category];
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg ${cfg.bgColor}`}>
      <span className={cfg.color}>{cfg.icon}</span>
      <span className={`text-xs font-semibold ${cfg.color}`}>
        {count} {cfg.label}
      </span>
    </div>
  );
}

function PermitRow({ permit }: { permit: PermitRecord }) {
  const cfg = CATEGORY_CONFIG[permit.category];
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-100 dark:border-slate-700 last:border-0">
      <div className={`mt-0.5 p-1.5 rounded-md ${cfg.bgColor} ${cfg.color} flex-shrink-0`}>
        {cfg.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
              {permit.address || "Address unavailable"}
            </div>
            {permit.description && (
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                {permit.description}
              </div>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            {permit.distanceMiles !== null && (
              <div className="text-xs text-gray-400 flex items-center gap-0.5 justify-end">
                <MapPin size={9} />
                {permit.distanceMiles} mi
              </div>
            )}
            {permit.estimatedValue && permit.estimatedValue > 0 && (
              <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mt-0.5">
                ${(permit.estimatedValue / 1000).toFixed(0)}K
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${cfg.bgColor} ${cfg.color}`}>
            {cfg.label}
          </span>
          {permit.issuedDate && (
            <span className="text-[10px] text-gray-400">
              {new Date(permit.issuedDate).toLocaleDateString("en-US", { year: "numeric", month: "short" })}
            </span>
          )}
          {permit.status && permit.status !== "null" && (
            <span className="text-[10px] text-gray-400">{permit.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PermitRadar({ lat, lng, address }: PermitRadarProps) {
  const [data, setData] = useState<PermitRadarResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [days, setDays] = useState(90);

  useEffect(() => {
    load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  async function load(lookbackDays: number) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/permits?lat=${lat}&lng=${lng}&radius=1.0&days=${lookbackDays}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // fail silently — permit data is additive, not required
    } finally {
      setLoading(false);
    }
  }

  function changeLookback(d: number) {
    setDays(d);
    load(d);
  }

  const permits = data?.permits ?? [];
  const summary = data?.summary;
  const visiblePermits = showAll ? permits : permits.slice(0, 6);

  const activityDot =
    summary?.recentActivity === "high"
      ? "bg-red-500"
      : summary?.recentActivity === "medium"
      ? "bg-amber-500"
      : "bg-green-500";

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 hover:brightness-95 transition-all"
      >
        <div className="flex items-center gap-2">
          <Radar size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-blue-900 dark:text-blue-300">
            Permit Radar
          </span>
          {summary && !loading && (
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${activityDot}`} />
              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium capitalize">
                {summary.recentActivity} activity
              </span>
            </div>
          )}
          {loading && <Loader2 size={12} className="animate-spin text-blue-500" />}
        </div>
        {expanded ? <ChevronUp size={15} className="text-blue-600" /> : <ChevronDown size={15} className="text-blue-600" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Building permits within <strong>1 mile</strong> of {address.split(",")[0]}
            </p>
            <div className="flex items-center gap-1.5">
              {[30, 90, 180].map((d) => (
                <button
                  key={d}
                  onClick={() => changeLookback(d)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    days === d
                      ? "bg-blue-600 text-white font-semibold"
                      : "text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700"
                  }`}
                >
                  {d}d
                </button>
              ))}
              <button
                onClick={() => load(days)}
                className="ml-1 text-gray-400 hover:text-blue-500 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 size={18} className="animate-spin text-blue-500" />
              <span className="text-sm text-gray-500">Scanning permit activity…</span>
            </div>
          ) : data?.source === "unavailable" ? (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Permit data unavailable for this area
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    Permit Radar currently supports Seattle, WA. Support for additional cities is coming soon.
                  </p>
                </div>
              </div>
            </div>
          ) : summary ? (
            <>
              {/* Competitive supply score */}
              <SupplyScoreMeter
                score={summary.competitiveSupplyScore}
                label={summary.competitiveSupplyLabel}
              />

              {/* Category pills */}
              {summary.total > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <PermitCategoryPill category="new_construction" count={summary.newConstruction} />
                  <PermitCategoryPill category="adu" count={summary.adu} />
                  <PermitCategoryPill category="addition" count={summary.additions} />
                  <PermitCategoryPill category="renovation" count={summary.renovations} />
                  <PermitCategoryPill category="demo" count={summary.demolitions} />
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Building2 size={16} className="text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    No permits in last {days} days
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Low competitive supply pressure in this area.</p>
                </div>
              )}

              {/* Insight callout */}
              {summary.total > 0 && (
                <div className={`rounded-lg p-3 text-xs ${
                  summary.competitiveSupplyLabel === "High"
                    ? "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800"
                    : summary.competitiveSupplyLabel === "Medium"
                    ? "bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800"
                    : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800"
                }`}>
                  {summary.competitiveSupplyLabel === "High" && (
                    <><strong>High supply pressure:</strong> {summary.newConstruction} new construction permit{summary.newConstruction !== 1 ? "s" : ""} within 1 mile in the last {days} days. Plan for competitive inventory at sale time — price your home accordingly and focus on differentiating finishes.</>
                  )}
                  {summary.competitiveSupplyLabel === "Medium" && (
                    <><strong>Moderate supply:</strong> {summary.total} permit{summary.total !== 1 ? "s" : ""} nearby, including {summary.newConstruction} new build{summary.newConstruction !== 1 ? "s" : ""}. Monitor the market — some competition at sale time is likely but manageable.</>
                  )}
                  {summary.competitiveSupplyLabel === "Low" && (
                    <><strong>Low supply pressure:</strong> Only {summary.total} permit{summary.total !== 1 ? "s" : ""} in this area over {days} days. You'll likely be one of few new builds on the market — pricing power is yours.</>
                  )}
                </div>
              )}

              {/* Permit list */}
              {visiblePermits.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                    Nearby Permits
                  </div>
                  <div className="border border-gray-100 dark:border-slate-700 rounded-lg overflow-hidden">
                    {visiblePermits.map((p, i) => (
                      <PermitRow key={i} permit={p} />
                    ))}
                  </div>
                  {permits.length > 6 && (
                    <button
                      onClick={() => setShowAll((v) => !v)}
                      className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline w-full text-center"
                    >
                      {showAll
                        ? "Show less"
                        : `Show all ${permits.length} permits`}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
