import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/i18n/plan_format.dart';

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
}
