/**
 * Bundle integrity tests — assert that every file listed in the manifest:
 *   1. Exists on disk.
 *   2. For HTML files: satisfies the design contract that the rebuilt templates
 *      must meet (token presence, accessibility attributes, no external URLs, etc.)
 *
 * IMPORTANT: These tests are written against the FINAL spec and WILL FAIL against
 * the current (pre-rebuild) template files. The template author should use the
 * failing assertions as a checklist to confirm full coverage. Do not weaken
 * assertions to make this suite pass — the failures are intentional signals.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { HOTSPOT_TEMPLATES } from '../hotspot-templates/manifest';
import { getTemplatesRootDir } from '../services/hotspotTemplate.service';

const TEMPLATES_ROOT = getTemplatesRootDir();

// HTML files that are pushed onto the router (excludes preview.html which is
// a render-only artefact never in template.files).
const PUSHED_HTML_EXTENSIONS = new Set(['.html']);
const PREVIEW_HTML = 'preview.html';

// HTML files that must contain the router name token
const NAME_TOKEN_FILES = new Set(['login.html', 'status.html', 'logout.html', 'error.html', 'alogin.html']);

for (const template of HOTSPOT_TEMPLATES) {
  describe(`Template: ${template.id} — bundle integrity`, () => {
    // ── 1. Every listed file must exist on disk ──────────────────────────────

    for (const file of template.files) {
      it(`file exists: ${file}`, () => {
        const filePath = path.join(TEMPLATES_ROOT, template.id, file);
        expect(fs.existsSync(filePath), `Missing file: ${filePath}`).toBe(true);
      });
    }

    // ── 2. HTML file contract (skips preview.html — not in template.files) ──

    const htmlFiles = template.files.filter(
      (f) => path.extname(f).toLowerCase() === '.html' && f !== PREVIEW_HTML,
    );

    for (const file of htmlFiles) {
      describe(`${file}`, () => {
        // Read the file once for all sub-assertions within this describe block.
        // We use a lazy getter so tests still run even if the file is missing
        // (the existence test above would already have failed).
        let _content: string | undefined;
        const content = (): string => {
          if (_content === undefined) {
            const filePath = path.join(TEMPLATES_ROOT, template.id, file);
            try {
              _content = fs.readFileSync(filePath, 'utf8');
            } catch {
              _content = '';
            }
          }
          return _content;
        };

        // ── No external http/https URLs ──────────────────────────────────────
        // rlogin.html legitimately contains the WISPr XML comment block which
        // uses http/https URIs — skip the URL check for that file only.
        if (file !== 'rlogin.html') {
          it('contains no http:// or https:// URLs (external resources)', () => {
            // Remove DOCTYPE and xmlns lines before checking — these are
            // standards-mandated identifiers, not resource loads.
            const stripped = content()
              .split('\n')
              .filter((line) => !/<!DOCTYPE/i.test(line) && !/xmlns\s*=/i.test(line))
              .join('\n');
            expect(stripped).not.toMatch(/https?:\/\//);
          });
        }

        // ── No inputmode= attribute ──────────────────────────────────────────
        it('does not use inputmode= (breaks captive browser input)', () => {
          expect(content()).not.toMatch(/inputmode\s*=/i);
        });

        // ── No autofocus attribute ───────────────────────────────────────────
        it('does not use autofocus (breaks captive browser UX)', () => {
          expect(content()).not.toMatch(/\bautofocus\b/i);
        });

        // ── No overflow:hidden on body ───────────────────────────────────────
        it('does not apply overflow:hidden on the body element', () => {
          // Match body {} block (non-greedy, single-line aware via /s flag) and
          // check its content does not contain overflow:hidden.
          const bodyMatch = content().match(/body\s*\{([^}]*)\}/s);
          if (bodyMatch) {
            expect(bodyMatch[1]).not.toMatch(/overflow\s*:\s*hidden/i);
          }
        });

        // ── Bilingual markup: lang="ar" and dir="rtl" ────────────────────────
        it('contains lang="ar"', () => {
          expect(content()).toContain('lang="ar"');
        });

        it('contains dir="rtl"', () => {
          expect(content()).toContain('dir="rtl"');
        });

        // ── %WASEL_NAME% token present in user-facing pages ──────────────────
        if (NAME_TOKEN_FILES.has(file)) {
          it('contains %WASEL_NAME% token', () => {
            expect(content()).toContain('%WASEL_NAME%');
          });
        }

        // ── %WASEL_NAME% only in element-text position ───────────────────────
        // The serve-time substitution entity-escapes & < > " ' — that is only
        // sufficient when the token sits between tags. Inside a tag (attribute
        // position) or a <script> block, escaping would NOT prevent injection.
        it('never places %WASEL_NAME% inside a tag or <script> block', () => {
          const html = content();
          expect(html).not.toMatch(/<[^>]*%WASEL_NAME%[^>]*>/);
          const scripts = html.match(/<script[\s\S]*?<\/script>/gi) ?? [];
          for (const block of scripts) {
            expect(block).not.toContain('%WASEL_NAME%');
          }
        });

        // ── login.html-specific assertions ───────────────────────────────────
        if (file === 'login.html') {
          it('contains $(link-login-only) form action', () => {
            expect(content()).toContain('$(link-login-only)');
          });

          it('contains $(if chap-id) conditional block', () => {
            expect(content()).toContain('$(if chap-id)');
          });

          it('contains name="username" input', () => {
            expect(content()).toContain('name="username"');
          });
        }

        // ── status.html-specific assertions ──────────────────────────────────
        if (file === 'status.html') {
          it('contains $(link-logout) logout link', () => {
            expect(content()).toContain('$(link-logout)');
          });

          it('contains $(session-time-left) session timer', () => {
            expect(content()).toContain('$(session-time-left)');
          });
        }
      });
    }
  });
}
