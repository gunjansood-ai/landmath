# LandMath — Project State

**Last updated:** May 16, 2026
**Owner:** Gunjan Sood / SNK Investments
**Live URL:** https://landmath-rli3bnzf4-the-brief.vercel.app
**Repo:** https://github.com/gunjansood-ai/landmath
**Vercel Team:** TheBrief (Pro plan)

---

## What LandMath Is

A mobile-first real estate investment analysis webapp. User enters a property address, and LandMath instantly analyzes it across four investment strategies (Fresh Build, Split & Build, Main + ADU, Flip & Fix), showing projected profit, ROI, and timeline for each. It recommends the best strategy.

---

## Tech Stack

- **Framework:** Next.js 16.2.6, App Router, TypeScript
- **Styling:** Tailwind CSS v4.3.0 (uses `@tailwindcss/postcss` — NOT the classic `tailwindcss` PostCSS plugin)
- **State:** Zustand with `persist` middleware (localStorage)
- **Font:** Inter via `next/font/google`
- **Icons:** lucide-react
- **Deployment:** Vercel (auto-deploys from `main` branch)

---

## API Keys & External Services

### Google Maps Platform
- **Project:** "LandMath" (ID: `landmath`) in Google Cloud Console
- **APIs enabled:** Places API, Geocoding API
- **Key:** `AIzaSyBmXebs9jksAU4-yamsiwVt33St0-KTcFI`
- **Env vars:** `GOOGLE_MAPS_API_KEY` (server-side) and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (client-side)

### RentCast
- **Key:** `098e07b265ec465ca2ed8413d0b6c76b`
- **Free tier:** 50 API calls/month
- **Env var:** `RENTCAST_API_KEY`
- **Endpoint used:** `api.rentcast.io/v1/listings/sale`

### King County GIS (Free, no key needed)
- **Parcels:** `https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_Parcels/MapServer/0/query`
- **Zoning:** `https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/planning__zoning_area/MapServer/450/query`
  - **Important:** Layer ID is **450**, not 0
  - **Limitation:** Only covers unincorporated King County — addresses within city limits (Seattle, Bellevue, etc.) return empty zoning data
- **Assessor:** HTML scrape from `blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr={PIN}`

---

## File Structure (Key Files)

### Pages
- `src/app/page.tsx` — Home page with address search, Google Places autocomplete (debounced 300ms), keyboard nav (ArrowUp/Down/Enter/Escape), recent analyses grid
- `src/app/property/[id]/page.tsx` — Analysis page with 4 strategy cards, construction quality selector, financing options, timeline bars, and LandMath recommendation banner
- `src/app/layout.tsx` — Root layout, Inter font, metadata

### Server-Side API Routes (protect API keys)
- `src/app/api/places/route.ts` — Proxy for Google Places Autocomplete. Filters to US addresses only (`components: "country:us"`)
- `src/app/api/geocode/route.ts` — Proxy for Google Geocoding. Takes `placeId`, returns parsed address components (streetNumber, street, city, county, state, zip, lat, lng). Strips "County" suffix
- `src/app/api/property/route.ts` — Aggregated property lookup. Takes lat/lng → parallel queries to KC Parcels + Zoning ArcGIS → if parcel found, scrapes KC Assessor HTML for details. Returns `{ parcel, zoning, assessor }`
- `src/app/api/comps/route.ts` — Proxy for RentCast comparable sales. Gracefully degrades when key missing. Uses `X-Api-Key` header

### Client-Side API Helpers
- `src/lib/api/google-places.ts` — `getAddressSuggestions(input, sessionToken)`, `geocodePlace(placeId)`. Types: `PlacePrediction`, `GeocodedAddress`
- `src/lib/api/county-gis.ts` — `getParcelByLocation()`, `getZoningByLocation()`, `getPropertyDetails(pin)`, `lookupProperty(lat, lng)`. Types: `ParcelData`, `ZoningData`, `PropertyDetails`
- `src/lib/api/rentcast.ts` — `getComparableSales()`, `getRentEstimate()`. Types: `CompSale`, `RentEstimate`, `MarketStats`

### Core Logic
- `src/lib/calculations.ts` — ROI calculation engine for all 4 strategies. Cost estimation, profit/loss, timeline breakdowns
- `src/store/useStore.ts` — Zustand store. Types: `PropertyData`, `AnalysisResult`, `UserSettings`. Actions: `setCurrentProperty`, `saveAnalysis`, `updateSettings`, etc.

### Components
- `src/components/Navigation.tsx` — Top nav bar with Analyze, My Properties, Settings links

### Config
- `tailwind.config.ts` — Brand colors (green primary), surface colors, custom shadows (`shadow-elevated`)
- `postcss.config.mjs` — Uses `@tailwindcss/postcss` (Tailwind v4 syntax)
- `tsconfig.json` — Bundler module resolution, `@/` path alias
- `.env.local` — All 3 API keys (in `.gitignore`, NOT pushed to GitHub)

---

## Data Flow (End-to-End)

1. **User types address** → debounced (300ms) call to `/api/places` → Google Places Autocomplete → dropdown suggestions
2. **User selects suggestion** → `/api/geocode` with `placeId` → Google Geocoding → lat/lng + parsed address
3. **Geocoded lat/lng** → `/api/property` → parallel King County ArcGIS queries (parcels + zoning) → if parcel has PIN, scrapes KC Assessor
4. **Property object built** merging all sources, with fallback estimation functions:
   - `estimateLotSize(zoningCode)` — parses zoning codes like SF-5000, R-4
   - `estimateValue(city, sqft)` — price/sqft by WA city (Seattle $550, Bellevue $650, etc.)
   - `estimateTax(assessedValue, county)` — tax rates (King 0.92%, Pierce 1.12%, etc.)
5. **Property stored in Zustand** → router navigates to `/property/{id}`
6. **Analysis page** runs `calculations.ts` for all 4 strategies → displays cards with profit, ROI, timeline

---

## Deployment Details

- **Vercel project:** `landmath` under team `the-brief`
- **GitHub integration:** Auto-deploys on push to `main`
- **Environment variables on Vercel:** GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, RENTCAST_API_KEY (all set for Production and Preview)
- **Latest deployed commit:** `faf4842` — "Add API integration: Google Places, County GIS, RentCast"

---

## Known Limitations & Notes

1. **King County zoning** only covers unincorporated areas — city addresses get empty zoning, falls back to estimate
2. **KC Assessor scraping** is fragile — HTML parsing with regex. May break if they redesign the page
3. **RentCast free tier** is 50 calls/month — comps API degrades gracefully when key is missing/exhausted
4. **Tailwind v4** uses `@import "tailwindcss"` in globals.css and `@tailwindcss/postcss` in PostCSS — NOT the classic setup. Don't add `content` array or `@tailwind` directives
5. **State is client-side only** (Zustand + localStorage) — no database, no auth
6. **The `.env.local` file** is gitignored. All env vars live on Vercel for production

---

## What's Been Completed (Build History)

1. Product spec / PRD created
2. Next.js project scaffolded with all dependencies
3. Full UI built: home page, property analysis page, navigation, settings
4. 4-strategy ROI engine (Fresh Build, Split & Build, Main + ADU, Flip & Fix)
5. Financial calculator with construction quality tiers and financing options
6. Local storage persistence + share functionality
7. GitHub repo created and pushed
8. Tailwind CSS v4 compatibility fixes
9. Google Maps Places API + Geocoding API enabled
10. RentCast API key obtained
11. King County GIS endpoints tested and integrated (parcels layer 0, zoning layer 450)
12. Full API integration layer: 4 server routes + 3 client libraries
13. Deployed to Vercel with all env vars
14. End-to-end tested with real address (10011 NE 1st St, Bellevue — working)

---

## Per-Strategy Overrides (added May 16, 2026)

Each strategy card now has inline inputs for:
- **Build sqft** — defaults to the auto-calculated max buildable sqft, user can override
- **Sell $/sqft** — defaults to the tier-based sale price per sqft, user can override
- **Reset button** — appears when any override is active, clears back to defaults

These flow through `StrategyOverrides` in `calculations.ts`. The `calculateAnalysis` and `analyzeAllStrategies` functions accept an optional `overrides` param. When `sellPricePerSqft` is overridden, expected sale price = buildSqft × sellPricePerSqft (bypassing the `estimateSalePrice` function).

Default sell prices by tier: Standard $350, Premium $500, Luxury $700, Ultra-Luxury $1000/sqft.

---

## Potential Next Steps

- Add a real database (Supabase, Planetscale) for persistent property data
- User authentication
- Support counties beyond King County
- Improve assessor data sourcing (find a proper API vs HTML scraping)
- Add comp sales display on analysis page (RentCast data is fetched but not shown yet)
- Custom domain (e.g., landmath.com)
- Mobile PWA support
- Export analysis as PDF
