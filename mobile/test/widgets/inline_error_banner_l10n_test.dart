import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/utils/error_messages.dart';
import 'package:wasel/widgets/inline_error_banner.dart';

/// Wraps [child] inside a [MaterialApp] that has full localisation support so
/// that [context.trOrRaw] can resolve i18n keys.
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

void main() {
  group('InlineErrorBanner – i18n key resolution', () {
    testWidgets('error.timeout resolves to EN string under Locale("en")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'error.timeout'),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      // The EN translation for error.timeout
      const enTranslation = 'Request timed out. Please try again.';
      expect(find.text(enTranslation), findsOneWidget,
          reason: 'error.timeout should be resolved to the English string');
      expect(find.text('error.timeout'), findsNothing,
          reason: 'The raw key must not appear in the UI');
    });

    testWidgets('error.timeout resolves to AR string under Locale("ar")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'error.timeout'),
          locale: const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      const arTranslation = 'انتهت مهلة الطلب. يرجى المحاولة مرة أخرى.';
      expect(find.text(arTranslation), findsOneWidget,
          reason: 'error.timeout should resolve to the Arabic string');
      expect(find.text('error.timeout'), findsNothing,
          reason: 'The raw key must not appear in the UI');
    });

    testWidgets('a literal backend message renders unchanged', (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          const InlineErrorBanner(message: 'Email already registered'),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Email already registered'), findsOneWidget,
          reason: 'Literal backend messages must pass through as-is');
    });
  });

  // ── REGRESSION: the reported bug, end to end ─────────────────────────────
  //
  // Arabic UI + a real backend rate-limit response must render Arabic. Before
  // the fix, errorToDisplay returned the backend's English `message` verbatim
  // and trOrRaw passed it straight through to the banner.
  group('REGRESSION - backend English never reaches an Arabic UI', () {
    // Exactly what backend/src/middleware/rateLimiter.ts returns for the auth
    // limiter, which guards every route in auth.routes.ts.
    DioException authRateLimited() => DioException(
          requestOptions: RequestOptions(path: '/auth/login'),
          type: DioExceptionType.badResponse,
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: '/auth/login'),
            statusCode: 429,
            data: const {
              'success': false,
              'error': {
                'message': 'Too many auth attempts, please try again later.',
                'code': 'AUTH_RATE_LIMIT_EXCEEDED',
              },
            },
          ),
        );

    testWidgets('AUTH_RATE_LIMIT_EXCEEDED renders Arabic under Locale("ar")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          InlineErrorBanner(message: errorToDisplay(authRateLimited())),
          locale: const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('محاولات كثيرة جدًا. يرجى الانتظار دقيقة ثم المحاولة مرة أخرى.'),
        findsOneWidget,
        reason: 'the Arabic translation must be shown',
      );
      expect(
        find.text('Too many auth attempts, please try again later.'),
        findsNothing,
        reason: 'the backend English message must never reach an Arabic UI',
      );
      expect(
        find.text('error.AUTH_RATE_LIMIT_EXCEEDED'),
        findsNothing,
        reason: 'the raw key must not appear either',
      );
    });

    testWidgets('the same response renders the curated EN copy under Locale("en")',
        (tester) async {
      await tester.pumpWidget(
        _localizedApp(
          InlineErrorBanner(message: errorToDisplay(authRateLimited())),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.text('Too many attempts. Please wait a minute and try again.'),
        findsOneWidget,
        reason: 'English users get the curated copy, not the backend string',
      );
    });

    testWidgets('an untranslated code falls back to Arabic, not English',
        (tester) async {
      final unknown = DioException(
        requestOptions: RequestOptions(path: '/auth/login'),
        type: DioExceptionType.badResponse,
        response: Response<dynamic>(
          requestOptions: RequestOptions(path: '/auth/login'),
          statusCode: 429,
          data: const {
            'error': {
              'message': 'Some brand new English text',
              'code': 'A_CODE_THIS_BUILD_DOES_NOT_KNOW',
            },
          },
        ),
      );

      await tester.pumpWidget(
        _localizedApp(
          InlineErrorBanner(message: errorToDisplay(unknown)),
          locale: const Locale('ar'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Some brand new English text'), findsNothing,
          reason: 'an unknown code must degrade to a localized generic, never '
              'to the backend English message');
      expect(find.text('محاولات كثيرة جدًا. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.'), findsOneWidget);
    });
  });
}
