import type { CapacitorConfig } from "@capacitor/cli";

/**
 * LandMath iOS shell (Capacitor).
 *
 * Strategy: the native app is a thin shell that loads the PRODUCTION web app
 * from Vercel. This is the right call for LandMath because the app depends on
 * server API routes (/api/property, /api/comps, /api/ai/*) that hold secret
 * keys and do KC GIS aggregation — they cannot run on-device, so a static
 * export would break the app. Loading the deployed site also means every
 * `git push` updates the iOS app instantly with no App Store re-review.
 *
 * App Review note: Apple's guideline 4.2 (minimum functionality) dislikes
 * bare website wrappers. Mitigations documented in IOS_APP.md.
 */
const config: CapacitorConfig = {
  appId: "com.snkinvestments.landmath",
  appName: "LandMath",
  // webDir is required by the CLI but unused at runtime because server.url is
  // set. It ships a local fallback page shown only if the network is down.
  webDir: "ios-shell",
  server: {
    url: "https://landmath.vercel.app",
    // Keep navigation inside the app for our own domain; everything else
    // (Redfin/Zillow/municipal code links) opens in the system browser.
    allowNavigation: ["landmath.vercel.app", "*.vercel.app"],
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#16a34a",
  },
};

export default config;
