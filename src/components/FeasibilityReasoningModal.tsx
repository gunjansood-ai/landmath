"use client";

import { useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Ban,
  ShieldCheck,
  X,
  ExternalLink,
  Info,
  HelpCircle,
} from "lucide-react";
import type { AnalysisResult } from "@/store/useStore";
import { getFeasibilityReasoning } from "@/lib/calculations";

interface Props {
  analysis: AnalysisResult;
  /** If true, render in compact pill mode (for card headers) */
  compact?: boolean;
}

function FeasibilityPill({
  feasibility,
  onClick,
}: {
  feasibility: string;
  onClick: () => void;
}) {
  switch (feasibility) {
    case "permitted":
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full hover:ring-1 hover:ring-green-400 transition-all cursor-pointer"
          title="Click to see zoning reasoning"
        >
          <CheckCircle2 size={10} /> Permitted <HelpCircle size={9} className="opacity-60" />
        </button>
      );
    case "conditional":
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full hover:ring-1 hover:ring-amber-400 transition-all cursor-pointer"
          title="Click to see zoning reasoning"
        >
          <AlertTriangle size={10} /> Conditional <HelpCircle size={9} className="opacity-60" />
        </button>
      );
    default:
      return (
        <button
          onClick={onClick}
          className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full hover:ring-1 hover:ring-red-400 transition-all cursor-pointer"
          title="Click to see zoning reasoning"
        >
          <Ban size={10} /> Not Allowed <HelpCircle size={9} className="opacity-60" />
        </button>
      );
  }
}

export default function FeasibilityReasoningModal({ analysis, compact = false }: Props) {
  const [open, setOpen] = useState(false);

  const reasoning = getFeasibilityReasoning(
    analysis.property,
    analysis.strategy,
    analysis.feasibility
  );

  const verdictColor =
    reasoning.verdict === "permitted"
      ? { bg: "bg-green-50 dark:bg-green-900/20", border: "border-green-200 dark:border-green-800", text: "text-green-700 dark:text-green-400", icon: <CheckCircle2 size={18} className="text-green-600" /> }
      : reasoning.verdict === "conditional"
      ? { bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400", icon: <AlertTriangle size={18} className="text-amber-600" /> }
      : { bg: "bg-red-50 dark:bg-red-900/20", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-400", icon: <Ban size={18} className="text-red-600" /> };

  const verdictLabel =
    reasoning.verdict === "permitted" ? "Permitted" : reasoning.verdict === "conditional" ? "Conditional" : "Not Allowed";

  return (
    <>
      <FeasibilityPill feasibility={analysis.feasibility} onClick={() => setOpen(true)} />

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className={`flex items-start justify-between gap-3 p-5 rounded-t-2xl ${verdictColor.bg} border-b ${verdictColor.border}`}>
              <div className="flex items-start gap-3">
                {verdictColor.icon}
                <div>
                  <div className={`text-xs font-semibold uppercase tracking-wide ${verdictColor.text} mb-0.5`}>
                    Zoning Verdict — {analysis.strategy.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
                  </div>
                  <div className={`text-base font-bold ${verdictColor.text}`}>{verdictLabel}</div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{reasoning.summary}</p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex-shrink-0"
              >
                <X size={16} className="text-gray-500" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Property context */}
              <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-md font-mono">
                  Zoning: {analysis.property.zoningCode || "Unknown"}
                </span>
                <span className="bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                  Lot: {analysis.property.lotSizeSqft.toLocaleString()} sqft
                </span>
                {analysis.property.city && (
                  <span className="bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                    {analysis.property.city}, {analysis.property.state}
                  </span>
                )}
              </div>

              {/* How we decided */}
              {reasoning.logic.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                    How we decided
                  </h3>
                  <ul className="space-y-2">
                    {reasoning.logic.map((step, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 text-[10px] font-bold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* What we assumed */}
              {reasoning.assumptions.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                    What we assumed
                  </h3>
                  <ul className="space-y-1.5">
                    {reasoning.assumptions.map((a, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Info size={12} className="text-blue-400 flex-shrink-0 mt-1" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* What we couldn't verify */}
              {reasoning.gaps.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                    What we couldn&apos;t verify
                  </h3>
                  <ul className="space-y-1.5">
                    {reasoning.gaps.map((g, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                        <AlertTriangle size={12} className="flex-shrink-0 mt-1" />
                        {g}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Confidence chip (if available) */}
              {typeof analysis.confidence === "number" && (
                <section className="bg-gray-50 dark:bg-slate-800 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck size={13} className="text-gray-400" />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Overall Deal Confidence</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${analysis.confidence >= 75 ? "bg-green-500" : analysis.confidence >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${analysis.confidence}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-gray-700 dark:text-gray-300 w-16 text-right">
                      {analysis.confidenceLabel} · {analysis.confidence}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                    Confidence reflects zoning clarity, comp availability, and strategy risk — not just zoning status.
                  </p>
                </section>
              )}

              {/* Verify links */}
              {reasoning.links.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
                    Verify yourself
                  </h3>
                  <div className="flex flex-col gap-2">
                    {reasoning.links.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                          i === 0
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
                        }`}
                      >
                        <ExternalLink size={13} className="flex-shrink-0" />
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {/* Disclaimer */}
              <p className="text-[10px] text-gray-400 dark:text-gray-600 border-t border-gray-100 dark:border-slate-800 pt-3">
                LandMath uses publicly available zoning data and heuristics. This is not legal advice. Confirm all zoning decisions with the local planning department or a licensed land-use attorney before committing capital.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
