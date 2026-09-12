import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/bank_info.dart';
import 'package:wasel/models/payment_record.dart';
import 'package:wasel/models/subscription.dart';
import 'package:wasel/providers/subscription_provider.dart';
import 'package:wasel/screens/subscription/payment_screen.dart';
import 'package:wasel/services/subscription_service.dart';
import 'package:wasel/theme/app_theme.dart';

class MockSubscriptionService extends Mock implements SubscriptionService {}

/// A pending payment as `GET /subscription/payments` returns it after the app
/// was restarted — this is the only surviving source of the amount and the
/// reference code once the in-memory `lastRequest` is gone.
PaymentRecord _record({
  String id = 'pay-1',
  String status = 'pending',
  String? referenceCode = 'WAS-ABC123',
  String planTier = 'starter',
  String planName = 'Starter',
  String? planNameAr = 'المبتدئة',
}) {
  return PaymentRecord.fromJson({
    'id': id,
    'planTier': planTier,
    'planName': planName,
    'planNameAr': planNameAr,
    'amount': 5,
    'currency': 'SDG',
    'referenceCode': referenceCode,
    'receiptUrl': null,
    'status': status,
    'rejectionReason': status == 'rejected' ? 'Blurry image' : null,
    'reviewedAt': null,
    'createdAt': '2026-06-01T00:00:00.000Z',
  });
}

/// An active Starter subscription — used to prove that during a plan CHANGE
/// (backend keeps the old subscription row active and creates a separate
/// `pending_change` payment) the payable's own plan wins over
/// `state.subscription` on the bank-details step.
final _starterSubscription = Subscription.fromJson({
  'id': 's-1',
  'planTier': 'starter',
  'planName': 'Starter',
  'status': 'active',
  'voucherQuota': 500,
  'vouchersUsed': 0,
  'daysRemaining': 30,
  'maxRouters': 1,
  'startDate': '2026-06-01T00:00:00.000Z',
  'endDate': '2026-07-01T00:00:00.000Z',
});

/// Seeds `state.subscription` directly (PaymentScreen.initState deliberately
/// never calls `loadSubscription()`, so the test can't rely on that).
class _SeededSubscriptionNotifier extends SubscriptionNotifier {
  _SeededSubscriptionNotifier(
      SubscriptionService service, Subscription subscription)
      : super(subscriptionService: service) {
    state = state.copyWith(subscription: subscription);
  }
}

const _kConfiguredBank = BankInfo(
  bankName: 'Bank of Khartoum',
  accountNumber: '1234567890',
  accountHolder: 'Wasel Ltd',
  instructions: '',
);

const _kUnconfiguredBank = BankInfo(
  bankName: '',
  accountNumber: '',
  accountHolder: '',
  instructions: '',
);

Widget _app(
  MockSubscriptionService service, {
  Locale locale = const Locale('en'),
  SubscriptionNotifier Function(SubscriptionService)? notifierBuilder,
}) {
  return ProviderScope(
    overrides: [
      subscriptionProvider.overrideWith(
        (ref) => notifierBuilder != null
            ? notifierBuilder(service)
            : SubscriptionNotifier(subscriptionService: service),
      ),
    ],
    child: MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const PaymentScreen(),
    ),
  );
}

/// The success step keeps an indeterminate progress indicator alive, so
/// `pumpAndSettle` would never return — pump explicit frames instead.
Future<void> _pumpScreen(WidgetTester tester, Widget app) async {
  await tester.pumpWidget(app);
  await tester.pump(); // initState microtask -> loadBankInfo + loadPayments
  await tester.pump(const Duration(milliseconds: 400)); // stepper cross-fade
}

void main() {
  late MockSubscriptionService service;

  setUp(() {
    service = MockSubscriptionService();
  });

  testWidgets(
      'after a restart (no lastRequest) the bank step still shows amount + reference',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo()).thenAnswer((_) async => _kConfiguredBank);
    when(() => service.getUserPayments())
        .thenAnswer((_) async => [_record()]);

    await _pumpScreen(tester, _app(service));

    // Bank block (was already there).
    expect(find.text('Bank of Khartoum'), findsOneWidget);
    expect(find.text('1234567890'), findsOneWidget);
    expect(find.text('Wasel Ltd'), findsOneWidget);
    // Rehydrated from the payments list — these used to vanish on restart.
    expect(find.text('SDG 5'), findsOneWidget);
    expect(find.text('WAS-ABC123'), findsOneWidget);
    expect(find.text('Starter'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('falls back to a rejected payment when none is pending',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo()).thenAnswer((_) async => _kConfiguredBank);
    when(() => service.getUserPayments()).thenAnswer(
      (_) async => [_record(id: 'pay-r', status: 'rejected')],
    );

    await _pumpScreen(tester, _app(service));

    expect(find.text('SDG 5'), findsOneWidget);
    expect(find.text('WAS-ABC123'), findsOneWidget);
  });

  testWidgets('unconfigured bank info shows the contact-admin placeholder',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo())
        .thenAnswer((_) async => _kUnconfiguredBank);
    when(() => service.getUserPayments())
        .thenAnswer((_) async => [_record()]);

    await _pumpScreen(tester, _app(service));

    expect(find.text('Contact admin for bank details'), findsOneWidget);
    expect(find.text('Bank of Khartoum'), findsNothing);
    // The amount/reference still render — they don't depend on bank info.
    expect(find.text('SDG 5'), findsOneWidget);
    expect(find.text('WAS-ABC123'), findsOneWidget);
  });

  testWidgets('with no payment at all the amount/reference rows are omitted',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo()).thenAnswer((_) async => _kConfiguredBank);
    when(() => service.getUserPayments()).thenAnswer((_) async => []);

    await _pumpScreen(tester, _app(service));

    expect(find.text('Bank of Khartoum'), findsOneWidget);
    expect(find.text('Amount'), findsNothing);
    expect(find.text('Reference Code'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic locale renders the localized plan name from the record',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo()).thenAnswer((_) async => _kConfiguredBank);
    when(() => service.getUserPayments())
        .thenAnswer((_) async => [_record()]);

    await _pumpScreen(tester, _app(service, locale: const Locale('ar')));

    expect(find.text('المبتدئة'), findsOneWidget);
    expect(find.text('Starter'), findsNothing);
  });

  testWidgets(
      'during a plan change, the payable plan wins over state.subscription',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 2400);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    when(() => service.getBankInfo()).thenAnswer((_) async => _kConfiguredBank);
    when(() => service.getUserPayments()).thenAnswer(
      (_) async => [
        _record(
          id: 'pay-2',
          planTier: 'professional',
          planName: 'Professional',
          planNameAr: null,
        ),
      ],
    );

    await _pumpScreen(
      tester,
      _app(
        service,
        notifierBuilder: (s) =>
            _SeededSubscriptionNotifier(s, _starterSubscription),
      ),
    );

    expect(find.text('Professional'), findsOneWidget);
    expect(find.text('Starter'), findsNothing);
  });
}
