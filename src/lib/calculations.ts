import {
  Strategy,
  QualityTier,
  FinancingConfig,
  PropertyData,
  AnalysisResult,
} from "@/store/useStore";
import {
  computeConfidence,
  computeNeighborhoodGuardrails,
  type NeighborhoodGuardrails,
} from "@/lib/buildability";

// Cost per sqft by quality tier (WA state defaults)
export const DEFAULT_COST_PER_SQFT: Record<QualityTier, number> = {
  standard: 220,
  premium: 300,
  luxury: 425,
  ultra_luxury: 650,
};

// Quality tier display info
export const QUALITY_TIERS: Record<
  QualityTier,
  { label: string; description: string; timeMultiplier: number }
> = {
  standard: {
    label: "Standard",
    description: "Builder-grade finishes, basic systems",
    timeMultiplier: 1.0,
  },
  premium: {
    label: "Premium",
    description: "Upgraded finishes, hardwood, quartz, energy efficient",
    timeMultiplier: 1.2,
  },
  luxury: {
    label: "Luxury",
    description: "High-end finishes, smart home, designer touches",
    timeMultiplier: 1.5,
  },
  ultra_luxury: {
    label: "Ultra-Luxury",
    description: "Fully custom, imported materials, architectural",
    timeMultiplier: 2.0,
  },
};

// Strategy display info
export const STRATEGIES: Record<
  Strategy,
  { label: string; tagline: string; icon: string }
> = {
  fresh_build: {
    label: "Fresh Build",
    tagline: "Tear it down, start from scratch",
    icon: "building",
  },
  split_build: {
    label: "Split & Build",
    tagline: "Divide the lot, multiply the profit",
    icon: "scissors",
  },
  main_adu: {
    label: "Main + ADU",
    tagline: "Primary home plus income units",
    icon: "home",
  },
  flip_fix: {
    label: "Flip & Fix",
    tagline: "Renovate and cash out",
    icon: "wrench",
  },
  pass: {
    label: "Pass",
    tagline: "The math doesn't work",
    icon: "x",
  },
};

/**
 * Estimate the district minimum lot size from a zoning code string.
 * Stopgap until the full zoning KB (Vercel Blob) is wired up.
 *
 * Handles common WA patterns:
 *   - SF-5000, SF-7200 → numeric is the min lot in sqft
 *   - R-5, R-7.2, RS-5 → numeric is units-per-acre OR min lot in 1000s of sqft
 *   - R-1, R-2, R-3 → dwelling-units-per-acre (smaller number = larger lot)
 *   - R-4 (Bellevue) → ~10,800 sqft (4 units/acre)
 *   - NR-1 / RA-2.5 / RA-5 (King County rural) → 1, 2.5, 5 acres respectively
 *   - Returns null when the code is unrecognized.
 */
export function estimateDistrictMinLotSqft(zoningCode: string | null | undefined): number | null {
  if (!zoningCode || /^unknown$/i.test(zoningCode)) return null;
  const upper = zoningCode.toUpperCase();

  // Rural-area pattern: RA-X means X-acre minimum
  const ra = upper.match(/^RA[- ]?(\d+(?:\.\d+)?)/);
  if (ra) return Math.round(parseFloat(ra[1]) * 43560);

  // Rural NR-1 etc — common in unincorporated KC
  const nr = upper.match(/^NR[- ]?(\d+(?:\.\d+)?)/);
  if (nr) return Math.round(parseFloat(nr[1]) * 43560);

  // SF-NNNN, RS-NNNN — number is sqft
  const sfNumeric = upper.match(/(?:SF|RS|R)[- ]?(\d{3,5})(?:[^\d]|$)/);
  if (sfNumeric) {
    const n = parseInt(sfNumeric[1], 10);
    if (n >= 1000) return n; // explicit sqft
  }

  // R-N with N as units-per-acre (Bellevue, Seattle low-density)
  const rUnits = upper.match(/^R[- ]?(\d+(?:\.\d+)?)$/);
  if (rUnits) {
    const units = parseFloat(rUnits[1]);
    if (units > 0 && units <= 30) {
      // 43,560 sqft/acre ÷ units = min lot per unit
      return Math.round(43560 / units);
    }
  }

  // Last-resort: any embedded 4-5 digit number = explicit sqft
  const anyNumeric = upper.match(/(\d{4,5})/);
  if (anyNumeric) {
    const n = parseInt(anyNumeric[1], 10);
    if (n >= 1000 && n <= 200000) return n;
  }

  return null;
}

// Zoning feasibility check.
// split_build is now properly conservative: must clear 2× district min PLUS a
// 10% margin (real-world setbacks, frontage, and access easements eat lot).
export function checkFeasibility(
  property: PropertyData,
  strategy: Strategy
): "permitted" | "conditional" | "not_allowed" {
  const lotSize = property.lotSizeSqft;

  switch (strategy) {
    case "fresh_build":
      return "permitted";
    case "split_build": {
      const districtMin = estimateDistrictMinLotSqft(property.zoningCode);
      // Without a known district min, we can't responsibly call this permitted.
      if (!districtMin) {
        // Conservative: only "conditional" when lot is large enough that a split
        // is plausible under most WA zoning (15,000+ sqft typical floor).
        if (lotSize >= 15000) return "conditional";
        return "not_allowed";
      }
      const requiredWithMargin = districtMin * 2 * 1.10; // 10% buffer for setbacks/access
      const requiredBare = districtMin * 2;
      if (lotSize >= requiredWithMargin) return "permitted";
      if (lotSize >= requiredBare) return "conditional";
      return "not_allowed";
    }
    case "main_adu":
      // HB 1337 (2023): WA cities must allow 2 ADUs per residential lot in UGAs.
      if (lotSize >= 5000) return "permitted";
      if (lotSize >= 4000) return "conditional";
      return "not_allowed";
    case "flip_fix":
      return "permitted";
    default:
      return "not_allowed";
  }
}

// Calculate maximum buildable sqft based on lot and FAR
function getMaxBuildableSqft(property: PropertyData, strategy: Strategy): number {
  const lotSize = property.lotSizeSqft;
  const far = 0.5; // Default FAR for residential zones
  const maxCoverage = 0.35;
  const maxFootprint = lotSize * maxCoverage;

  switch (strategy) {
    case "fresh_build":
      return Math.min(lotSize * far, maxFootprint * 2.5); // up to 2.5 stories
    case "split_build": {
      const lotsCount = lotSize >= 12000 ? 2 : 1;
      const perLotSize = lotSize / lotsCount;
      return perLotSize * far * lotsCount;
    }
    case "main_adu": {
      const mainSqft = Math.min(lotSize * far * 0.7, 3500);
      const aduSqft = Math.min(1000, lotSize * 0.1);
      const aduCount = lotSize >= 8000 ? 2 : 1;
      return mainSqft + aduSqft * aduCount;
    }
    case "flip_fix":
      return property.currentSqft + Math.min(500, lotSize * 0.05);
    default:
      return 0;
  }
}

// Estimate permit timeline by strategy
function getPermitMonths(strategy: Strategy): number {
  switch (strategy) {
    case "fresh_build":
      return 6;
    case "split_build":
      return 10; // Short plat adds time
    case "main_adu":
      return 5;
    case "flip_fix":
      return 2;
    default:
      return 0;
  }
}

// Estimate build time
function getBuildMonths(strategy: Strategy, tier: QualityTier, sqft: number): number {
  const baseMonths = Math.ceil(sqft / 400); // ~400 sqft per month base
  const multiplier = QUALITY_TIERS[tier].timeMultiplier;
  const strategyMultiplier = strategy === "split_build" ? 1.3 : 1.0;
  return Math.ceil(baseMonths * multiplier * strategyMultiplier);
}

// Estimate days on market → months
function getSellMonths(tier: QualityTier, price: number): number {
  if (price > 2000000) return 4;
  if (price > 1000000) return 3;
  if (tier === "standard") return 2;
  return 2.5;
}

// Monthly mortgage payment (P&I)
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number,
  interestOnly: boolean = false
): number {
  if (principal <= 0) return 0;
  const monthlyRate = annualRate / 100 / 12;
  if (interestOnly) {
    return principal * monthlyRate;
  }
  const numPayments = termYears * 12;
  if (monthlyRate === 0) return principal / numPayments;
  return (
    (principal * monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1)
  );
}

// ─── Sale $/sqft model ──────────────────────────────────────────────────────
//
// We now compute strategy-specific $/sqft from a strategy-specific comp pool:
//
//   fresh_build / split_build:
//     - Comp pool = NEW CONSTRUCTION only (built ≤5 yr before sale).
//     - Apply tier multiplier (new construction has its own price tier).
//
//   main_adu:
//     - Comp pool = SFR-with-ADU comps preferred; fall back to recent SFRs.
//     - Apply tier multiplier (but ADU portion sells at ~85%).
//
//   flip_fix:
//     - Comp pool = ALL existing-home resale (the renovated unit will be
//       priced against existing homes, not new builds).
//     - Apply small renovation premium (1.05–1.20×) — NOT the new-construction
//       multiplier. Buyers won't pay new-construction prices for a flip.
//
// Calibrated against WA 2026 data:
//   - Seattle median resale ~$545–572/sqft
//   - New construction WA average ~$425–500/sqft cost, sells at $500–800/sqft
//   - Bellevue/Eastside custom new $850–1000/sqft
//   - Medina/Mercer Island ultra new $1100–1500+/sqft
//
// Sources: Redfin Seattle market report (Apr 2026), Emerald City Construction
// (2026 Seattle/Eastside custom-home guide), HomeGuide (WA 2026 build-cost data).

export const TIER_NEW_CONSTRUCTION_MULTIPLIER: Record<QualityTier, number> = {
  standard: 1.00,
  premium: 1.20,
  luxury: 1.55,
  ultra_luxury: 2.00,
};

// Renovation premium — what a renovated existing home sells for vs. the
// median existing-home comp $/sqft in the area. Much smaller than new-construction
// premiums because the buyer pool is the same (resale buyers, not new-build buyers).
const TIER_FLIP_PREMIUM: Record<QualityTier, number> = {
  standard: 1.05,
  premium: 1.10,
  luxury: 1.20,
  ultra_luxury: 1.30,
};

// WA-wide fallback sale $/sqft for NEW CONSTRUCTION when no comps are available.
export const DEFAULT_SELL_PRICE_PER_SQFT: Record<QualityTier, number> = {
  standard: 425,
  premium: 600,
  luxury: 850,
  ultra_luxury: 1300,
};

// WA-wide fallback for FLIP RESALE (existing-home renovated). Lower than new build.
const DEFAULT_FLIP_PRICE_PER_SQFT: Record<QualityTier, number> = {
  standard: 400,
  premium: 520,
  luxury: 680,
  ultra_luxury: 950,
};

// ─── ZIP-level new-construction $/sqft overrides ─────────────────────────────
// When the comp pipeline is unavailable (APIllow down, no sqft data),
// we still want SOMETHING smarter than a flat national average for known
// markets. These represent typical NEW-CONSTRUCTION sale prices (premium tier
// baseline) by ZIP. Tier multiplier is applied on top for luxury/ultra.
//
// Numbers from 2025–2026 Redfin / Zillow per-sqft data for new builds.
// Conservative midpoints — actual luxury builds can exceed by 30–50%.
// Better than nothing, worse than real comps.
const ZIP_NEW_CONSTRUCTION_PPSF: Record<string, number> = {
  // ── Washington State ─────────────────────────────────────────────────────
  // Bellevue / Eastside premium
  "98004": 1100, // Bridle Trails / Yarrow Bay
  "98005": 700,  // Crossroads / Lake Hills
  "98006": 700,  // Newport / Factoria
  "98007": 650,
  "98008": 650,  // Lake Hills / Crossroads
  "98039": 1500, // Medina / Clyde Hill / Hunts Point
  "98040": 1000, // Mercer Island
  "98033": 850,  // Kirkland
  "98034": 700,  // Kirkland east
  "98052": 700,  // Redmond
  "98053": 750,  // Redmond east
  "98074": 700,  // Sammamish
  "98075": 700,  // Sammamish east
  "98027": 650,  // Issaquah
  "98029": 700,  // Issaquah Highlands
  // Seattle
  "98109": 850,  // Queen Anne / South Lake Union
  "98112": 950,  // Madison Park / Madrona
  "98119": 850,  // Queen Anne North
  "98199": 850,  // Magnolia
  "98115": 700,  // View Ridge / Wedgwood
  "98117": 700,  // Ballard / Loyal Heights
  "98103": 700,  // Greenwood / Fremont / Wallingford
  "98105": 800,  // Laurelhurst / U-District
  "98144": 700,  // Mt Baker / Beacon Hill
  "98107": 650,  // Ballard
  "98108": 600,
  "98116": 700,  // West Seattle premium
  "98136": 650,  // West Seattle
  "98122": 700,  // Capitol Hill / Central District
  "98102": 800,  // Eastlake / Capitol Hill
  "98106": 550,
  "98118": 600,
  "98125": 600,
  "98126": 600,
  "98133": 550,
  // Tacoma
  "98402": 400,  // Downtown Tacoma
  "98403": 500,  // Stadium / Old Town
  "98405": 400,
  "98406": 500,  // West End
  "98407": 600,  // North Tacoma
  "98422": 500,  // NE Tacoma
  // Spokane
  "99203": 350,  // South Hill premium
  "99201": 350,  // Downtown Spokane
  // ── California — Bay Area ─────────────────────────────────────────────────
  "94010": 1200, // Burlingame
  "94025": 1300, // Menlo Park
  "94027": 1800, // Atherton
  "94028": 1100, // Portola Valley
  "94062": 1100, // Redwood City
  "94301": 1400, // Palo Alto
  "94303": 1200, // Palo Alto east
  "94305": 1300, // Stanford
  "94401": 1200, // San Mateo
  "94402": 1100, // San Mateo west
  "94501": 800,  // Alameda
  "94502": 800,  // Alameda east
  "94506": 850,  // Danville
  "94507": 900,  // Alamo
  "94526": 850,  // Danville
  "94556": 750,  // Moraga
  "94563": 900,  // Orinda
  "94577": 600,  // San Leandro
  "94601": 550,  // Oakland Fruitvale
  "94602": 700,  // Oakland Glenview
  "94609": 650,  // Oakland Piedmont Ave
  "94611": 850,  // Piedmont / Rockridge
  "94618": 900,  // Rockridge
  "94705": 950,  // Berkeley Elmwood
  "94707": 900,  // Berkeley north hills
  "94708": 850,  // Berkeley hills
  "94920": 1100, // Belvedere / Tiburon
  "94941": 900,  // Mill Valley
  "94945": 750,  // Novato
  "94965": 1000, // Sausalito
  "95008": 700,  // Campbell
  "95014": 850,  // Cupertino
  "95030": 850,  // Los Gatos
  "95032": 800,  // Los Gatos east
  "95120": 900,  // San Jose Almaden
  "95125": 800,  // San Jose Willow Glen
  "95126": 750,  // San Jose Rose Garden
  "95129": 850,  // San Jose west
  // ── California — Los Angeles ──────────────────────────────────────────────
  "90024": 1200, // Westwood / Brentwood
  "90025": 1100, // West LA / Sawtelle
  "90027": 800,  // Los Feliz
  "90036": 900,  // Fairfax / Mid-City
  "90041": 750,  // Eagle Rock
  "90049": 1300, // Brentwood
  "90062": 550,  // South LA
  "90064": 900,  // Rancho Park
  "90066": 850,  // Mar Vista
  "90077": 1500, // Bel Air
  "90094": 900,  // Playa Vista
  "90210": 2000, // Beverly Hills
  "90211": 1500, // Beverly Hills adj.
  "90212": 1400, // Beverly Hills adj.
  "90254": 1200, // Hermosa Beach
  "90265": 1500, // Malibu
  "90272": 1500, // Pacific Palisades
  "90291": 1100, // Venice
  "90292": 1000, // Marina del Rey
  "90401": 1000, // Santa Monica
  "90403": 1100, // Santa Monica north
  "90405": 900,  // Santa Monica east
  "91011": 900,  // La Cañada
  "91105": 950,  // Pasadena south
  "91106": 850,  // Pasadena east
  "91302": 700,  // Calabasas
  "91361": 750,  // Westlake Village
  "91436": 1100, // Encino south
  // ── New York ─────────────────────────────────────────────────────────────
  "10001": 1300, // Chelsea / Hudson Yards
  "10003": 1200, // East Village / Greenwich Village
  "10007": 1400, // Tribeca / Financial
  "10011": 1200, // Chelsea / West Village
  "10013": 1400, // Soho / Tribeca
  "10014": 1300, // West Village
  "10019": 1400, // Midtown West
  "10022": 1500, // Midtown East
  "10023": 1300, // Upper West Side
  "10024": 1200, // Upper West Side
  "10025": 1100, // Morningside Heights / UWS
  "10028": 1200, // Upper East Side
  "10065": 1400, // Upper East Side
  "10075": 1300, // Upper East Side
  "10280": 1200, // Battery Park City
  "11201": 1100, // Brooklyn Heights / DUMBO
  "11215": 950,  // Park Slope
  "11217": 900,  // Boerum Hill / Gowanus
  "11231": 950,  // Carroll Gardens / Red Hook
  "11238": 900,  // Prospect Heights
  // ── Massachusetts — Boston ────────────────────────────────────────────────
  "02108": 1100, // Beacon Hill
  "02109": 1000, // North End / Waterfront
  "02110": 1000, // Financial District
  "02111": 900,  // Chinatown / Leather District
  "02116": 1100, // Back Bay
  "02118": 800,  // South End
  "02119": 600,  // Roxbury
  "02127": 800,  // South Boston
  "02129": 750,  // Charlestown
  "02130": 700,  // Jamaica Plain
  "02132": 650,  // West Roxbury
  "02134": 600,  // Allston
  "02135": 600,  // Brighton
  "02138": 900,  // Cambridge Harvard Sq
  "02139": 850,  // Cambridge Cambridgeport
  "02140": 800,  // Cambridge north
  "02141": 700,  // Cambridge east
  "02142": 750,  // Cambridge MIT
  "02143": 700,  // Somerville Inman Sq
  "02144": 650,  // Somerville Teele Sq
  "02145": 600,  // Somerville east
  // ── Illinois — Chicago ────────────────────────────────────────────────────
  "60601": 650,  // Millennium Park / Loop
  "60602": 650,  // Loop
  "60610": 700,  // Gold Coast / River North
  "60611": 750,  // Streeterville / Magnificent Mile
  "60614": 750,  // Lincoln Park
  "60615": 500,  // Hyde Park / Woodlawn
  "60618": 600,  // Roscoe Village / Avondale
  "60625": 550,  // Ravenswood / Albany Park
  "60626": 500,  // Rogers Park
  "60640": 550,  // Uptown
  "60647": 600,  // Logan Square
  "60657": 700,  // Lakeview / Wrigleyville
  // ── Texas — Dallas / Fort Worth ───────────────────────────────────────────
  "75205": 700,  // Highland Park / UP
  "75206": 600,  // M Streets / Lower Greenville
  "75209": 650,  // Bluffview / Devonshire
  "75219": 600,  // Oak Lawn
  "75225": 700,  // Preston Hollow south
  "75229": 650,  // North Dallas / Preston Hollow
  "75230": 650,  // Preston Hollow / Royal Lane
  "75240": 550,  // North Dallas Galleria
  // Texas — Houston
  "77005": 650,  // West University
  "77006": 600,  // Montrose
  "77007": 600,  // The Heights
  "77019": 700,  // River Oaks
  "77024": 700,  // Memorial
  "77025": 550,  // Braeswood / NRG area
  "77027": 700,  // River Oaks east
  "77098": 650,  // Upper Kirby / Greenway Plaza
  // ── Arizona — Phoenix Metro ───────────────────────────────────────────────
  "85018": 700,  // Arcadia / Biltmore
  "85028": 600,  // Paradise Valley adj.
  "85044": 500,  // Ahwatukee
  "85048": 500,  // Ahwatukee south
  "85050": 600,  // Desert Ridge
  "85054": 650,  // DC Ranch adj.
  "85250": 700,  // Scottsdale south
  "85251": 650,  // Scottsdale central
  "85254": 700,  // Scottsdale north
  "85255": 750,  // North Scottsdale
  "85259": 700,  // North Scottsdale east
  "85266": 800,  // Pinnacle Peak
  // ── Colorado — Denver Metro ───────────────────────────────────────────────
  "80203": 550,  // Capitol Hill
  "80205": 500,  // City Park / Whittier
  "80206": 600,  // Congress Park / Cherry Creek
  "80209": 650,  // Wash Park / Glendale
  "80210": 650,  // Platt Park / Observatory Park
  "80218": 600,  // Cheesman Park / Morey Middle
  "80220": 550,  // Montclair / Mayfair
  "80221": 450,  // Regis / Globeville
  "80246": 600,  // Hilltop / Crestmoor
  "80302": 650,  // Boulder central
  "80304": 700,  // Boulder north
  "80305": 600,  // Boulder south
  // ── Georgia — Atlanta Metro ───────────────────────────────────────────────
  "30305": 700,  // Buckhead
  "30306": 600,  // Virginia-Highland
  "30307": 550,  // Candler Park / Kirkwood
  "30308": 500,  // Midtown
  "30309": 550,  // Ansley Park / Midtown north
  "30318": 500,  // West Midtown / Blandtown
  "30327": 700,  // Sandy Springs / Buckhead west
  "30342": 650,  // Sandy Springs / North Buckhead
  // ── Oregon — Portland Metro ───────────────────────────────────────────────
  "97201": 600,  // Downtown / SW Hills
  "97202": 600,  // Sellwood / Brooklyn
  "97205": 600,  // Goose Hollow / NW Hills
  "97209": 650,  // Pearl District
  "97210": 600,  // Nob Hill / Northwest District
  "97212": 600,  // Irvington / Alameda
  "97213": 550,  // Hollywood / Laurelhurst
  "97214": 600,  // Hawthorne / Sunnyside
  "97215": 550,  // Mt Tabor
  "97221": 650,  // West Hills / SW
  // ── Texas — Austin Metro ──────────────────────────────────────────────────
  "78701": 700,  // Downtown Austin
  "78703": 750,  // Tarrytown / Clarksville
  "78704": 700,  // Travis Heights / South Austin
  "78705": 650,  // Hyde Park / UT area
  "78731": 700,  // Northwest Hills
  "78733": 750,  // Barton Creek / Westlake adj.
  "78746": 800,  // Westlake Hills / Rob Roy
  "78750": 600,  // Northwest Austin
  // ── DC Metro ─────────────────────────────────────────────────────────────
  "20001": 700,  // DC Shaw / U Street
  "20002": 650,  // DC Capitol Hill east
  "20003": 700,  // DC Capitol Hill / Navy Yard
  "20007": 800,  // Georgetown
  "20008": 750,  // Woodley Park / Cathedral Heights
  "20009": 700,  // Adams Morgan / Columbia Heights
  "20010": 650,  // Columbia Heights north
  "20016": 800,  // Spring Valley / American U
  "20015": 750,  // Chevy Chase DC
  "20817": 750,  // Bethesda / Chevy Chase MD
  "20814": 700,  // Bethesda
  "20815": 750,  // Chevy Chase MD
  "22101": 700,  // McLean VA
  "22102": 750,  // Tysons / McLean
  "22201": 650,  // Arlington Clarendon
  "22202": 600,  // Arlington Crystal City
  "22207": 700,  // Arlington north
  // ── Tennessee — Nashville ─────────────────────────────────────────────────
  "37203": 550,  // The Gulch / Midtown
  "37205": 600,  // Belle Meade
  "37206": 500,  // East Nashville
  "37209": 500,  // Sylvan Park / Charlotte
  "37212": 550,  // Belmont / Green Hills adj.
  "37215": 600,  // Green Hills
  "37220": 600,  // Oak Hill
  // ── North Carolina — Charlotte ────────────────────────────────────────────
  "28202": 500,  // Uptown Charlotte
  "28203": 550,  // Dilworth / South End
  "28204": 500,  // Elizabeth / Myers Park adj.
  "28205": 450,  // Plaza Midwood / NoDa
  "28207": 600,  // Myers Park
  "28209": 550,  // Sedgefield / Dilworth
  "28210": 500,  // South Charlotte / Ballantyne north
  // ── Florida — Miami Metro ─────────────────────────────────────────────────
  "33101": 600,  // Miami NW
  "33129": 900,  // Coconut Grove adj.
  "33131": 1000, // Brickell
  "33132": 950,  // Edgewater / Wynwood
  "33133": 900,  // Coconut Grove
  "33134": 800,  // Coral Gables
  "33137": 850,  // Upper Eastside / Design District
  "33139": 1100, // South Beach
  "33140": 1200, // Mid-Beach
  "33141": 1000, // Surfside
  "33154": 1100, // Bal Harbour
  "33156": 800,  // South Miami / Pinecrest
  "33158": 850,  // Old Cutler / Palmetto Bay
  "33480": 1500, // Palm Beach
};

export function getZipNewConstructionPpsf(
  zip: string | undefined | null
): number | null {
  if (!zip) return null;
  const cleaned = zip.toString().trim().slice(0, 5);
  return ZIP_NEW_CONSTRUCTION_PPSF[cleaned] ?? null;
}

export interface DefaultSellPricePerSqft {
  value: number;
  source:
    | "neighborhood_new"
    | "neighborhood_resale"
    | "neighborhood_all"
    | "zip_premium"
    | "flat_fallback";
  neighborhoodMedianPpsf?: number;
  compCount?: number;
  multiplier: number;
  strategy: Strategy;
  zip?: string;
}

/**
 * Strategy-aware default sell $/sqft.
 *
 * Pulls a filtered slice of nearby cited comps, takes the median $/sqft,
 * and applies the strategy-appropriate multiplier. Falls back to all
 * comps (with adjusted multiplier) if the strategy filter yields too few,
 * then to WA-wide defaults if no comps are usable.
 */
export function getDefaultSellPricePerSqft(
  property: PropertyData,
  tier: QualityTier,
  strategy: Strategy
): DefaultSellPricePerSqft {
  const nb = property.neighborhood;

  // Helper: pull median $/sqft from a comp subset.
  const medianPpsf = (
    comps: Array<{ pricePerSqft?: number }> | undefined
  ): { median: number; count: number } | null => {
    if (!comps || comps.length === 0) return null;
    const valid = comps
      .map((c) => c.pricePerSqft)
      .filter((v): v is number => typeof v === "number" && v > 0 && v < 5000);
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a - b);
    return { median: sorted[Math.floor(sorted.length / 2)], count: valid.length };
  };

  // Lazy helper: build the fallback (ZIP-aware, then WA-wide flat) for any branch.
  const fallback = (): DefaultSellPricePerSqft => {
    const zipPremiumBase = getZipNewConstructionPpsf(property.zip);
    if (zipPremiumBase !== null) {
      // ZIP table is calibrated to "premium tier new construction" baseline.
      // Scale to the user's tier using a relative multiplier vs premium.
      const tierMult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
      const premiumMult = TIER_NEW_CONSTRUCTION_MULTIPLIER.premium;
      const relativeTierMult = tierMult / premiumMult;
      // For flip_fix, apply renovation discount (~80% of new-build sale price).
      const flipDiscount = strategy === "flip_fix" ? 0.80 : 1.0;
      return {
        value: Math.round(zipPremiumBase * relativeTierMult * flipDiscount),
        source: "zip_premium",
        multiplier: relativeTierMult * flipDiscount,
        strategy,
        zip: property.zip,
      };
    }
    const flat =
      strategy === "flip_fix"
        ? DEFAULT_FLIP_PRICE_PER_SQFT[tier]
        : DEFAULT_SELL_PRICE_PER_SQFT[tier];
    return {
      value: flat,
      source: "flat_fallback",
      multiplier:
        strategy === "flip_fix"
          ? TIER_FLIP_PREMIUM[tier]
          : TIER_NEW_CONSTRUCTION_MULTIPLIER[tier],
      strategy,
    };
  };

  if (!nb || nb.sales.length === 0) {
    return fallback();
  }

  // For new-build strategies:
  //  Tier 1) Have ≥3 NEW-construction comps → use their median DIRECTLY.
  //           (No tier multiplier — those comps ARE new-construction prices.)
  //  Tier 2) <3 new comps → use all-comp median × tier multiplier
  //           (multiplier here estimates the new-construction premium over resale).
  //  Tier 3) <3 valid comps anywhere → WA flat fallback.
  if (strategy === "fresh_build" || strategy === "split_build") {
    const newComps = nb.sales.filter((s) => s.isNewConstructionAtSale === true);
    const fromNew = medianPpsf(newComps);
    if (fromNew && fromNew.count >= 3) {
      return {
        value: fromNew.median, // direct — these ARE new-construction sale prices
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromNew.median,
        compCount: fromNew.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const mult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // main_adu: prefer SFR+ADU comps, fall back to recent SFRs (new), then all.
  // When we have new-construction comps, use them directly (no multiplier).
  if (strategy === "main_adu") {
    const aduComps = nb.sales.filter((s) => s.typology === "sfr_with_adu");
    const fromAdu = medianPpsf(aduComps);
    if (fromAdu && fromAdu.count >= 3) {
      return {
        value: fromAdu.median,
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromAdu.median,
        compCount: fromAdu.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const recentSfr = nb.sales.filter(
      (s) => s.typology === "sfr" && (s.isNewConstructionAtSale || (s.yearBuilt ?? 0) >= 2015)
    );
    const fromRecentSfr = medianPpsf(recentSfr);
    if (fromRecentSfr && fromRecentSfr.count >= 3) {
      return {
        value: fromRecentSfr.median, // recent SFR ≈ new construction valuation
        source: "neighborhood_new",
        neighborhoodMedianPpsf: fromRecentSfr.median,
        compCount: fromRecentSfr.count,
        multiplier: 1.0,
        strategy,
      };
    }
    const mult = TIER_NEW_CONSTRUCTION_MULTIPLIER[tier];
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // flip_fix: comp pool = ALL existing-home resale (SFRs, both new and old).
  // Apply RENOVATION premium, not new-construction premium.
  if (strategy === "flip_fix") {
    const mult = TIER_FLIP_PREMIUM[tier];
    // Prefer non-new comps since flips compete with the existing-home market.
    const resaleComps = nb.sales.filter(
      (s) =>
        (s.typology === "sfr" || s.typology === "sfr_with_adu") &&
        !s.isNewConstructionAtSale
    );
    const fromResale = medianPpsf(resaleComps);
    if (fromResale && fromResale.count >= 3) {
      return {
        value: Math.round(fromResale.median * mult),
        source: "neighborhood_resale",
        neighborhoodMedianPpsf: fromResale.median,
        compCount: fromResale.count,
        multiplier: mult,
        strategy,
      };
    }
    const fromAll = medianPpsf(nb.sales);
    if (fromAll && fromAll.count >= 3) {
      return {
        value: Math.round(fromAll.median * mult),
        source: "neighborhood_all",
        neighborhoodMedianPpsf: fromAll.median,
        compCount: fromAll.count,
        multiplier: mult,
        strategy,
      };
    }
    return fallback();
  }

  // Default (pass etc): fall back to standard new construction default.
  return fallback();
}

// ─── Strategy-specific construction cost ────────────────────────────────────
//
// Fix-n-upper renovation is fundamentally cheaper per sqft than new construction
// — we're touching finishes/systems, not pouring foundation. WA renovation
// typically runs $100–250/sqft depending on quality, vs new construction
// $220–650/sqft.
//
// Formula: max($100 floor, tier_new_cost × 0.40). Premium/luxury reno scales
// with tier (better finishes cost more), but always at ~40% of new-construction
// cost for the same tier.

const FLIP_COST_FLOOR_PER_SQFT = 100;
const FLIP_COST_RATIO = 0.40;

export function getEffectiveCostPerSqft(strategy: Strategy, tierCostPerSqft: number): number {
  if (strategy === "flip_fix") {
    return Math.max(FLIP_COST_FLOOR_PER_SQFT, Math.round(tierCostPerSqft * FLIP_COST_RATIO));
  }
  return tierCostPerSqft;
}

// Estimate sale price using the strategy-aware $/sqft helper.
function estimateSalePrice(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  buildSqft: number
): number {
  const pricePerSqft = getDefaultSellPricePerSqft(property, tier, strategy).value;

  switch (strategy) {
    case "fresh_build":
      return buildSqft * pricePerSqft;
    case "split_build": {
      // Splits sell as N similarly-sized new homes at the new-construction $/sqft.
      return buildSqft * pricePerSqft;
    }
    case "main_adu": {
      // Main house gets full $/sqft; ADU portion sells/values at ~85% of main.
      const mainValue = buildSqft * 0.75 * pricePerSqft;
      const aduValue = buildSqft * 0.25 * pricePerSqft * 0.85;
      return mainValue + aduValue;
    }
    case "flip_fix": {
      // pricePerSqft here is already the renovated-resale price (not new-construction).
      // No additional discount needed — the strategy-aware helper handled it.
      return buildSqft * pricePerSqft;
    }
    default:
      return 0;
  }
}

// Get the default buildable sqft for a strategy (exported for UI hints)
export function getDefaultBuildSqft(property: PropertyData, strategy: Strategy): number {
  return Math.round(getMaxBuildableSqft(property, strategy));
}

// Per-strategy overrides
export interface StrategyOverrides {
  buildSqft?: number;
  sellPricePerSqft?: number;
}

// Main analysis calculation
export function calculateAnalysis(
  property: PropertyData,
  strategy: Strategy,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  overrides?: StrategyOverrides
): AnalysisResult {
  const feasibility = checkFeasibility(property, strategy);
  const maxByZoning = getMaxBuildableSqft(property, strategy);

  // Neighborhood guardrails: applied when we have neighborhood data.
  // Falls back to no-op when data is absent (e.g., outside KC for now).
  let guardrails: NeighborhoodGuardrails | null = null;
  let safeMaxSqft = maxByZoning;
  if (property.neighborhood) {
    guardrails = computeNeighborhoodGuardrails({
      strategy,
      neighborhood: property.neighborhood,
      maxBuildableByZoning: maxByZoning,
    });
    if (guardrails.size.medianSqft) {
      safeMaxSqft = guardrails.size.safeMaxSqft;
    }
  }

  const buildSqft = overrides?.buildSqft ?? safeMaxSqft;
  // Strategy-aware construction cost: flip_fix uses renovation rate, not new-build cost.
  const effectiveCostPerSqft = getEffectiveCostPerSqft(strategy, costPerSqft);
  const permitMonths = getPermitMonths(strategy);
  const buildMonths = getBuildMonths(strategy, tier, buildSqft);
  const expectedSalePrice = overrides?.sellPricePerSqft
    ? buildSqft * overrides.sellPricePerSqft
    : estimateSalePrice(property, strategy, tier, buildSqft);
  const sellMonths = Math.ceil(getSellMonths(tier, expectedSalePrice));
  const timelineMonths = permitMonths + buildMonths + sellMonths;

  // Acquisition costs
  const purchasePrice = property.listingPrice;
  const closingCosts = purchasePrice * 0.025; // 2.5%
  const downPayment = purchasePrice * (financing.downPaymentPct / 100);
  const loanAmount = purchasePrice - downPayment;
  const acquisitionCost = purchasePrice + closingCosts;

  // Construction costs — use effective cost per sqft (renovation rate for flip_fix).
  const demolitionCost = strategy !== "flip_fix" ? 20000 : 0;
  const architectFees = strategy !== "flip_fix" ? buildSqft * effectiveCostPerSqft * 0.05 : 0;
  const permitFees = strategy === "split_build" ? 35000 : strategy === "flip_fix" ? 5000 : 20000;
  const contingency = buildSqft * effectiveCostPerSqft * 0.12;
  const landscaping = strategy !== "flip_fix" ? 25000 : 5000;
  const constructionCost =
    buildSqft * effectiveCostPerSqft +
    demolitionCost +
    architectFees +
    permitFees +
    contingency +
    landscaping;

  // Monthly holding costs
  const monthlyMortgage = calculateMonthlyPayment(
    loanAmount,
    financing.interestRate,
    financing.loanTermYears,
    financing.type === "interest_only"
  );
  const monthlyTax = property.annualPropertyTax / 12;
  const monthlyInsurance = (purchasePrice * 0.004) / 12; // ~0.4% annually
  const monthlyHoa = property.hoaMonthly || 0;
  const monthlyUtilities = 300;
  const holdingCostMonthly =
    monthlyMortgage + monthlyTax + monthlyInsurance + monthlyHoa + monthlyUtilities;
  const totalHoldingCost = holdingCostMonthly * timelineMonths;

  // Selling costs
  const agentCommission = expectedSalePrice * 0.05;
  const exciseTax = expectedSalePrice * 0.018; // WA excise tax ~1.8%
  const sellerConcessions = expectedSalePrice * 0.01;
  const stagingCosts = strategy !== "flip_fix" ? 5000 : 3000;
  const sellingCosts = agentCommission + exciseTax + sellerConcessions + stagingCosts;

  // Totals
  const totalProjectCost = acquisitionCost + constructionCost + totalHoldingCost + sellingCosts;
  const profit = expectedSalePrice - totalProjectCost;
  const totalCashInvested = downPayment + constructionCost + totalHoldingCost + closingCosts;
  const roi = totalCashInvested > 0 ? (profit / totalCashInvested) * 100 : 0;
  const annualizedRoi = timelineMonths > 0 ? roi * (12 / timelineMonths) : 0;

  // Generate recommendation text
  let recommendation = "";
  if (feasibility === "not_allowed") {
    recommendation = `Not feasible: ${STRATEGIES[strategy].label} is not permitted under current zoning (${property.zoningCode}).`;
  } else if (profit > 0 && roi > 15) {
    recommendation = `Strong opportunity. ${STRATEGIES[strategy].label} projects ${formatCurrency(profit)} profit (${roi.toFixed(1)}% ROI) over ${timelineMonths} months.`;
  } else if (profit > 0) {
    recommendation = `Marginal deal. ${formatCurrency(profit)} profit but ${roi.toFixed(1)}% ROI may not justify the risk and effort over ${timelineMonths} months.`;
  } else {
    recommendation = `Not viable. Projects a ${formatCurrency(Math.abs(profit))} loss. Consider a different strategy or pass on this property.`;
  }

  // Confidence scoring (architect-mode §6). Only meaningful when we have guardrails.
  let confidenceScore: number | undefined;
  let confidenceLabel: AnalysisResult["confidenceLabel"];
  // Caveats start from guardrails and get strategy-specific additions appended.
  const extraCaveats: typeof guardrails extends { caveats: infer C } ? C : never[] =
    [] as unknown as never[];
  type CaveatLite = { severity: "info" | "warning" | "block"; text: string };
  const localCaveats: CaveatLite[] = [];

  // ── Split-and-build verification caveat ────────────────────────────────
  // Without a full zoning KB (Wave 1), we cannot verify the city's specific
  // short-plat rules: max lots, geometry, frontage, access easements, critical
  // areas, deed restrictions. The lot-size math is necessary but NOT sufficient.
  if (strategy === "split_build" && feasibility !== "not_allowed") {
    const districtMin = estimateDistrictMinLotSqft(property.zoningCode);
    if (!districtMin) {
      localCaveats.push({
        severity: "warning",
        text:
          `Zoning code "${property.zoningCode}" not recognized — district minimum lot size cannot be inferred. ` +
          `Split feasibility is speculative; confirm with city planning department before offering.`,
      });
    } else {
      const required = districtMin * 2;
      const margin = ((property.lotSizeSqft - required) / required) * 100;
      localCaveats.push({
        severity: feasibility === "conditional" ? "warning" : "info",
        text:
          `Subdivision math: lot ${property.lotSizeSqft.toLocaleString()} sqft vs. required ${required.toLocaleString()} sqft ` +
          `(2× estimated district min of ${districtMin.toLocaleString()} sqft) — ${margin > 0 ? "+" : ""}${margin.toFixed(0)}% margin. ` +
          `Lot-size math alone doesn't guarantee a short plat will be approved — confirm setback, frontage, access, ` +
          `and critical-area rules with the city.`,
      });
    }
    // Always add the "needs KB verification" caveat for split until the full
    // zoning KB is wired up. This is the dominant uncertainty driver.
    localCaveats.push({
      severity: "block",
      text:
        `Split confidence is conservatively capped at 65 until LandMath's per-city ` +
        `zoning rulebook is wired (Wave 1). Few WA lots actually qualify for a short plat ` +
        `even when the lot size math works — verify with a planner before committing capital.`,
    });
  }

  if (guardrails && property.neighborhood) {
    const nb = property.neighborhood;
    const recentCutoff = Date.now() - 12 * 30 * 24 * 60 * 60 * 1000;
    const compsAreRecent = nb.sales.some((s) => {
      const t = Date.parse(s.saleDate);
      return !isNaN(t) && t >= recentCutoff;
    });
    const confidence = computeConfidence({
      zoningKnown: Boolean(property.zoningCode && property.zoningCode !== "Unknown"),
      zoningRecentlyVerified: false, // flip to true once KB lookup is wired
      lotSizeFromGis: property.lotSizeSqft > 0,
      compsCount: nb.sales.length,
      compsAreRecent,
      guardrails,
    });
    confidenceScore = confidence.score;
    confidenceLabel = confidence.label;

    // Hard cap on split_build confidence until the zoning KB is wired.
    // Even a lot that clears the 2× math should not project "High" confidence
    // — short plats are gated on city-specific rules we don't yet ingest.
    if (strategy === "split_build" && confidenceScore !== undefined) {
      confidenceScore = Math.min(65, confidenceScore);
      confidenceLabel =
        confidenceScore >= 65
          ? "Moderate"
          : confidenceScore >= 40
          ? "Low"
          : "Speculative";
    }
  }
  void extraCaveats; // reserved for future merges from guardrails

  return {
    id: `${property.id}-${strategy}-${Date.now()}`,
    propertyId: property.id,
    property,
    strategy,
    qualityTier: tier,
    costPerSqft,
    buildSqft: Math.round(buildSqft),
    financing,
    acquisitionCost: Math.round(acquisitionCost),
    constructionCost: Math.round(constructionCost),
    holdingCostMonthly: Math.round(holdingCostMonthly),
    totalHoldingCost: Math.round(totalHoldingCost),
    sellingCosts: Math.round(sellingCosts),
    totalProjectCost: Math.round(totalProjectCost),
    expectedSalePrice: Math.round(expectedSalePrice),
    profit: Math.round(profit),
    roi: Math.round(roi * 10) / 10,
    annualizedRoi: Math.round(annualizedRoi * 10) / 10,
    timelineMonths,
    permitMonths,
    buildMonths,
    sellMonths,
    feasibility,
    recommendation,
    createdAt: new Date().toISOString(),
    confidence: confidenceScore,
    confidenceLabel,
    caveats: [...localCaveats, ...(guardrails?.caveats ?? [])],
    typologyFit: guardrails?.typologyFit,
    typologyShare: guardrails?.typologyShare,
    trendBumpApplied: guardrails?.trendBumpApplied,
    safeMaxSqft: guardrails?.size.medianSqft ? guardrails.size.safeMaxSqft : undefined,
  };
}

// Score combines ROI economics with confidence (when present).
function scoreAnalysis(a: AnalysisResult): number {
  const roiScore = a.roi * 0.3;
  const annualizedScore = a.annualizedRoi * 0.25;
  const riskScore =
    (a.feasibility === "permitted" ? 10 : 5) *
    (a.strategy === "flip_fix" ? 1.2 : 1) *
    0.2;
  const capitalScore = (1 - a.totalProjectCost / 5000000) * 10 * 0.15;
  // Confidence (0–100) scaled into a similar magnitude as the other inputs.
  const confidenceScore = ((a.confidence ?? 60) / 100) * 10 * 0.1;
  return roiScore + annualizedScore + riskScore + capitalScore + confidenceScore;
}

/**
 * Run all strategies. Always returns all four in **fixed strategy-enum order**
 * (fresh_build → split_build → main_adu → flip_fix) so the UI can render them
 * in stable positions. Each analysis carries `isTopRecommendation` indicating
 * whether it's currently in the top-2 by score, and `recommended` names the
 * single best one. Stable order is critical for mobile editing — when an
 * override flips scores, the cards must NOT reorder or the focused input
 * gets detached and loses focus.
 *
 * `additional` retains the not-allowed strategies (so they can still be
 * surfaced with a "Not Allowed" badge) plus any other excluded variants.
 */
export function analyzeAllStrategies(
  property: PropertyData,
  tier: QualityTier,
  costPerSqft: number,
  financing: FinancingConfig,
  strategyOverrides?: Partial<Record<Strategy, StrategyOverrides>>
): {
  analyses: AnalysisResult[];
  additional: AnalysisResult[];
  recommended: Strategy;
} {
  const strategies: Strategy[] = ["fresh_build", "split_build", "main_adu", "flip_fix"];
  const all = strategies.map((s) =>
    calculateAnalysis(property, s, tier, costPerSqft, financing, strategyOverrides?.[s])
  );

  // Rank only the feasible ones — these compete for the top-2 slots and "best".
  const feasibleRanked = [...all]
    .filter((a) => a.feasibility !== "not_allowed")
    .map((a) => ({ strategy: a.strategy, score: scoreAnalysis(a), profit: a.profit }))
    .sort((a, b) => b.score - a.score);

  const top2Strategies = new Set(feasibleRanked.slice(0, 2).map((r) => r.strategy));
  const bestStrategy = feasibleRanked[0]?.strategy;
  const recommended: Strategy =
    bestStrategy && (feasibleRanked[0]?.profit ?? 0) > 0 ? bestStrategy : "pass";

  // Annotate all four in their original enum order.
  const annotated = all.map((a): AnalysisResult => ({
    ...a,
    isTopRecommendation: top2Strategies.has(a.strategy),
  }));

  return {
    analyses: annotated, // all four, in fixed order, top-2 marked
    additional: [],      // kept for back-compat; UI no longer uses a separate pane
    recommended,
  };
}

// Utility
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
