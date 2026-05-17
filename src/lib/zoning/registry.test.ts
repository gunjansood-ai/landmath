/**
 * Smoke tests for the jurisdiction-aware zoning registry.
 *
 * Run standalone (no test runner required):
 *   npx tsx src/lib/zoning/registry.test.ts
 *
 * Originally created to validate the SR-3 fix for 10728 NE 26th St, Bellevue:
 * the previous regex-only logic returned a vague "couldn't parse a min lot
 * size" verdict; the registry now cites LUC 20.20.010 directly with 8,500 sqft.
 *
 * Asserts cover:
 *   - Registry lookups for Bellevue SR-3 and MDR-2
 *   - estimateDistrictMinLotSqft: registry hit + regex fallback paths
 *   - classifyZoning: Bellevue SR-3 is "sf" (not multifamily as old regex implied)
 *   - checkFeasibility: split / townhome / multifamily on SR-3 and MDR-2
 */

import {
  lookupZoning,
  isSingleFamilyOnly,
  allowsTownhomes,
  allowsMultifamily,
} from "./registry";
import {
  estimateDistrictMinLotSqft,
  classifyZoning,
  checkFeasibility,
} from "../calculations";

let pass = 0;
let fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("=== Registry lookup ===");
const sr3 = lookupZoning({ state: "WA", city: "Bellevue", code: "SR-3" });
assert("SR-3 found in Bellevue table", sr3 !== null);
assert("SR-3 minLotSqft is 8500", sr3?.minLotSqft === 8500, `got ${sr3?.minLotSqft}`);
assert("SR-3 is single-family", isSingleFamilyOnly(sr3));
assert("SR-3 disallows townhomes", !allowsTownhomes(sr3));
assert("SR-3 disallows multifamily", !allowsMultifamily(sr3));
assert("SR-3 allowsShortPlat", sr3?.allowsShortPlat === true);
assert("SR-3 citation present", (sr3?.codeSection || "").includes("LUC 20.20.010"));

const mdr2 = lookupZoning({ state: "WA", city: "Bellevue", code: "MDR-2" });
assert("MDR-2 is multifamily", allowsMultifamily(mdr2));
assert("MDR-2 disallows short plat", mdr2?.allowsShortPlat === false);
assert("MDR-2 has 30 DU/acre", mdr2?.maxDuPerAcre === 30);

console.log("\n=== estimateDistrictMinLotSqft ===");
assert("SR-3 + Bellevue -> 8500",
  estimateDistrictMinLotSqft("SR-3", "Bellevue", "WA") === 8500);
assert("SR-3 without city -> null (registry miss; regex doesn't match SR)",
  estimateDistrictMinLotSqft("SR-3") === null);
assert("SF-5000 -> 5000",
  estimateDistrictMinLotSqft("SF-5000") === 5000);
assert("R-4 (no city) -> 4 DU/acre = 10890",
  estimateDistrictMinLotSqft("R-4") === Math.round(43560 / 4));

console.log("\n=== classifyZoning ===");
assert("Bellevue SR-3 -> sf",
  classifyZoning("SR-3", "Bellevue", "WA") === "sf");
assert("Bellevue MDR-2 -> mr_hr (multifamily)",
  classifyZoning("MDR-2", "Bellevue", "WA") === "mr_hr");

console.log("\n=== checkFeasibility on Bellevue SR-3 ===");
const subject = {
  city: "Bellevue", state: "WA", zoningCode: "SR-3",
  lotSizeSqft: 10000, listingPrice: 0, currentSqft: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;
assert("split_build on 10,000 sqft SR-3 -> not_allowed",
  checkFeasibility(subject, "split_build") === "not_allowed");
assert("split_build on 18,000 sqft SR-3 -> conditional (just clears bare 2×)",
  ["conditional", "permitted"].includes(checkFeasibility({ ...subject, lotSizeSqft: 18000 }, "split_build")));
assert("split_build on 19,000 sqft SR-3 -> permitted (clears 2× + 10%)",
  checkFeasibility({ ...subject, lotSizeSqft: 19000 }, "split_build") === "permitted");
assert("townhome on SR-3 -> conditional (HB 1110 Tier 1 unlocks attached forms)",
  checkFeasibility(subject, "townhome") === "conditional");
assert("multifamily on SR-3 (10k sqft) -> conditional (HB 1110 Tier 1, 4 units allowed)",
  checkFeasibility(subject, "multifamily") === "conditional");
assert("townhome on Bellevue MDR-2 -> permitted (base zone allows)",
  checkFeasibility({ ...subject, zoningCode: "MDR-2" }, "townhome") === "permitted");
assert("townhome on Newcastle SF zone -> not_allowed (no HB 1110 — pop <25k)",
  checkFeasibility({ ...subject, city: "Newcastle", zoningCode: "R-4" }, "townhome") === "not_allowed");
assert("townhome on unincorporated KC R-4 -> not_allowed (HB 1110 doesn't apply to unincorporated)",
  checkFeasibility({ ...subject, city: "King County", zoningCode: "R-4" }, "townhome") === "not_allowed");
assert("split_build on Bellevue MDR-2 -> not_allowed (density-governed, no short plat)",
  checkFeasibility({ ...subject, zoningCode: "MDR-2" }, "split_build") === "not_allowed");
assert("multifamily on Bellevue MDR-2 -> permitted",
  checkFeasibility({ ...subject, zoningCode: "MDR-2" }, "multifamily") === "permitted");

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
