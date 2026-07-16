import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/i18n/plan_format.dart';
import 'package:wasel/models/plan.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/// Pumps a [Builder] that calls [fn] with a localised [BuildContext] and
/// returns the result after a full frame settle.
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
// Plan fixtures used by buildPlanFeatures tests
// ---------------------------------------------------------------------------

const _starterPlan = Plan(
  tier: 'starter',
  name: 'Starter',
  nameAr: 'المبتدئة',
  price: 10,
  currency: 'SDG',
  maxRouters: 1,
  monthlyVouchers: 500,
  sessionMonitoring: 'Active only',
  dashboard: 'Basic stats',
  features: [],
  allowedDurations: [1],
);

const _largePlan = Plan(
  tier: 'enterprise',
  name: 'Enterprise',
  nameAr: 'المؤسسات',
  price: 100,
  currency: 'SDG',
  maxRouters: 10,
  monthlyVouchers: 2000,
  sessionMonitoring: 'Full + export',
  dashboard: 'Full analytics + reports',
  features: [],
  allowedDurations: [1, 3, 6],
);

const _unlimitedPlan = Plan(
  tier: 'enterprise',
  name: 'Enterprise',
  nameAr: 'المؤسسات',
  price: 100,
  currency: 'SDG',
  maxRouters: 1,
  monthlyVouchers: -1,
  sessionMonitoring: 'Active only',
  dashboard: 'Basic stats',
  features: [],
  allowedDurations: [1],
);

const _unknownCapPlan = Plan(
  tier: 'starter',
  name: 'Starter',
  nameAr: null,
  price: 10,
  currency: 'SDG',
  maxRouters: 1,
  monthlyVouchers: 500,
  sessionMonitoring: 'Something custom',
  dashboard: '',
  features: [],
  allowedDurations: [1],
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('pickPlanName', () {
    group('English locale', () {
      testWidgets('returns name when nameAr is null', (t) async {
        final result = await _resolve(t, const Locale('en'), (c) {
          return pickPlanName(c, name: 'Starter', nameAr: null);
        });
        expect(result, 'Starter');
      });

      testWidgets('returns name when nameAr is empty string', (t) async {
        final result = await _resolve(t, const Locale('en'), (c) {
          return pickPlanName(c, name: 'Professional', nameAr: '');
        });
        expect(result, 'Professional');
      });

      testWidgets('returns name even when nameAr is provided', (t) async {
        final result = await _resolve(t, const Locale('en'), (c) {
          return pickPlanName(c,
              name: 'Enterprise', nameAr: 'إنتربرايز');
        });
        expect(result, 'Enterprise');
      });
    });

    group('Arabic locale', () {
      testWidgets('returns nameAr when available', (t) async {
        final result = await _resolve(t, const Locale('ar'), (c) {
          return pickPlanName(c,
              name: 'Starter', nameAr: 'ستارتر');
        });
        expect(result, 'ستارتر');
      });

      testWidgets('falls back to name when nameAr is null', (t) async {
        final result = await _resolve(t, const Locale('ar'), (c) {
          return pickPlanName(c, name: 'Starter', nameAr: null);
        });
        expect(result, 'Starter');
      });

      testWidgets('falls back to name when nameAr is empty string', (t) async {
        final result = await _resolve(t, const Locale('ar'), (c) {
          return pickPlanName(c, name: 'Professional', nameAr: '');
        });
        expect(result, 'Professional');
      });
    });
  });

  group('buildPlanFeatures', () {
    testWidgets('EN starter plan produces correct bullet list', (t) async {
      final result = await _resolve<List<String>>(t, const Locale('en'), (c) {
        return buildPlanFeatures(c, _starterPlan);
      });
      expect(result, [
        '1 Router',
        '500 Vouchers/month',
        'Active session monitoring',
        'Basic dashboard',
      ]);
    });

    testWidgets('AR starter plan produces correct localized bullet list',
        (t) async {
      final result = await _resolve<List<String>>(t, const Locale('ar'), (c) {
        return buildPlanFeatures(c, _starterPlan);
      });
      expect(result, [
        'راوتر واحد',
        '500 كرت/شهر',
        'مراقبة الجلسات النشطة',
        'لوحة تحكم أساسية',
      ]);
    });

    testWidgets('EN plural plan with grouping produces correct first two entries',
        (t) async {
      final result = await _resolve<List<String>>(t, const Locale('en'), (c) {
        return buildPlanFeatures(c, _largePlan);
      });
      expect(result[0], '10 Routers');
      expect(result[1], '2,000 Vouchers/month');
    });

    testWidgets('AR plural plan with grouping produces correct first two entries',
        (t) async {
      final result = await _resolve<List<String>>(t, const Locale('ar'), (c) {
        return buildPlanFeatures(c, _largePlan);
      });
      expect(result[0], '10 راوترات');
      expect(result[1], '2,000 كرت/شهر');
    });

    testWidgets('EN unlimited vouchers renders unlimited label', (t) async {
      final result = await _resolve<List<String>>(t, const Locale('en'), (c) {
        return buildPlanFeatures(c, _unlimitedPlan);
      });
      expect(result[1], 'Unlimited Vouchers');
    });

    testWidgets('AR unlimited vouchers renders unlimited label', (t) async {
      final result = await _resolve<List<String>>(t, const Locale('ar'), (c) {
        return buildPlanFeatures(c, _unlimitedPlan);
      });
      expect(result[1], 'كروت غير محدودة');
    });

    testWidgets(
        'unknown sessionMonitoring falls back to raw text; empty dashboard is skipped',
        (t) async {
      final result = await _resolve<List<String>>(t, const Locale('en'), (c) {
        return buildPlanFeatures(c, _unknownCapPlan);
      });
      expect(result.length, 3);
      expect(result[2], 'Something custom');
    });
  });
}
