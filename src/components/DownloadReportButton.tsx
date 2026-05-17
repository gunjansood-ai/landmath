"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { downloadReportPDF } from "@/lib/report";

interface DownloadReportButtonProps {
  address: string;
  className?: string;
}

export default function DownloadReportButton({
  address,
  className = "",
}: DownloadReportButtonProps) {
  const [state, setState] = useState<"idle" | "generating" | "done" | "error">("idle");

  const handleDownload = async () => {
    setState("generating");
    try {
      const slug = address
        .replace(/[^a-z0-9]/gi, "_")
        .replace(/_+/g, "_")
        .slice(0, 40);
      await downloadReportPDF("lender-report", `LandMath_${slug}.pdf`);
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  };

  const label =
    state === "generating"
      ? "Building report…"
      : state === "done"
      ? "Downloaded!"
      : state === "error"
      ? "Failed — try again"
      : "Download Report";

  return (
    <button
      onClick={handleDownload}
      disabled={state === "generating"}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all
        ${state === "done"
          ? "bg-green-600 text-white"
          : state === "error"
          ? "bg-red-600 text-white"
          : "bg-green-600 hover:bg-green-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
        } ${className}`}
    >
      {state === "generating" ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <FileDown size={15} />
      )}
      {label}
    </button>
  );
}
