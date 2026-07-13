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
 *
 * Token substitution at serve time:
 *   All .html files are served through the public route which substitutes the
 *   following tokens before sending the response (keyed by ?router=<uuid>):
 *
 *   %WASEL_NAME%       → router display name, HTML-escaped (& < > " ')
 *   %WASEL_ACCENT%     → lowercase #rrggbb accent colour
 *   %WASEL_ACCENT_RGB% → r,g,b decimal triplet (e.g. 15,118,110)
 *
 *   These tokens are deliberately outside MikroTik's $(…) namespace so they
 *   never collide with RouterOS variables — MikroTik placeholders pass through
 *   the substitution byte-identical.
 */

export interface AccentPreset {
  id: string;
  hex: string;
  nameEn: string;
  nameAr: string;
}

/**
 * Ordered list of selectable accent colours.
 * Used by the API validator — accentColor must be one of these hex values.
 * The `hex` values are lowercased canonical strings (#rrggbb).
 */
export const HOTSPOT_ACCENT_PRESETS: AccentPreset[] = [
  { id: 'teal',    hex: '#0f766e', nameEn: 'Teal',         nameAr: 'تركوازي'     },
  { id: 'indigo',  hex: '#4f46e5', nameEn: 'Indigo',       nameAr: 'نيلي'        },
  { id: 'cobalt',  hex: '#1d4ed8', nameEn: 'Cobalt',       nameAr: 'أزرق'        },
  { id: 'emerald', hex: '#047857', nameEn: 'Emerald',      nameAr: 'زمردي'       },
  { id: 'rose',    hex: '#be123c', nameEn: 'Rose',         nameAr: 'قرمزي'       },
  { id: 'orange',  hex: '#c2410c', nameEn: 'Burnt orange', nameAr: 'برتقالي داكن' },
  { id: 'violet',  hex: '#7c3aed', nameEn: 'Violet',       nameAr: 'بنفسجي'      },
  { id: 'slate',   hex: '#334155', nameEn: 'Slate',        nameAr: 'رمادي داكن'   },
];

export interface HotspotTemplate {
  id: string;
  name: string;
  description: string;
  /**
   * Files pushed onto the router (and served via the public route).
   * preview.html is excluded — it is a render-only artifact never pushed.
   */
  files: string[];
  /**
   * Default accent colour (one of HOTSPOT_ACCENT_PRESETS[*].hex) used when
   * no per-router accent has been stored, or the stored value is not a known
   * preset hex.
   */
  defaultAccent: string;
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
    name: 'Daylight · نهار',
    description: 'Bright paper-ticket look · تصميم فاتح بروح تذكرة ورقية',
    files: [...COMMON_FILES, 'plus-jakarta-sans.woff2'],
    defaultAccent: '#0f766e',
  },
  {
    id: 'dark',
    name: 'Midnight · ليل',
    description: 'Deep night panel with a warm glow · لوحة ليلية داكنة بتوهّج هادئ',
    files: [...COMMON_FILES, 'space-grotesk.woff2'],
    defaultAccent: '#1d4ed8',
  },
  {
    id: 'warm',
    name: 'Souq · سوق',
    description: 'Bold poster band with your name as the hero · لافتة جريئة تتصدرها هوية عملك',
    files: [...COMMON_FILES, 'dm-sans.woff2'],
    defaultAccent: '#c2410c',
  },
];

/** The html-directory name set on the router (RouterOS `/ip hotspot profile` html-directory). */
export const HOTSPOT_TEMPLATE_DIR = 'wasel-hotspot';

/** Look up a template bundle by id. Returns undefined if unknown. */
export function getTemplate(id: string): HotspotTemplate | undefined {
  return HOTSPOT_TEMPLATES.find((t) => t.id === id);
}
