/**
 * LandMath PDF Report Generator
 *
 * Builds a full lender-grade deal package from an AnalysisResult.
 * Uses jsPDF + html2canvas to capture a hidden DOM node.
 */

import type { AnalysisResult } from "@/store/useStore";
import { formatCurrency, formatPercent } from "@/lib/calculations";

export interface SensitivityRow {
  label: string;
  saleChange: number;   // % change to sale price  (-0.20, -0.10, 0, +0.10, +0.20)
  costChange: number;   // % change to construction cost
  profit: number;
  roi: number;
  annualizedRoi: number;
  verdict: "strong" | "marginal" | "loss";
}

/** Generate a 5×1 sensitivity table (sale price varies, costs fixed) */
export function buildSensitivityTable(base: AnalysisResult): SensitivityRow[] {
  const changes = [-0.20, -0.10, 0, 0.10, 0.20];
  return changes.map((delta) => {
    const adjSalePrice = base.expectedSalePrice * (1 + delta);
    const profit = adjSalePrice - base.totalProjectCost;
    const totalCash =
      base.totalProjectCost -
      base.acquisitionCost * (1 - (base.financing?.downPaymentPct ?? 20) / 100);
    const roi = totalCash > 0 ? (profit / totalCash) * 100 : 0;
    const annualizedRoi =
      base.timelineMonths > 0 ? roi * (12 / base.timelineMonths) : 0;
    const verdict: SensitivityRow["verdict"] =
      roi > 15 ? "strong" : roi > 0 ? "marginal" : "loss";
    return {
      label:
        delta === 0
          ? "Base Case"
          : delta > 0
          ? `+${Math.round(delta * 100)}% Sale Price`
          : `${Math.round(delta * 100)}% Sale Price`,
      saleChange: delta,
      costChange: 0,
      profit,
      roi,
      annualizedRoi,
      verdict,
    };
  });
}

export interface ReportData {
  analysis: AnalysisResult;
  sensitivity: SensitivityRow[];
  generatedAt: string;
}

export function buildReportData(analysis: AnalysisResult): ReportData {
  return {
    analysis,
    sensitivity: buildSensitivityTable(analysis),
    generatedAt: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };
}

/** Trigger browser PDF download from a DOM element */
export async function downloadReportPDF(
  elementId: string,
  filename: string = "LandMath_Report.pdf"
): Promise<void> {
  // Dynamic imports keep PDF libs out of the main bundle
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);

  const canvas = await html2canvas(el, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableW = pageW - margin * 2;
  const imgH = (canvas.height * usableW) / canvas.width;

  let y = margin;
  let remaining = imgH;
  let srcY = 0;

  while (remaining > 0) {
    const sliceH = Math.min(remaining, pageH - margin * 2);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = (sliceH * canvas.width) / usableW;
    const ctx = sliceCanvas.getContext("2d")!;
    ctx.drawImage(
      canvas,
      0,
      srcY,
      canvas.width,
      sliceCanvas.height,
      0,
      0,
      sliceCanvas.width,
      sliceCanvas.height
    );
    pdf.addImage(sliceCanvas.toDataURL("image/png"), "PNG", margin, y, usableW, sliceH);
    remaining -= sliceH;
    srcY += sliceCanvas.height;
    if (remaining > 0) {
      pdf.addPage();
      y = margin;
    }
  }

  pdf.save(filename);
}

// Re-export helpers so report components don't need to import from calculations
export { formatCurrency, formatPercent };
