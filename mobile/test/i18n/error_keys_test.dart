import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';

/// Smoke-tests every error.* key that [errorToDisplay] can return:
/// verifies that both the English and Arabic translations are
///   1. present (non-empty)
///   2. resolved (not equal to the raw key itself)
void main() {
  const errorKeys = [
    'error.timeout',
    'error.network',
    'error.server',
    'error.unauthorized',
    'error.forbidden',
    'error.notFound',
    'error.conflict',
    'error.unknown',
    'error.security',
    'error.rateLimited',
  ];

  for (final locale in [const Locale('en'), const Locale('ar')]) {
    group('AppLocalizations(${locale.languageCode})', () {
      late AppLocalizations l10n;

      setUp(() {
        l10n = AppLocalizations(locale);
      });

      for (final key in errorKeys) {
        test('$key is translated', () {
          final value = l10n.translate(key);
          expect(
            value,
            isNotEmpty,
            reason: '$key must have a non-empty translation in ${locale.languageCode}',
          );
          expect(
            value,
            isNot(equals(key)),
            reason: '$key must not fall back to the raw key in ${locale.languageCode}',
          );
        });
      }
    });
  }
}
