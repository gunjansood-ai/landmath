# LandMath — Project State

**Last updated:** May 16, 2026 (session 2)
**Owner:** Gunjan Sood / SNK Investments
**Live URL:** https://landmath.vercel.app (production domain)
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

**Primary data source (NEW — replaces old basic layers):**
- **PropertyInfo service:** `https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_PropertyInfo/MapServer`
  - **Layer 2 — Parcels (rich):** Has `PIN`, `ADDR_FULL`, `CTYNAME`, `LOTSQFT`, `APPRLNDVAL` (appraised land value), `APPR_IMPR` (appraised improvement value), `KCA_ZONING` (actual zoning for ALL cities), `PREUSE_CODE`, `PREUSE_DESC` (present use), `PROPTYPE` (R=residential, C=commercial, K=condo)
  - **Layer 3 — Recent Sales (3 years):** Has `PIN`, `address`, `SaleDate`, `SalePrice`, `Principal_Use`. Can query with buffer (800m radius) to get nearby comp sales. Many $0 entries (non-arm's-length), filter with `SalePrice > 100000`
  - **Query format:** Use simple `geometry=lng,lat` with `inSR=4326` (NOT JSON geometry format — the JSON format returns empty results for some parcels)

**Deprecated (still in code but no longer primary):**
- Old parcels layer (`KingCo_Parcels/MapServer/0`) — only had PIN, MAJOR, MINOR, Shape
- Old zoning layer (`planning__zoning_area/MapServer/450`) — only worked for unincorporated KC
- **Assessor HTML scrape** from `blue.kingcounty.com` — still used as fallback for building details (sqft, beds, baths, year built) since PropertyInfo layer doesn't have these

---

## File Structure (Key Files)

### Pages
- `src/app/page.tsx` — Home page with address search, Google Places autocomplete (debounced 300ms), keyboard nav (ArrowUp/Down/Enter/Escape), recent analyses grid, condo/non-residential filtering, market price estimation
- `src/app/property/[id]/page.tsx` — Analysis page with 4 strategy cards, construction quality selector, financing options, timeline bars, per-strategy overrides (build sqft + sell $/sqft), Redfin comp links, LandMath recommendation banner
- `src/app/layout.tsx` — Root layout, Inter font, metadata

### Server-Side API Routes (protect API keys)
- `src/app/api/places/route.ts` — Proxy for Google Places Autocomplete. Filters to US addresses only (`components: "country:us"`)
- `src/app/api/geocode/route.ts` — Proxy for Google Geocoding. Takes `placeId`, returns parsed address components including `unit` (for condo detection) and `placeTypes` array
- `src/app/api/property/route.ts` — **Aggregated property lookup (upgraded).** Takes lat/lng → parallel queries to PropertyInfo layer 2 (rich parcel data) + layer 3 (nearby sales within 800m). If parcel has PIN, also scrapes KC Assessor for building details. Returns `{ parcel, sales, marketEstimate, assessor }`
  - `parcel` includes: pin, address, city, lotSizeSqft, appraisedLandValue, appraisedImpValue, appraisedTotal, zoningCode, presentUseCode, presentUse, propertyType
  - `sales` is top 5 nearby residential sales with address, salePrice, saleDate
  - `marketEstimate` is median of nearby residential sales (SalePrice > $100K)
  - `assessor` has: sqftLiving, yearBuilt, bedrooms, bathrooms, stories
- `src/app/api/comps/route.ts` — Proxy for RentCast comparable sales. Gracefully degrades when key missing. Uses `X-Api-Key` header

### Client-Side API Helpers
- `src/lib/api/google-places.ts` — `getAddressSuggestions(input, sessionToken)`, `geocodePlace(placeId)`. Types: `PlacePrediction`, `GeocodedAddress` (includes `unit`, `placeTypes`)
- `src/lib/api/county-gis.ts` — `getParcelByLocation()`, `getZoningByLocation()`, `getPropertyDetails(pin)`, `lookupProperty(lat, lng)`. Types: `ParcelData`, `ZoningData`, `PropertyDetails`
- `src/lib/api/rentcast.ts` — `getComparableSales()`, `getRentEstimate()`. Types: `CompSale`, `RentEstimate`, `MarketStats`

### Core Logic
- `src/lib/calculations.ts` — ROI calculation engine for all 4 strategies. Exports: `calculateAnalysis()`, `analyzeAllStrategies()`, `getDefaultBuildSqft()`, `DEFAULT_SELL_PRICE_PER_SQFT`, `StrategyOverrides` type. Cost estimation, profit/loss, timeline breakdowns
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
2. **User selects suggestion** → `/api/geocode` with `placeId` → Google Geocoding → lat/lng + parsed address + unit/placeTypes
3. **Client-side condo check** — if `geo.unit` is set, `placeTypes` includes `subpremise`, or address contains apt/unit/suite → blocked with alert
4. **Geocoded lat/lng** → `/api/property` → parallel queries:
   - PropertyInfo layer 2 (rich parcel: lot size, appraised values, zoning, present use)
   - PropertyInfo layer 3 (nearby residential sales within 800m, last 3 years)
   - If parcel has PIN → KC Assessor HTML scrape (sqft, beds, baths, year built)
5. **Server-side use check** — if `presentUse` contains condo/apartment/office/commercial/industrial → blocked
6. **Market price estimation** — priority: median of nearby sales → appraised total × 1.1 → city-based $/sqft estimate
7. **Property object built** merging all sources, with fallback estimation functions:
   - `estimateLotSize(zoningCode)` — parses zoning codes like SF-5000, R-4
   - `estimateValue(city, sqft)` — price/sqft by WA city (Seattle $550, Bellevue $650, etc.)
   - `estimateTax(assessedValue, county)` — tax rates (King 0.92%, Pierce 1.12%, etc.)
8. **Property stored in Zustand** → router navigates to `/property/{id}`
9. **Analysis page** runs `calculations.ts` for all 4 strategies → displays cards with profit, ROI, timeline

---

## Per-Strategy Overrides

Each strategy card has inline inputs for:
- **Build sqft** — defaults to the auto-calculated max buildable sqft, user can override
- **Sell $/sqft** — defaults to the tier-based sale price per sqft, user can override
- **View comps** — link to Redfin sold listings filtered to property's city
- **Reset button** — appears when any override is active, clears back to defaults

These flow through `StrategyOverrides` in `calculations.ts`. The `calculateAnalysis` and `analyzeAllStrategies` functions accept an optional `overrides` param. When `sellPricePerSqft` is overridden, expected sale price = buildSqft × sellPricePerSqft (bypassing the `estimateSalePrice` function).

Default sell prices by tier: Standard $350, Premium $500, Luxury $700, Ultra-Luxury $1000/sqft.

---

## ROI Calculation Method

- **Cash-on-cash return:** `profit / totalCashInvested`
- `totalCashInvested` = down payment + construction costs + holding costs + closing costs
- **Annualized ROI:** `ROI × (12 / timelineMonths)`
- ROI is NOT based on total property value — it's based on actual cash out of pocket

---

## Deployment Details

- **Vercel project:** `landmath` under team `the-brief`
- **Production URL:** `https://landmath.vercel.app` (NOT the deployment-hash URL like `landmath-rli3bnzf4-the-brief.vercel.app` which is frozen to the first deploy)
- **GitHub integration:** Auto-deploys on push to `main`
- **Environment variables on Vercel:** GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, RENTCAST_API_KEY (all set for Production and Preview)

---

## Known Limitations & Notes

1. **KC Assessor scraping** is fragile — HTML parsing with regex. May break if they redesign the page. Only used now for building details (sqft, beds, baths) since PropertyInfo layer doesn't have those
2. **RentCast free tier** is 50 calls/month — comps API degrades gracefully when key is missing/exhausted
3. **Tailwind v4** uses `@import "tailwindcss"` in globals.css and `@tailwindcss/postcss` in PostCSS — NOT the classic setup. Don't add `content` array or `@tailwind` directives
4. **State is client-side only** (Zustand + localStorage) — no database, no auth
5. **The `.env.local` file** is gitignored. All env vars live on Vercel for production
6. **Nearby sales data** — many KC sales records have $0 price (non-arm's-length transactions). We filter with `SalePrice > 100000`. Some areas may have few or no recent residential sales within 800m
7. **PropertyInfo geometry format** — must use simple `geometry=lng,lat` with `inSR=4326`. The JSON geometry format (`{"x":lng,"y":lat,"spatialReference":{"wkid":4326}}`) works for some parcels but returns empty for others
8. **King County only** — all GIS data sources are King County specific. Other WA counties would need different endpoints

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
11. King County GIS endpoints tested and integrated
12. Full API integration layer: 4 server routes + 3 client libraries
13. Deployed to Vercel with all env vars
14. End-to-end tested with real address (10011 NE 1st St, Bellevue — working)
15. Per-strategy build sqft and sell $/sqft override inputs added
16. Condo/apartment filtering (client-side via Google geocode subpremise + regex)
17. Redfin comp links for sell price validation
18. **Upgraded to KingCo PropertyInfo API** — accurate zoning codes for ALL cities, appraised land+improvement values, present use descriptions, nearby sales for market pricing (PENDING PUSH — see below)

---

## PENDING: Git Push Required

The latest changes (PropertyInfo API upgrade) are saved to disk but **NOT yet pushed to GitHub**. The sandbox had git lock file issues. Run this in Terminal from the `landmath` directory:

```bash
find .git -name "*.lock" -delete && git add -A && git commit -m "Upgrade to KingCo PropertyInfo API for accurate zoning and pricing" && git push
```

Changes in this push:
- `src/app/api/property/route.ts` — completely rewritten to use PropertyInfo/MapServer layers 2+3
- `src/app/page.tsx` — updated property object construction to use new API response, added server-side present use filtering, market price estimation from nearby sales

---

## Potential Next Steps

- Push pending changes and verify on production
- Add a real database (Supabase, Planetscale) for persistent property data
- User authentication
- Support counties beyond King County
- Add comp sales display on analysis page (data is now available from PropertyInfo layer 3)
- Custom domain (e.g., landmath.com)
- Mobile PWA support
- Export analysis as PDF
- Show data source info on analysis page (appraised value, nearby sales, zoning source)
