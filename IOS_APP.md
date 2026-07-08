# LandMath iOS App (Capacitor)

The iOS app is a native Capacitor shell that loads the production web app from
`https://landmath.vercel.app`. This architecture was chosen deliberately:

- The app depends on **server API routes** (`/api/property`, `/api/comps`,
  `/api/ai/*`) that hold secret keys and aggregate KC GIS — they can't run
  on-device, so a static export would break the app.
- Every `git push` to main updates the iOS app **instantly** — no App Store
  re-review for content/logic changes. Only shell changes (icon, splash,
  native config) require a new archive.

## What's already done (committed in this repo)

- `capacitor.config.ts` — app id `com.snkinvestments.landmath`, remote server
  URL, navigation allow-list (external links like Redfin/municipal codes open
  in Safari).
- `ios/` — the generated Xcode project (Capacitor 8, Swift Package Manager —
  no CocoaPods needed).
- `resources/` + generated iOS asset catalog — app icon (green LM) and dark
  splash screen at all required sizes.
- `ios-shell/index.html` — offline fallback page shown if the device has no
  network.
- Web app viewport uses `viewport-fit=cover` + safe-area padding so it renders
  edge-to-edge under the notch.

## One-time setup on your Mac

1. **Apple Developer Program** — enroll at https://developer.apple.com
   ($99/year). Personal team works for on-device testing without the fee, but
   TestFlight/App Store require enrollment.
2. **Xcode 16+** from the Mac App Store. Launch once, accept license, let it
   install iOS platform support.

## Build & run on your iPhone

```bash
cd ~/BuyBuild/PropertyInvestment/landmath
npm install          # pulls @capacitor/* if fresh clone
npx cap sync ios     # copies config + fallback page into the Xcode project
npx cap open ios     # opens Xcode
```

In Xcode:
1. Select the **App** target → *Signing & Capabilities* → pick your **Team**.
   Xcode auto-manages the provisioning profile for bundle id
   `com.snkinvestments.landmath` (change the id if it collides).
2. Plug in your iPhone (or pick a simulator) → press **Run** (⌘R).
3. First run on a physical device: on the phone, Settings → General → VPN &
   Device Management → trust your developer certificate.

That's it — the app opens full-screen LandMath.

## TestFlight (recommended distribution)

1. In Xcode: **Product → Archive** (with *Any iOS Device (arm64)* selected).
2. Organizer window → **Distribute App → TestFlight & App Store → Upload**.
3. In App Store Connect (https://appstoreconnect.apple.com): create the app
   record (same bundle id), wait for the build to process (~15 min), add
   yourself/partners as internal testers.
4. Install via the TestFlight app on the phone.

TestFlight is ideal for LandMath: no App Review scrutiny for internal testers
(up to 100), builds last 90 days, and you re-archive only when the native
shell changes.

## Full App Store release — read this first

Apple guideline **4.2 (minimum functionality)** rejects apps that are "simply
a website." A remote-URL Capacitor shell is at risk if reviewed as a public
listing. If you want a public App Store release later, budget for:

- Adding 2–3 native touches: haptics on scenario selection, native share
  sheet (`@capacitor/share`), push notifications for saved-property alerts
  (`@capacitor/push-notifications` + ntfy relay), Home-Screen quick actions.
- App Privacy questionnaire: the app sends addresses/coordinates to KC GIS,
  Google (geocoding), APIllow, and Anthropic — declare "Location (coarse,
  user-entered)" and "Identifiers: none".
- Review notes explaining the app is a professional underwriting tool, with a
  demo address for the reviewer (e.g. 10011 NE 1st St, Bellevue).

For personal/partner use, **stay on TestFlight** and skip all of this.

## Updating

| Change | What to do |
|---|---|
| Any web/app logic, zoning data, UI | `git push` — live in the iOS app on next launch |
| Icon, splash, app name, allowed domains | edit `capacitor.config.ts` / `resources/`, `npx cap sync ios`, re-archive |
| Capacitor major upgrade | `npm i @capacitor/{core,ios,cli}@latest && npx cap sync ios` |

## Regenerating icons

Source images live in `resources/` (1024px `icon-only.png`, 2732px
`splash.png`). After editing them:

```bash
npx @capacitor/assets generate --ios
```
