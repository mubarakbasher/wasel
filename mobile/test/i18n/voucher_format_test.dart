import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/i18n/voucher_format.dart';
import 'package:wasel/models/voucher.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Minimal [Voucher] stub for these tests.
Voucher _v({
  String? limitType,
  int? limitValue,
  String? limitUnit,
  String? profileName,
  int? validitySeconds,
}) =>
    Voucher(
      id: 'test-id',
      userId: 'user-id',
      routerId: 'router-id',
      username: 'TEST001',
      createdAt: DateTime(2024),
      updatedAt: DateTime(2024),
      limitType: limitType,
      limitValue: limitValue,
      limitUnit: limitUnit,
      profileName: profileName,
      validitySeconds: validitySeconds,
    );

/// Wraps [child] in a localised [MaterialApp] so [context.tr] resolves keys.
Widget _localizedApp(Widget child, {Locale locale = const Locale('en')}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Scaffold(body: child),
  );
}

/// Pumps a [Builder] that resolves [fn] against [locale] and returns the result.
Future<T> _resolve<T>(
  WidgetTester tester,
  Locale locale,
  T Function(BuildContext) fn,
) async {
  late T result;
  await tester.pumpWidget(_localizedApp(
    Builder(builder: (c) {
      result = fn(c);
      return const SizedBox();
    }),
    locale: locale,
  ));
  await tester.pumpAndSettle();
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // ── vouchers.validityOpen key presence ────────────────────────────────────

  group('vouchers.validityOpen key', () {
    for (final locale in [const Locale('en'), const Locale('ar')]) {
      test('non-empty and resolved in ${locale.languageCode}', () {
        final l10n = AppLocalizations(locale);
        final value = l10n.translate('vouchers.validityOpen');
        expect(
          value,
          isNotEmpty,
          reason:
              'vouchers.validityOpen must have a non-empty translation in ${locale.languageCode}',
        );
        expect(
          value,
          isNot(equals('vouchers.validityOpen')),
          reason:
              'vouchers.validityOpen must resolve to a string, not the raw key',
        );
      });
    }
  });

  // ── voucherValidityText ───────────────────────────────────────────────────

  group('voucherValidityText', () {
    testWidgets('null → "Open" (en)', (t) async {
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, null)),
        'Open',
      );
    });

    testWidgets('0 → "Open" (en)', (t) async {
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, 0)),
        'Open',
      );
    });

    testWidgets('null → "مفتوح" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherValidityText(c, null)),
        'مفتوح',
      );
    });

    testWidgets('0 → "مفتوح" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherValidityText(c, 0)),
        'مفتوح',
      );
    });

    testWidgets('1800 s → "30 minutes" (en)', (t) async {
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, 1800)),
        '30 minutes',
      );
    });

    testWidgets('7200 s → "2 hours" (en)', (t) async {
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, 7200)),
        '2 hours',
      );
    });

    testWidgets('5400 s rounds to "2 hours" (en)', (t) async {
      // 5400 / 3600 = 1.5 → .round() = 2
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, 5400)),
        '2 hours',
      );
    });

    testWidgets('259200 s → "3 days" (en)', (t) async {
      // 259200 / 86400 = 3
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherValidityText(c, 259200)),
        '3 days',
      );
    });

    testWidgets('1800 s → "30 دقيقة" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherValidityText(c, 1800)),
        '30 دقيقة',
      );
    });

    testWidgets('7200 s → "2 ساعة" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherValidityText(c, 7200)),
        '2 ساعة',
      );
    });

    testWidgets('259200 s → "3 يوم" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherValidityText(c, 259200)),
        '3 يوم',
      );
    });
  });

  // ── voucherLimitTextOrNull ────────────────────────────────────────────────

  group('voucherLimitTextOrNull', () {
    testWidgets('2 GB data voucher → "2 GB" (en)', (t) async {
      final v = _v(
        limitType: 'data',
        limitValue: 2 * 1024 * 1024 * 1024,
        limitUnit: 'GB',
      );
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, v)),
        '2 GB',
      );
    });

    testWidgets('2-hour time voucher → localized hours (en)', (t) async {
      // limitValue stored as seconds: 2 * 3600 = 7200
      final v = _v(limitType: 'time', limitValue: 7200, limitUnit: 'hours');
      // displayValue = 7200 ~/ 3600 = 2; key 'vouchers.hours' = 'Hours'
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, v)),
        '2 Hours',
      );
    });

    testWidgets('2-hour time voucher → localized hours (ar)', (t) async {
      final v = _v(limitType: 'time', limitValue: 7200, limitUnit: 'hours');
      // key 'vouchers.hours' ar = 'ساعات'
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherLimitTextOrNull(c, v)),
        '2 ساعات',
      );
    });

    testWidgets('null limit + profileName "Basic" → "Basic"', (t) async {
      final v = _v(profileName: 'Basic');
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, v)),
        'Basic',
      );
    });

    testWidgets('null limit + null profileName → null', (t) async {
      expect(
        await _resolve<String?>(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, _v())),
        isNull,
      );
    });

    testWidgets('null limit + empty profileName → null', (t) async {
      final v = _v(profileName: '');
      expect(
        await _resolve<String?>(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, v)),
        isNull,
      );
    });

    testWidgets('null limit + whitespace-only profileName → null', (t) async {
      final v = _v(profileName: '   ');
      expect(
        await _resolve<String?>(t, const Locale('en'), (c) => voucherLimitTextOrNull(c, v)),
        isNull,
      );
    });
  });

  // ── voucherLimitText fallback to Unknown ──────────────────────────────────

  group('voucherLimitText (falls back to Unknown when no limit/profileName)', () {
    testWidgets('null limit + null profileName → "Unknown" (en)', (t) async {
      expect(
        await _resolve(t, const Locale('en'), (c) => voucherLimitText(c, _v())),
        'Unknown',
      );
    });

    testWidgets('null limit + null profileName → "غير معروف" (ar)', (t) async {
      expect(
        await _resolve(t, const Locale('ar'), (c) => voucherLimitText(c, _v())),
        'غير معروف',
      );
    });
  });
}
