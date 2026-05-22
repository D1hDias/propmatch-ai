import 'server-only';

// ---------------------------------------------------------------------------
// Feature flags — centralized kill-switches for optional subsystems.
//
// All flags default to OFF. Enable via environment variables so they can
// be toggled on the VPS without a code deploy (systemd env file reload).
// ---------------------------------------------------------------------------

/**
 * ENABLE_SOURCE_2 — activates Firecrawl self-hosted scraping for portals
 * that don't have a partner API (custom URLs, site-sync jobs).
 *
 * Kill-switch: set ENABLE_SOURCE_2=false to stop all Firecrawl scraping
 * instantly without a code deploy.
 *
 * Env: ENABLE_SOURCE_2=true|false  (default: true when FIRECRAWL_API_KEY set)
 */
export function isSource2Enabled(): boolean {
  const env = process.env.ENABLE_SOURCE_2;
  if (env === 'false' || env === '0') return false;
  if (env === 'true' || env === '1') return true;
  // Auto-enable when Firecrawl is configured
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

/**
 * ENABLE_SOURCE_3 — activates Partner B API (Source 3).
 *
 * OFF by default — only enable after LOI is signed and contract is in force
 * (OPS-13). Toggling to true wires partner_b into the search pipeline.
 *
 * Env: ENABLE_SOURCE_3=true|false  (default: false)
 */
export function isSource3Enabled(): boolean {
  const env = process.env.ENABLE_SOURCE_3;
  return env === 'true' || env === '1';
}
