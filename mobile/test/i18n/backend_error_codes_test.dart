import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';

/// Drift guard for the client-side error-localisation contract.
///
/// The backend returns English-only messages alongside a stable
/// SCREAMING_SNAKE_CASE `error.code`. `errorToDisplay` derives an
/// `error.<CODE>` i18n key from that code and NEVER falls back to the English
/// message — so a code with no translation silently degrades to a generic
/// status message.
///
/// These tests make that degradation loud: every code the backend declares must
/// have an entry in BOTH `_en` and `_ar`.
void main() {
  final en = AppLocalizations(const Locale('en'));
  final ar = AppLocalizations(const Locale('ar'));

  /// Asserts [key] resolves in English AND has a genuinely distinct Arabic
  /// entry.
  ///
  /// The Arabic check is the one that catches the reported bug: `translate()`
  /// falls back `_ar -> _en -> key`, so a missing Arabic entry renders English
  /// to an Arabic user with no other visible symptom.
  void expectFullyTranslated(String key, {required String context}) {
    expect(
      AppLocalizations.hasTranslationKey(key),
      isTrue,
      reason: '$key is missing from _en ($context). Add EN + AR copy in '
          'lib/i18n/app_localizations.dart.',
    );
    expect(
      en.translate(key),
      isNot(equals(key)),
      reason: '$key falls back to the raw key in English ($context)',
    );
    expect(
      ar.translate(key),
      isNot(equals(key)),
      reason: '$key falls back to the raw key in Arabic ($context)',
    );
    expect(
      ar.translate(key),
      isNot(equals(en.translate(key))),
      reason: '$key has no Arabic entry, so an Arabic user sees the English '
          'string ($context). This is exactly the bug this guard exists to '
          'prevent.',
    );
  }

  // ── Every error.* key in the app is fully bilingual ──────────────────────
  //
  // Runs everywhere — needs no backend checkout.
  group('every error.* key is translated in both en and ar', () {
    final errorKeys = AppLocalizations.canonicalKeys
        .where((k) => k.startsWith('error.'))
        .toList()
      ..sort();

    test('the error.* namespace is not empty', () {
      expect(errorKeys, isNotEmpty);
    });

    for (final key in errorKeys) {
      test(key, () => expectFullyTranslated(key, context: 'canonical key'));
    }
  });

  // ── Every code the backend DECLARES has a matching key ───────────────────
  //
  // Reads backend/src/utils/errorCodes.ts as text — no TypeScript toolchain
  // needed. `flutter test` runs with the CWD at the mobile/ package root.
  group('backend errorCodes.ts <-> mobile error.* parity', () {
    final file = File('../backend/src/utils/errorCodes.ts');

    test('every declared backend code has an en + ar translation', () {
      if (!file.existsSync()) {
        markTestSkipped('backend/ is not present in this checkout');
        return;
      }

      // Only accept the `KEY: 'KEY',` form the file documents. A mismatch
      // between the two halves is itself a bug worth failing on.
      final re = RegExp(
        r"^\s*([A-Z][A-Z0-9_]+):\s*'([A-Z][A-Z0-9_]+)',",
        multiLine: true,
      );

      final codes = <String>{};
      for (final m in re.allMatches(file.readAsStringSync())) {
        expect(
          m.group(2),
          equals(m.group(1)),
          reason: 'errorCodes.ts entry ${m.group(1)} does not match its value '
              '${m.group(2)} — clients key off the value.',
        );
        codes.add(m.group(1)!);
      }

      // Guard against a reformat silently making this test vacuous.
      expect(
        codes,
        isNotEmpty,
        reason: 'the errorCodes.ts regex matched nothing — the file was '
            'probably reformatted; update the pattern rather than deleting '
            'this test',
      );
      // Ratchet: codes are append-only per the contract in errorCodes.ts.
      expect(
        codes.length,
        greaterThanOrEqualTo(85),
        reason: 'errorCodes.ts declares fewer codes than before — codes must '
            'never be removed',
      );

      for (final code in codes) {
        expectFullyTranslated('error.$code', context: 'declared in errorCodes.ts');
      }
    });
  });
}
