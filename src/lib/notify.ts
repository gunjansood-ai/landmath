/**
 * LandMath — Push alert helper via ntfy.sh
 *
 * Mirrors the sendSmsAlert() convention used in TheBriefPWA/api/refresh.js:
 *   🚨  prefix → urgent priority  (hard failure — service is broken)
 *   ⚠️  prefix → high priority    (degraded — partial data returned)
 *   anything else → default        (info / success)
 *
 * Set NTFY_TOPIC in your environment (e.g. "landmath-gunjan-alerts").
 * Subscribe at https://ntfy.sh/<topic> or install the ntfy iOS/Android app.
 * If NTFY_TOPIC is not set, alerts are skipped silently — the app keeps working.
 */

const NTFY_BASE = "https://ntfy.sh";

export async function sendAlert(message: string): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.warn("[Alert] NTFY_TOPIC not set — skipping push notification");
    return;
  }

  const isError = message.startsWith("🚨");
  const isWarn  = message.startsWith("⚠️");

  const priority = isError ? "urgent" : isWarn ? "high" : "default";
  const title    = isError ? "LandMath — Service Failure"
                 : isWarn  ? "LandMath — Warning"
                 :           "LandMath — Info";
  const tags     = isError ? "rotating_light"
                 : isWarn  ? "warning"
                 :           "white_check_mark";

  try {
    const r = await fetch(`${NTFY_BASE}/${topic}`, {
      method:  "POST",
      headers: {
        "Content-Type": "text/plain",
        "Title":        title,
        "Priority":     priority,
        "Tags":         tags,
      },
      body: message,
    });
    if (!r.ok) {
      console.error("[Alert] ntfy push failed:", r.status);
    } else {
      console.log("[Alert] Push sent:", message.slice(0, 80));
    }
  } catch (err) {
    console.error("[Alert] ntfy error:", (err as Error).message);
  }
}
