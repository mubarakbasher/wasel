/**
 * Hotspot captive-portal template manifest.
 *
 * Single source of truth for the API (template picker) and the "apply" file-set
 * that gets uploaded to a router's hotspot html-directory.
 *
 * Each bundle lives in `backend/src/hotspot-templates/<id>/` and contains the
 * MikroTik RouterOS hotspot servlet files. `files` lists exactly the files that
 * are served to the app and fetched onto the router (preview.html is excluded —
 * it is a render-only artifact for screenshots/the picker, never pushed).
 *
 * Brand glyph: each login/status page renders the Wi-Fi mark as an inline SVG
 * (no external image), so there is NO `wifi-logo.png` to ship. If a raster logo
 * is reintroduced later, add `'wifi-logo.png'` back to every bundle's `files`.
 *
 * Fonts: pages are fully self-contained — the captive browser has no internet
 * before login, so fonts MUST be bundled locally (no Google Fonts <link>).
 * `cairo.woff2` (Arabic subset, used by every login/status page) is common to
 * all bundles; each design also ships its own Latin display font(s).
 */

export interface HotspotTemplate {
  id: string;
  name: string;
  description: string;
  files: string[];
}

/**
 * Files common to every bundle, in upload order. Excludes preview.html.
 * md5.js is required for CHAP login hashing in login.html.
 * cairo.woff2 is the bundled Arabic font (login/status are bilingual EN/AR).
 */
const COMMON_FILES = [
  'login.html',
  'status.html',
  'logout.html',
  'alogin.html',
  'rlogin.html',
  'error.html',
  'md5.js',
  'cairo.woff2',
] as const;

export const HOTSPOT_TEMPLATES: HotspotTemplate[] = [
  {
    id: 'clean',
    name: 'Clean',
    description: 'Light, minimal card with an indigo accent.',
    files: [...COMMON_FILES, 'plus-jakarta-sans.woff2'],
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Glassmorphic dark card with aurora glow.',
    files: [...COMMON_FILES, 'space-grotesk.woff2'],
  },
  {
    id: 'warm',
    name: 'Warm',
    description: 'Warm terracotta hero with a serif headline.',
    files: [...COMMON_FILES, 'dm-sans.woff2', 'fraunces.woff2'],
  },
];

/** The html-directory name set on the router (RouterOS `/ip hotspot profile` html-directory). */
export const HOTSPOT_TEMPLATE_DIR = 'wasel-hotspot';

/** Look up a template bundle by id. Returns undefined if unknown. */
export function getTemplate(id: string): HotspotTemplate | undefined {
  return HOTSPOT_TEMPLATES.find((t) => t.id === id);
}
