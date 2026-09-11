import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/models/payment_record.dart';
import 'package:wasel/providers/subscription_provider.dart';
import 'package:wasel/screens/settings/payments_screen.dart';
import 'package:wasel/services/subscription_service.dart';
import 'package:wasel/theme/app_theme.dart';

class MockSubscriptionService extends Mock implements SubscriptionService {}

/// The EN copy of `subscription.viewPaymentInstructions` — the recovery link
/// that takes an operator from a stuck payment back to the bank details.
const _kInstructionsLabel = 'View Payment Instructions';

/// The EN copy of the reworded `payments.pendingUploadHint`.
const _kPendingHint =
    'Transfer the amount to the bank account shown in the payment '
    'instructions, then upload your receipt here.';

PaymentRecord _payment({
  required String id,
  required String status,
  String? receiptUrl,
}) {
  return PaymentRecord.fromJson({
    'id': id,
    'planTier': 'starter',
    'planName': 'Starter',
    'amount': 5,
    'currency': 'SDG',
    'referenceCode': 'WAS-$id',
    'receiptUrl': receiptUrl,
    'status': status,
    'rejectionReason': status == 'rejected' ? 'Blurry image' : null,
    'reviewedAt': null,
    'createdAt': '2026-06-01T00:00:00.000Z',
  });
}

Widget _app(MockSubscriptionService service) {
  return ProviderScope(
    overrides: [
      subscriptionProvider.overrideWith(
        (ref) => SubscriptionNotifier(subscriptionService: service),
      ),
    ],
    child: MaterialApp(
      // The real theme is load-bearing: it forces an infinite minimum button
      // width, which crashes any button placed in an unbounded slot.
      theme: AppTheme.light,
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: const PaymentsScreen(),
    ),
  );
}

void main() {
  late MockSubscriptionService service;

  setUp(() {
    service = MockSubscriptionService();
  });

  testWidgets(
      'pending payment with no receipt exposes Upload + Cancel and a hint',
      (tester) async {
    when(() => service.getUserPayments()).thenAnswer(
      (_) async => [
        _payment(id: 'p1', status: 'pending'),
        _payment(id: 'p2', status: 'approved', receiptUrl: 'https://x/r.jpg'),
      ],
    );

    await tester.pumpWidget(_app(service));
    await tester.pumpAndSettle();

    // The receipt-less pending payment now shows recovery actions — this is
    // the fix for the "stuck payment" bug where no buttons rendered.
    expect(find.text('Upload receipt'), findsOneWidget);
    expect(find.text('Cancel & pick another plan'), findsOneWidget);
    // The hint must point at the bank details, not just say "upload".
    expect(find.text(_kPendingHint), findsOneWidget);
    // The approved payment is terminal — it must not show any actions.
    expect(find.text('Replace receipt'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'pending payment with a receipt exposes Replace + Cancel and a review note',
      (tester) async {
    when(() => service.getUserPayments()).thenAnswer(
      (_) async => [
        _payment(id: 'p3', status: 'pending', receiptUrl: 'https://x/r.jpg'),
      ],
    );

    await tester.pumpWidget(_app(service));
    await tester.pumpAndSettle();

    expect(find.text('Replace receipt'), findsOneWidget);
    expect(find.text('Cancel & pick another plan'), findsOneWidget);
    expect(find.textContaining('awaiting admin review'), findsOneWidget);
    expect(find.text('Upload receipt'), findsNothing);
  });

  group('view payment instructions link', () {
    testWidgets('is offered for a pending payment with no receipt',
        (tester) async {
      when(() => service.getUserPayments()).thenAnswer(
        (_) async => [_payment(id: 'p1', status: 'pending')],
      );

      await tester.pumpWidget(_app(service));
      await tester.pumpAndSettle();

      expect(find.text(_kInstructionsLabel), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('is offered for a pending payment that already has a receipt',
        (tester) async {
      when(() => service.getUserPayments()).thenAnswer(
        (_) async => [
          _payment(id: 'p3', status: 'pending', receiptUrl: 'https://x/r.jpg'),
        ],
      );

      await tester.pumpWidget(_app(service));
      await tester.pumpAndSettle();

      expect(find.text(_kInstructionsLabel), findsOneWidget);
    });

    testWidgets('is offered for a rejected payment', (tester) async {
      when(() => service.getUserPayments()).thenAnswer(
        (_) async => [
          _payment(id: 'p4', status: 'rejected', receiptUrl: 'https://x/r.jpg'),
        ],
      );

      await tester.pumpWidget(_app(service));
      await tester.pumpAndSettle();

      expect(find.text(_kInstructionsLabel), findsOneWidget);
      expect(find.text('Upload new receipt'), findsOneWidget);
    });

    testWidgets('is absent for terminal payments (approved / cancelled)',
        (tester) async {
      when(() => service.getUserPayments()).thenAnswer(
        (_) async => [
          _payment(id: 'p5', status: 'approved', receiptUrl: 'https://x/r.jpg'),
          _payment(id: 'p6', status: 'cancelled'),
        ],
      );

      await tester.pumpWidget(_app(service));
      await tester.pumpAndSettle();

      expect(find.text(_kInstructionsLabel), findsNothing);
      expect(find.text('Cancel & pick another plan'), findsNothing);
      expect(find.text(_kPendingHint), findsNothing);
    });
  });
}
