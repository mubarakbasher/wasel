import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/plan.dart';
import 'package:wasel/models/subscription.dart';
import 'package:wasel/providers/subscription_provider.dart';
import 'package:wasel/screens/subscription/subscription_status_screen.dart';
import 'package:wasel/services/subscription_service.dart';
import 'package:wasel/theme/app_theme.dart';

class MockSubscriptionService extends Mock implements SubscriptionService {}

final _plan = Plan.fromJson({
  'tier': 'starter',
  'name': 'Starter',
  'price': 5,
  'currency': 'SDG',
  'maxRouters': 1,
  'monthlyVouchers': 500,
  'sessionMonitoring': 'Active only',
  'dashboard': 'Basic stats',
  'features': ['1 Router', '500 Vouchers/month'],
});

final _pendingSubscription = Subscription.fromJson({
  'id': 's-1',
  'planTier': 'starter',
  'planName': 'Starter',
  'status': 'pending',
  'voucherQuota': 500,
  'vouchersUsed': 0,
  'daysRemaining': 30,
  'maxRouters': 1,
  'startDate': '2026-06-01T00:00:00.000Z',
  'endDate': '2026-07-01T00:00:00.000Z',
});

/// A 409 the way the backend actually sends it, so `errorToDisplay` maps it to
/// the `error.SUBSCRIPTION_PENDING` key rather than a generic failure.
DioException _conflict() {
  final request = RequestOptions(path: '/subscription/request');
  return DioException(
    requestOptions: request,
    type: DioExceptionType.badResponse,
    response: Response<dynamic>(
      requestOptions: request,
      statusCode: 409,
      data: const {
        'error': {
          'code': 'SUBSCRIPTION_PENDING',
          'message': 'You already have a subscription request under review.',
        },
      },
    ),
  );
}

Widget _app(MockSubscriptionService service) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, _) => const SubscriptionStatusScreen(),
      ),
      GoRoute(
        path: '/subscription/payment',
        builder: (_, _) => const Scaffold(body: Text('payment-screen')),
      ),
    ],
  );

  return ProviderScope(
    overrides: [
      subscriptionProvider.overrideWith(
        (ref) => SubscriptionNotifier(subscriptionService: service),
      ),
    ],
    child: MaterialApp.router(
      theme: AppTheme.light,
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: router,
    ),
  );
}

void main() {
  late MockSubscriptionService service;

  setUp(() {
    service = MockSubscriptionService();
  });

  testWidgets('a rejected plan request surfaces the backend reason',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getSubscription())
        .thenAnswer((_) async => const SubscriptionResponse());
    when(() => service.getPlans()).thenAnswer((_) async => [_plan]);
    when(() => service.requestSubscription(
        planTier: 'starter', durationMonths: 1)).thenThrow(_conflict());

    await tester.pumpWidget(_app(service));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Select Starter'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    // Before the fix this 409 was only rendered when the plan list was empty,
    // so the tap looked dead.
    // EN value of error.SUBSCRIPTION_PENDING — clients render by code, never
    // the backend message, so don't "fix" this to the raw backend text above.
    expect(
      find.text('You already have a subscription request under review.'),
      findsOneWidget,
    );
    expect(find.text('payment-screen'), findsNothing);
  });

  testWidgets('every plan is blocked while a payment is pending',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getSubscription()).thenAnswer(
      (_) async => SubscriptionResponse(subscription: _pendingSubscription),
    );
    when(() => service.getPlans()).thenAnswer((_) async => [_plan]);

    await tester.pumpWidget(_app(service));
    await tester.pumpAndSettle();

    expect(
      find.text('Complete your pending payment first'),
      findsOneWidget,
    );
    expect(find.text('Select Starter'), findsNothing);
    // The existing recovery link out of the pending state stays reachable.
    expect(find.text('View Payment Instructions'), findsOneWidget);

    // The button is disabled, but tap it anyway so the assertion below is
    // meaningful rather than trivially true because nothing was attempted.
    await tester.tap(find.byType(ElevatedButton).first);
    await tester.pump();

    verifyNever(() => service.requestSubscription(
        planTier: any(named: 'planTier'),
        durationMonths: any(named: 'durationMonths')));
  });
}
