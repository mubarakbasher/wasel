/**
 * Unit tests for hotspotTemplateRender.ts — pure functions, no I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  hexToRgbTriplet,
  resolveAccent,
  substituteTemplateTokens,
} from '../services/hotspotTemplateRender';
import { HOTSPOT_ACCENT_PRESETS } from '../hotspot-templates/manifest';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('Foo & Bar')).toBe('Foo &amp; Bar');
  });

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all five characters in a combined XSS payload', () => {
    const input = '<script>alert(1)</script>';
    const output = escapeHtml(input);
    expect(output).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(output).not.toContain('<');
    expect(output).not.toContain('>');
  });

  it('escapes a payload with all five special characters', () => {
    const input = '& < > " \'';
    expect(escapeHtml(input)).toBe('&amp; &lt; &gt; &quot; &#39;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('escapes multiple occurrences (global, not just first)', () => {
    expect(escapeHtml('a & b & c')).toBe('a &amp; b &amp; c');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// hexToRgbTriplet
// ---------------------------------------------------------------------------

describe('hexToRgbTriplet', () => {
  it('converts teal #0f766e → 15,118,110', () => {
    expect(hexToRgbTriplet('#0f766e')).toBe('15,118,110');
  });

  it('converts pure white #ffffff → 255,255,255', () => {
    expect(hexToRgbTriplet('#ffffff')).toBe('255,255,255');
  });

  it('converts pure black #000000 → 0,0,0', () => {
    expect(hexToRgbTriplet('#000000')).toBe('0,0,0');
  });

  it('converts cobalt #1d4ed8 → 29,78,216', () => {
    expect(hexToRgbTriplet('#1d4ed8')).toBe('29,78,216');
  });

  it('converts burnt orange #c2410c → 194,65,12', () => {
    expect(hexToRgbTriplet('#c2410c')).toBe('194,65,12');
  });

  it('is case-insensitive (upper hex)', () => {
    expect(hexToRgbTriplet('#0F766E')).toBe('15,118,110');
  });

  it('throws on an invalid hex string', () => {
    expect(() => hexToRgbTriplet('not-a-color')).toThrow();
  });

  it('throws on 3-digit hex shorthand (not supported)', () => {
    expect(() => hexToRgbTriplet('#fff')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveAccent
// ---------------------------------------------------------------------------

describe('resolveAccent', () => {
  const tealHex = '#0f766e';
  const cobaltHex = '#1d4ed8';
  const orangeHex = '#c2410c';

  it('returns the stored preset hex when it is in the preset list', () => {
    expect(resolveAccent('clean', tealHex)).toBe(tealHex);
  });

  it('normalises the stored hex to lowercase before comparing', () => {
    expect(resolveAccent('clean', '#0F766E')).toBe(tealHex);
  });

  it('returns template defaultAccent when storedHex is null', () => {
    expect(resolveAccent('clean', null)).toBe(tealHex);    // clean default
    expect(resolveAccent('dark', null)).toBe(cobaltHex);   // dark default
    expect(resolveAccent('warm', null)).toBe(orangeHex);   // warm default
  });

  it('returns template defaultAccent when storedHex is undefined', () => {
    expect(resolveAccent('clean', undefined)).toBe(tealHex);
  });

  it('returns template defaultAccent when storedHex is empty string', () => {
    expect(resolveAccent('dark', '')).toBe(cobaltHex);
  });

  it('returns template defaultAccent for a non-preset hex value', () => {
    // #123456 is not in the preset list — must fall back to defaultAccent
    expect(resolveAccent('clean', '#123456')).toBe(tealHex);
  });

  it('returns template defaultAccent for a completely invalid string', () => {
    expect(resolveAccent('warm', 'red')).toBe(orangeHex);
  });

  it('falls back to the first preset for an unknown templateId', () => {
    const firstPreset = HOTSPOT_ACCENT_PRESETS[0].hex;
    expect(resolveAccent('nonexistent', null)).toBe(firstPreset);
  });

  it('accepts any hex from HOTSPOT_ACCENT_PRESETS and returns it', () => {
    for (const preset of HOTSPOT_ACCENT_PRESETS) {
      // Store the preset hex against the 'clean' template — should come back unchanged
      expect(resolveAccent('clean', preset.hex)).toBe(preset.hex);
    }
  });
});

// ---------------------------------------------------------------------------
// substituteTemplateTokens
// ---------------------------------------------------------------------------

describe('substituteTemplateTokens', () => {
  const baseHtml = '<h1>%WASEL_NAME%</h1><style>--accent:%WASEL_ACCENT%;--rgb:%WASEL_ACCENT_RGB%</style>';

  it('substitutes %WASEL_NAME% inserting the escaped name', () => {
    // escapeHtml only escapes & < > " ' — other unicode (é) passes through as-is
    const result = substituteTemplateTokens(baseHtml, { name: 'My Café', accentHex: '#0f766e' });
    expect(result).toContain('My Café');
    expect(result).not.toContain('%WASEL_NAME%');
  });

  it('HTML-escapes the router name before inserting', () => {
    const result = substituteTemplateTokens(baseHtml, { name: '<Acme & Sons>', accentHex: '#0f766e' });
    expect(result).toContain('&lt;Acme &amp; Sons&gt;');
    expect(result).not.toContain('<Acme');
  });

  it('substitutes %WASEL_ACCENT% with the lowercased hex', () => {
    const result = substituteTemplateTokens(baseHtml, { name: 'Test', accentHex: '#1D4ED8' });
    expect(result).toContain('--accent:#1d4ed8');
  });

  it('renders $-sequences in the router name literally (no String.replace $-pattern semantics)', () => {
    // "$&" would re-emit the matched token, "$'" would splat the post-match tail
    const result = substituteTemplateTokens(baseHtml, { name: "Store $& $' $` $$ Cafe", accentHex: '#0f766e' });
    expect(result).toContain("Store $&amp; $&#39; $` $$ Cafe");
    expect(result).not.toContain('%WASEL_NAME%');
  });

  it('does not re-substitute tokens smuggled inside the router name', () => {
    // Name is inserted LAST — a token-shaped name must render as literal text
    const result = substituteTemplateTokens(baseHtml, { name: 'Cafe %WASEL_ACCENT%', accentHex: '#0f766e' });
    expect(result).toContain('Cafe %WASEL_ACCENT%');
    // The template's own accent slots were still substituted normally
    expect(result).toContain('--accent:#0f766e');
  });

  it('substitutes %WASEL_ACCENT_RGB% with the decimal triplet', () => {
    const result = substituteTemplateTokens(baseHtml, { name: 'Test', accentHex: '#0f766e' });
    expect(result).toContain('--rgb:15,118,110');
  });

  it('replaces ALL occurrences globally', () => {
    const html = '%WASEL_NAME% — %WASEL_NAME% — %WASEL_ACCENT% vs %WASEL_ACCENT%';
    const result = substituteTemplateTokens(html, { name: 'Net', accentHex: '#047857' });
    expect(result).toBe('Net — Net — #047857 vs #047857');
  });

  it('leaves MikroTik $(...) placeholders untouched — full fixture', () => {
    const mikrotikFixture = [
      '$(link-login-only)',
      '$(if error)',
      '$(error)',
      '$(endif)',
      '$(if chap-id)',
      '$(chap-id)',
      '$(chap-challenge)',
      '$(username)',
      '$(session-time-left)',
      '$(uptime)',
      '$(bytes-in-nice)',
      '$(bytes-out-nice)',
      '$(link-orig)',
      '$(link-logout)',
    ].join('\n');

    // Embed the placeholders in a template that also has WASEL tokens
    const html = `<title>%WASEL_NAME%</title>\n${mikrotikFixture}\n<div style="color:%WASEL_ACCENT%">rgb=%WASEL_ACCENT_RGB%</div>`;

    const result = substituteTemplateTokens(html, { name: 'Gateway', accentHex: '#1d4ed8' });

    // All MikroTik placeholders must survive byte-identical
    expect(result).toContain('$(link-login-only)');
    expect(result).toContain('$(if error)');
    expect(result).toContain('$(error)');
    expect(result).toContain('$(endif)');
    expect(result).toContain('$(if chap-id)');
    expect(result).toContain('$(chap-id)');
    expect(result).toContain('$(chap-challenge)');
    expect(result).toContain('$(username)');
    expect(result).toContain('$(session-time-left)');
    expect(result).toContain('$(uptime)');
    expect(result).toContain('$(bytes-in-nice)');
    expect(result).toContain('$(bytes-out-nice)');
    expect(result).toContain('$(link-orig)');
    expect(result).toContain('$(link-logout)');

    // WASEL tokens must be substituted
    expect(result).toContain('Gateway');
    expect(result).toContain('#1d4ed8');
    expect(result).toContain('29,78,216');

    // No raw token markers should survive
    expect(result).not.toContain('%WASEL_NAME%');
    expect(result).not.toContain('%WASEL_ACCENT%');
    expect(result).not.toContain('%WASEL_ACCENT_RGB%');
  });

  it('handles an HTML with no WASEL tokens (passthrough)', () => {
    const plain = '<html><body>Hello $(username)</body></html>';
    const result = substituteTemplateTokens(plain, { name: 'Ignored', accentHex: '#0f766e' });
    expect(result).toBe(plain);
  });
});
