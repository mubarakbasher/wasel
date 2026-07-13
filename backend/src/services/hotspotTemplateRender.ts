/**
 * Pure token-substitution helpers for hotspot login-page templates.
 *
 * Token contract (single source of truth — see manifest.ts for full docs):
 *   %WASEL_NAME%       → router display name, HTML-escaped (& < > " ')
 *   %WASEL_ACCENT%     → lowercase #rrggbb accent colour
 *   %WASEL_ACCENT_RGB% → r,g,b decimal triplet (e.g. 15,118,110)
 *
 * MikroTik $(…) placeholders pass through byte-identical — they are never
 * touched by these helpers.
 *
 * This module has NO I/O; every function is pure and synchronous.
 */

import { HOTSPOT_ACCENT_PRESETS, HOTSPOT_TEMPLATES } from '../hotspot-templates/manifest';

/**
 * Escape a string for safe HTML insertion.
 * Escapes the five characters that can break HTML context: & < > " '
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert a 6-digit hex colour string to a CSS-compatible RGB triplet string.
 *
 * @example hexToRgbTriplet('#0f766e') → '15,118,110'
 * @throws  Error if `hex` is not a valid 6-digit hex colour.
 */
export function hexToRgbTriplet(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

/**
 * Resolve the effective accent colour for a template.
 *
 * Returns `storedHex` (lowercased) when it is a known preset hex value;
 * otherwise returns the template's defaultAccent.  If the template id is
 * unknown (defensive path), falls back to the first preset.
 *
 * @param templateId  Template id (e.g. 'clean', 'dark', 'warm').
 * @param storedHex   Per-router accent colour stored in the DB, or null/undefined.
 */
export function resolveAccent(templateId: string, storedHex: string | null | undefined): string {
  const template = HOTSPOT_TEMPLATES.find((t) => t.id === templateId);
  const defaultAccent = template?.defaultAccent ?? HOTSPOT_ACCENT_PRESETS[0].hex;

  if (!storedHex) return defaultAccent;

  const normalised = storedHex.toLowerCase();
  const isPreset = HOTSPOT_ACCENT_PRESETS.some((p) => p.hex === normalised);
  return isPreset ? normalised : defaultAccent;
}

/**
 * Substitute all WASEL token placeholders in a template HTML string.
 *
 * All three token types are replaced globally (every occurrence).
 * MikroTik `$(…)` placeholders are never touched.
 * The (operator-controlled) name is inserted LAST and via a function
 * replacer, so a router name containing "%WASEL_ACCENT%" or "$&" is
 * rendered literally instead of triggering another substitution pass
 * or String.replace's `$`-pattern semantics.
 *
 * @param html      Raw template HTML content read from disk.
 * @param name      Router display name (HTML-escaped before insertion).
 * @param accentHex Resolved accent colour hex string (e.g. '#0f766e').
 */
export function substituteTemplateTokens(
  html: string,
  { name, accentHex }: { name: string; accentHex: string },
): string {
  const escapedName = escapeHtml(name);
  const rgb = hexToRgbTriplet(accentHex);
  const accent = accentHex.toLowerCase();

  return html
    .replace(/%WASEL_ACCENT_RGB%/g, rgb)
    .replace(/%WASEL_ACCENT%/g, accent)
    .replace(/%WASEL_NAME%/g, () => escapedName);
}
