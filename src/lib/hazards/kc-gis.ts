/**
 * King County GIS hazard overlay.
 *
 * Queries the public KC ArcGIS REST services for every critical-area /
 * hazard layer that affects feasibility, cost, or insurance. All layers
 * use point-in-polygon intersect at the subject lat/lng.
 *
 * Source of truth (all stable, no auth required):
 *   - Environment/KingCo_SensitiveAreas — landslide, steep slope, erosion,
 *     seismic, coal-mine, wetland, stream, channel migration, sensitive-
 *     areas-notice-on-title, fans & debris flows
 *   - Environment/KingCo_Landslide — deeper landslide mapping with historical
 *     slides, rock fall, debris fans
 *   - Hydro/KingCo_flood_info — FEMA 100yr/500yr/floodway, regulatory
 *     floodplain, sea level rise risk area
 *   - Hydro/KingCo_Groundwater — critical aquifer recharge, contamination
 *     susceptibility, sole-source aquifer, wellhead protection (1/5/10 yr)
 *
 * Every probe is wrapped so a layer outage degrades gracefully (we record
 * the failure and continue). The aggregate `score` is a 0–100 severity
 * intended to be subtracted from confidence, NOT to be shown raw.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HazardProbe<T = unknown> {
  /** Was the underlying GIS query successful? */
  ok: boolean;
  /** Was the property hit by this hazard layer? */
  hit: boolean;
  /** Layer-specific detail when hit (e.g. FEMA flood zone code). */
  detail?: T;
  /** Free-text reason when ok = false (e.g. "http 503"). */
  error?: string;
  /** Origin layer URL — drill-in link for the user. */
  sourceUrl: string;
}

export interface HazardReport {
  /** Probe lat/lng echoed back for transparency. */
  point: { lat: number; lng: number };

  /** FEMA flood mapping. */
  flood: {
    in100yr: HazardProbe<{ zone?: string }>;
    in500yr: HazardProbe;
    floodway: HazardProbe;
    regulatoryFloodplain: HazardProbe;
    channelMigration: HazardProbe;
    seaLevelRise: HazardProbe;
  };

  /** Landslide / slope stability. */
  geohazard: {
    landslideHazard2016: HazardProbe;
    landslideBuffer50ft: HazardProbe;
    landslideHistorical1990: HazardProbe;
    steepSlope: HazardProbe;
    historicalLandslide: HazardProbe;
    rockFall: HazardProbe;
    debrisFlowFan: HazardProbe;
    erosionHazard: HazardProbe;
  };

  /** Seismic / liquefaction. */
  seismic: {
    seismicHazard: HazardProbe;
    coalMineHazard: HazardProbe;
  };

  /** Hydrology adjacent to parcel. */
  wetland: {
    nwiWetland2024: HazardProbe;
    legacy1990Wetland: HazardProbe;
  };

  stream: {
    legacy1990Stream: HazardProbe<{ type?: string }>;
  };

  /** Drinking-water protection (matters for septic, USTs, redev). */
  aquifer: {
    criticalRechargeArea: HazardProbe;
    contaminationSusceptibility: HazardProbe;
    soleSource: HazardProbe;
    wellhead1yr: HazardProbe;
    wellhead5yr: HazardProbe;
    wellhead10yr: HazardProbe;
  };

  /** Recorded notice on title — strong signal of past city scrutiny. */
  titleNotice: {
    sensitiveAreaNotice: HazardProbe;
  };

  /** Composite severity 0–100 (subtract from confidence; don't show raw). */
  severityScore: number;

  /** Severity bucket for UI badge. */
  severityLabel: "clear" | "low" | "moderate" | "high" | "severe";

  /** Plain-English caveats sorted by severity, ready to render in reasoning. */
  caveats: Array<{
    severity: "info" | "warning" | "block";
    text: string;
    sourceUrl: string;
  }>;

  /** All probes that failed, for transparency / retry logic. */
  failures: string[];
}

// ─── Endpoint catalog ───────────────────────────────────────────────────────

const SA = "https://gismaps.kingcounty.gov/arcgis/rest/services/Environment/KingCo_SensitiveAreas/MapServer";
const LS = "https://gismaps.kingcounty.gov/arcgis/rest/services/Environment/KingCo_Landslide/MapServer";
const FL = "https://gismaps.kingcounty.gov/arcgis/rest/services/Hydro/KingCo_flood_info/MapServer";
const GW = "https://gismaps.kingcounty.gov/arcgis/rest/services/Hydro/KingCo_Groundwater/MapServer";

const LAYERS = {
  // SensitiveAreas layers (IDs discovered from MapServer metadata)
  sa_landslide_2016: { url: SA, id: 1, label: "Potential landslide hazard areas (2016)" },
  sa_landslide_buffer: { url: SA, id: 2, label: "Landslide hazard areas — 50 ft buffer" },
  sa_landslide_1990: { url: SA, id: 3, label: "Landslide hazards (incorporated KC, 1990)" },
  sa_steep_slope: { url: SA, id: 4, label: "Potential steep slope hazard areas (2016)" },
  sa_erosion: { url: SA, id: 7, label: "Erosion hazard (1990 SAO)" },
  sa_seismic: { url: SA, id: 8, label: "Seismic hazard (1990 SAO)" },
  sa_coalmine: { url: SA, id: 9, label: "Coal mine hazard (1990 SAO)" },
  sa_stream_1990: { url: SA, id: 10, label: "Stream (1990 SAO)" },
  sa_wetland_1990: { url: SA, id: 11, label: "Wetland (1990 SAO)" },
  sa_title_notice: { url: SA, id: 12, label: "Sensitive area notice on title" },
  sa_channel_migration: { url: SA, id: 15, label: "Channel migration hazard areas" },
  sa_debris_fan_lowland: { url: SA, id: 18, label: "Lowland fans (debris flow)" },
  sa_debris_fan_alpine_high: { url: SA, id: 20, label: "Alpine fans — more likely debris flow" },
  sa_wetlands_nwi: { url: SA, id: 22, label: "Wetlands (NWI 2024)" },

  // Landslide layers
  ls_historical: { url: LS, id: 2, label: "Historical landslides" },
  ls_rockfall: { url: LS, id: 8, label: "Rock fall potential" },

  // Flood layers
  fl_floodway: { url: FL, id: 12, label: "FEMA floodway" },
  fl_100yr: { url: FL, id: 13, label: "FEMA 100-year floodplain" },
  fl_500yr: { url: FL, id: 14, label: "FEMA 500-year floodplain" },
  fl_regulatory: { url: FL, id: 59, label: "Regulatory floodplain" },
  fl_sea_level: { url: FL, id: 64, label: "Sea level rise risk area" },
  fl_channel_migration: { url: FL, id: 69, label: "Channel migration hazard areas (flood layer)" },

  // Groundwater layers
  gw_contamination: { url: GW, id: 3, label: "Areas susceptible to groundwater contamination" },
  gw_critical_recharge: { url: GW, id: 4, label: "Critical aquifer recharge areas" },
  gw_sole_source: { url: GW, id: 5, label: "Sole source aquifer" },
  gw_wellhead_1: { url: GW, id: 6, label: "Wellhead protection — 1 year" },
  gw_wellhead_5: { url: GW, id: 7, label: "Wellhead protection — 5 years" },
  gw_wellhead_10: { url: GW, id: 8, label: "Wellhead protection — 10 years" },
} as const;

type LayerKey = keyof typeof LAYERS;

// ─── Single layer probe ─────────────────────────────────────────────────────

interface QueryOpts {
  /** Probe the point's exact intersection (true) or with a buffer (meters)? */
  bufferMeters?: number;
  /** Fields to return when a feature is hit; default ["*"] omitted to keep payload small. */
  outFields?: string[];
  /** Timeout in ms. KC GIS responds in 200-800ms typically; 6s is generous. */
  timeoutMs?: number;
}

async function probeLayer<T = unknown>(
  key: LayerKey,
  lat: number,
  lng: number,
  opts: QueryOpts = {},
): Promise<HazardProbe<T>> {
  const layer = LAYERS[key];
  const sourceUrl = `${layer.url}/${layer.id}`;
  const { bufferMeters, outFields, timeoutMs = 6000 } = opts;

  // ArcGIS point query: geometry as comma-separated lng,lat with inSR=4326
  // (WGS-84). For buffered queries we use a square envelope around the point.
  const geometry = bufferMeters
    ? envelopeAroundPoint(lat, lng, bufferMeters)
    : `${lng},${lat}`;
  const geometryType = bufferMeters ? "esriGeometryEnvelope" : "esriGeometryPoint";

  // ArcGIS quirk: returnCountOnly + outFields together yields
  // "Invalid or missing input parameters" on some layers. We always request
  // a count first; when outFields is set we re-query for the attributes
  // only if the count came back > 0.
  const params = new URLSearchParams({
    geometry,
    geometryType,
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    returnGeometry: "false",
    returnCountOnly: "true",
    f: "json",
  });

  const url = `${sourceUrl}/query?${params.toString()}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) {
      return { ok: false, hit: false, error: `http ${r.status}`, sourceUrl };
    }
    const j = (await r.json()) as {
      count?: number;
      features?: Array<{ attributes: Record<string, unknown> }>;
      error?: { message: string };
    };
    if (j.error) {
      return { ok: false, hit: false, error: j.error.message, sourceUrl };
    }
    const count = j.count ?? (j.features?.length ?? 0);
    const hit = count > 0;
    // Second-pass attribute fetch — only when we have a hit AND the caller
    // asked for outFields. Keeps the cold path cheap (one request) and the
    // detail path correct.
    let detail: T | undefined;
    if (hit && outFields && outFields.length > 0) {
      const attrParams = new URLSearchParams({
        geometry,
        geometryType,
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        returnGeometry: "false",
        outFields: outFields.join(","),
        resultRecordCount: "1",
        f: "json",
      });
      try {
        const r2 = await fetch(`${sourceUrl}/query?${attrParams.toString()}`, {
          signal: controller.signal,
        });
        if (r2.ok) {
          const j2 = (await r2.json()) as {
            features?: Array<{ attributes: Record<string, unknown> }>;
          };
          if (j2.features?.[0]?.attributes) {
            detail = j2.features[0].attributes as unknown as T;
          }
        }
      } catch {
        /* ignore detail-fetch failure; count is authoritative */
      }
    }
    return { ok: true, hit, detail, sourceUrl };
  } catch (e) {
    return {
      ok: false,
      hit: false,
      error: e instanceof Error ? e.message : "fetch failed",
      sourceUrl,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build a tiny envelope around a lat/lng. Used for "near" queries (e.g.
 * "wetland within 100 ft of property"). Meters → degrees conversion uses
 * the spherical-earth approximation; adequate for ≤200m buffers.
 */
function envelopeAroundPoint(lat: number, lng: number, meters: number): string {
  const dLat = meters / 111_111;
  const dLng = meters / (111_111 * Math.cos((lat * Math.PI) / 180));
  return [
    lng - dLng, lat - dLat,
    lng + dLng, lat + dLat,
  ].join(",");
}

// ─── Top-level: gather every layer + score ──────────────────────────────────

/**
 * Fetch the full hazard report for a point. Layers run in parallel; any
 * failed probe is logged in `failures` but does not block the report.
 *
 * For points outside King County this returns a near-empty report where
 * every layer hit=false (KC GIS returns 0 features outside its boundary).
 * Callers should gate on isKingCounty before invoking.
 */
export async function fetchKcHazards(lat: number, lng: number): Promise<HazardReport> {
  // Probes that need a small buffer for "near" semantics:
  //   - wetlands within 100ft for setback impact
  //   - streams within 200ft for buffer impact
  const probes: Record<string, Promise<HazardProbe>> = {
    sa_landslide_2016: probeLayer("sa_landslide_2016", lat, lng),
    sa_landslide_buffer: probeLayer("sa_landslide_buffer", lat, lng),
    sa_landslide_1990: probeLayer("sa_landslide_1990", lat, lng),
    sa_steep_slope: probeLayer("sa_steep_slope", lat, lng),
    sa_erosion: probeLayer("sa_erosion", lat, lng),
    sa_seismic: probeLayer("sa_seismic", lat, lng),
    sa_coalmine: probeLayer("sa_coalmine", lat, lng),
    sa_stream_1990: probeLayer("sa_stream_1990", lat, lng, { bufferMeters: 61, outFields: ["*"] }), // 200ft
    sa_wetland_1990: probeLayer("sa_wetland_1990", lat, lng, { bufferMeters: 30 }),                   // 100ft
    sa_wetlands_nwi: probeLayer("sa_wetlands_nwi", lat, lng, { bufferMeters: 30 }),
    sa_title_notice: probeLayer("sa_title_notice", lat, lng),
    sa_channel_migration: probeLayer("sa_channel_migration", lat, lng),
    sa_debris_fan_lowland: probeLayer("sa_debris_fan_lowland", lat, lng),
    sa_debris_fan_alpine_high: probeLayer("sa_debris_fan_alpine_high", lat, lng),
    ls_historical: probeLayer("ls_historical", lat, lng),
    ls_rockfall: probeLayer("ls_rockfall", lat, lng),
    fl_floodway: probeLayer("fl_floodway", lat, lng),
    fl_100yr: probeLayer("fl_100yr", lat, lng, { outFields: ["FLD_ZONE"] }),
    fl_500yr: probeLayer("fl_500yr", lat, lng),
    fl_regulatory: probeLayer("fl_regulatory", lat, lng),
    fl_sea_level: probeLayer("fl_sea_level", lat, lng),
    gw_critical_recharge: probeLayer("gw_critical_recharge", lat, lng),
    gw_contamination: probeLayer("gw_contamination", lat, lng),
    gw_sole_source: probeLayer("gw_sole_source", lat, lng),
    gw_wellhead_1: probeLayer("gw_wellhead_1", lat, lng),
    gw_wellhead_5: probeLayer("gw_wellhead_5", lat, lng),
    gw_wellhead_10: probeLayer("gw_wellhead_10", lat, lng),
  };

  const entries = await Promise.all(
    Object.entries(probes).map(async ([k, p]) => [k, await p] as const),
  );
  const r = Object.fromEntries(entries) as Record<string, HazardProbe>;

  const failures: string[] = entries
    .filter(([, p]) => !p.ok)
    .map(([k, p]) => `${k}: ${p.error}`);

  const report: HazardReport = {
    point: { lat, lng },
    flood: {
      in100yr: r.fl_100yr as HazardProbe<{ zone?: string }>,
      in500yr: r.fl_500yr,
      floodway: r.fl_floodway,
      regulatoryFloodplain: r.fl_regulatory,
      channelMigration: r.sa_channel_migration,
      seaLevelRise: r.fl_sea_level,
    },
    geohazard: {
      landslideHazard2016: r.sa_landslide_2016,
      landslideBuffer50ft: r.sa_landslide_buffer,
      landslideHistorical1990: r.sa_landslide_1990,
      steepSlope: r.sa_steep_slope,
      historicalLandslide: r.ls_historical,
      rockFall: r.ls_rockfall,
      debrisFlowFan: {
        // Roll-up of the three debris-fan sub-layers; ok=true if any subprobe succeeded.
        ok: r.sa_debris_fan_lowland.ok || r.sa_debris_fan_alpine_high.ok,
        hit: r.sa_debris_fan_lowland.hit || r.sa_debris_fan_alpine_high.hit,
        sourceUrl: r.sa_debris_fan_lowland.sourceUrl,
      } as HazardProbe,
      erosionHazard: r.sa_erosion,
    },
    seismic: {
      seismicHazard: r.sa_seismic,
      coalMineHazard: r.sa_coalmine,
    },
    wetland: {
      nwiWetland2024: r.sa_wetlands_nwi,
      legacy1990Wetland: r.sa_wetland_1990,
    },
    stream: {
      legacy1990Stream: r.sa_stream_1990 as HazardProbe<{ type?: string }>,
    },
    aquifer: {
      criticalRechargeArea: r.gw_critical_recharge,
      contaminationSusceptibility: r.gw_contamination,
      soleSource: r.gw_sole_source,
      wellhead1yr: r.gw_wellhead_1,
      wellhead5yr: r.gw_wellhead_5,
      wellhead10yr: r.gw_wellhead_10,
    },
    titleNotice: {
      sensitiveAreaNotice: r.sa_title_notice,
    },
    severityScore: 0,
    severityLabel: "clear",
    caveats: [],
    failures,
  };

  // ── Severity scoring ──────────────────────────────────────────────────────
  // Each hit contributes; cap individual contribution to avoid double-counting
  // (e.g. landslide AND landslide-buffer is still one landslide concern).
  let score = 0;
  const caveats = report.caveats;
  const link = (u: string) => u;

  // Flood: highest stakes for construction cost + insurance
  if (report.flood.floodway.hit) {
    score += 40;
    caveats.push({
      severity: "block",
      text: "Property is in the FEMA regulatory floodway — substantial restrictions on rebuild; redevelopment may be infeasible without engineered diversions.",
      sourceUrl: link(report.flood.floodway.sourceUrl),
    });
  } else if (report.flood.in100yr.hit) {
    score += 25;
    const zone = report.flood.in100yr.detail?.zone;
    caveats.push({
      severity: "warning",
      text: `Property sits in the FEMA 100-year floodplain${zone ? ` (zone ${zone})` : ""}. New construction will require elevated foundation, flood vents, and flood insurance — typically +10–20% on build cost and ~$2,000-$5,000/yr insurance.`,
      sourceUrl: link(report.flood.in100yr.sourceUrl),
    });
  } else if (report.flood.in500yr.hit) {
    score += 5;
    caveats.push({
      severity: "info",
      text: "Property is in the FEMA 500-year (0.2% annual) floodplain — moderate flood risk; insurance recommended but typically not required.",
      sourceUrl: link(report.flood.in500yr.sourceUrl),
    });
  }
  if (report.flood.regulatoryFloodplain.hit && !report.flood.in100yr.hit) {
    score += 10;
    caveats.push({
      severity: "warning",
      text: "King County regulatory floodplain overlay applies — local floodplain standards stricter than FEMA. Confirm with city or KC DPER.",
      sourceUrl: link(report.flood.regulatoryFloodplain.sourceUrl),
    });
  }
  if (report.flood.channelMigration.hit) {
    score += 15;
    caveats.push({
      severity: "warning",
      text: "Property intersects a channel migration hazard area — riverine erosion risk; new development typically requires geotech and may face setbacks from the bank.",
      sourceUrl: link(report.flood.channelMigration.sourceUrl),
    });
  }
  if (report.flood.seaLevelRise.hit) {
    score += 10;
    caveats.push({
      severity: "warning",
      text: "Property is in King County's sea-level-rise risk area — 30+ year horizon concern for shoreline parcels.",
      sourceUrl: link(report.flood.seaLevelRise.sourceUrl),
    });
  }

  // Geohazard: split / build / ADU all affected
  const slideHit =
    report.geohazard.landslideHazard2016.hit ||
    report.geohazard.landslideBuffer50ft.hit ||
    report.geohazard.landslideHistorical1990.hit ||
    report.geohazard.historicalLandslide.hit;
  if (slideHit) {
    score += 30;
    caveats.push({
      severity: "warning",
      text: "Landslide hazard area on or near parcel. Geotechnical study required for any new construction; lot-split feasibility typically reduced because steep terrain consumes buildable envelope.",
      sourceUrl: link(report.geohazard.landslideHazard2016.sourceUrl),
    });
  }
  if (report.geohazard.steepSlope.hit) {
    score += 15;
    caveats.push({
      severity: "warning",
      text: "Steep slope (>40%) hazard mapped on parcel — significant setbacks and engineered foundations likely. Expect +15–25% build cost.",
      sourceUrl: link(report.geohazard.steepSlope.sourceUrl),
    });
  }
  if (report.geohazard.rockFall.hit) {
    score += 25;
    caveats.push({
      severity: "warning",
      text: "Rock-fall hazard mapped on or near parcel — site-specific risk assessment required.",
      sourceUrl: link(report.geohazard.rockFall.sourceUrl),
    });
  }
  if (report.geohazard.debrisFlowFan.hit) {
    score += 20;
    caveats.push({
      severity: "warning",
      text: "Property is on a mapped debris-flow fan — alpine / alluvial deposit risk. Engineered foundation almost certain.",
      sourceUrl: link(report.geohazard.debrisFlowFan.sourceUrl),
    });
  }
  if (report.geohazard.erosionHazard.hit) {
    score += 8;
    caveats.push({
      severity: "info",
      text: "Erosion hazard area — stormwater design and slope stabilization required.",
      sourceUrl: link(report.geohazard.erosionHazard.sourceUrl),
    });
  }

  // Seismic / coal mine
  if (report.seismic.seismicHazard.hit) {
    score += 12;
    caveats.push({
      severity: "warning",
      text: "Seismic hazard area (often liquefaction-prone soils). Foundation design must account for amplified ground motion; pile foundation may be required.",
      sourceUrl: link(report.seismic.seismicHazard.sourceUrl),
    });
  }
  if (report.seismic.coalMineHazard.hit) {
    score += 20;
    caveats.push({
      severity: "warning",
      text: "Coal-mine hazard area — historical underground mining risk. Subsurface investigation required; subsidence insurance recommended.",
      sourceUrl: link(report.seismic.coalMineHazard.sourceUrl),
    });
  }

  // Wetlands / streams
  if (report.wetland.nwiWetland2024.hit || report.wetland.legacy1990Wetland.hit) {
    score += 20;
    caveats.push({
      severity: "warning",
      text: "Wetland mapped on or near parcel. Cities apply 50–300 ft buffers depending on wetland class — may significantly shrink buildable area or block short-plat entirely.",
      sourceUrl: link(report.wetland.nwiWetland2024.sourceUrl),
    });
  }
  if (report.stream.legacy1990Stream.hit) {
    score += 12;
    caveats.push({
      severity: "warning",
      text: "Stream within 200 ft. Buffer typically 50–165 ft depending on stream type (Type S/F/N). Confirm class and verify buildable envelope.",
      sourceUrl: link(report.stream.legacy1990Stream.sourceUrl),
    });
  }

  // Groundwater
  if (report.aquifer.criticalRechargeArea.hit) {
    score += 8;
    caveats.push({
      severity: "info",
      text: "Critical Aquifer Recharge Area (CARA). New underground storage tanks restricted; stormwater infiltration controls apply.",
      sourceUrl: link(report.aquifer.criticalRechargeArea.sourceUrl),
    });
  }
  if (report.aquifer.wellhead1yr.hit) {
    score += 15;
    caveats.push({
      severity: "warning",
      text: "1-year wellhead protection zone — strictest drinking-water protection; many development restrictions apply.",
      sourceUrl: link(report.aquifer.wellhead1yr.sourceUrl),
    });
  } else if (report.aquifer.wellhead5yr.hit) {
    score += 8;
  } else if (report.aquifer.wellhead10yr.hit) {
    score += 4;
  }

  // Title notice — strong tell that the city has flagged this parcel
  if (report.titleNotice.sensitiveAreaNotice.hit) {
    score += 10;
    caveats.push({
      severity: "warning",
      text: "A Sensitive Area Notice is recorded on the title — past city or county scrutiny exists. Order a full title report and check recorded conditions.",
      sourceUrl: link(report.titleNotice.sensitiveAreaNotice.sourceUrl),
    });
  }

  // Bucket the score
  report.severityScore = Math.min(100, score);
  if (score >= 60) report.severityLabel = "severe";
  else if (score >= 35) report.severityLabel = "high";
  else if (score >= 15) report.severityLabel = "moderate";
  else if (score > 0) report.severityLabel = "low";
  else report.severityLabel = "clear";

  return report;
}

/**
 * Convert a hazard severity score into a confidence-axis penalty for the
 * `computeConfidence` model in buildability.ts. The mapping is intentionally
 * gentle — most hazards reduce profit margin, not legal feasibility.
 */
export function hazardConfidencePenalty(report: HazardReport | null): number {
  if (!report) return 0;
  if (report.severityLabel === "clear") return 0;
  if (report.severityLabel === "low") return 3;
  if (report.severityLabel === "moderate") return 8;
  if (report.severityLabel === "high") return 15;
  return 25; // severe
}

/**
 * Hazard-driven feasibility downgrades. Returns the worst-case verdict
 * implied by the hazard report. Callers should AND this with the zoning
 * verdict (i.e. take the more restrictive of the two).
 */
export function hazardFeasibilityFloor(
  report: HazardReport | null,
): "permitted" | "conditional" | "not_allowed" {
  if (!report) return "permitted";
  if (report.flood.floodway.hit) return "not_allowed";
  if (
    report.flood.in100yr.hit ||
    report.geohazard.landslideHazard2016.hit ||
    report.geohazard.rockFall.hit ||
    report.geohazard.debrisFlowFan.hit ||
    report.wetland.nwiWetland2024.hit ||
    report.wetland.legacy1990Wetland.hit ||
    report.seismic.coalMineHazard.hit ||
    report.aquifer.wellhead1yr.hit
  ) {
    return "conditional";
  }
  return "permitted";
}

/**
 * Combine zoning + hazard verdicts. Returns the more restrictive of the two.
 */
export function combineFeasibility(
  zoning: "permitted" | "conditional" | "not_allowed",
  hazards: "permitted" | "conditional" | "not_allowed",
): "permitted" | "conditional" | "not_allowed" {
  const rank = { permitted: 0, conditional: 1, not_allowed: 2 } as const;
  return rank[zoning] >= rank[hazards] ? zoning : hazards;
}
