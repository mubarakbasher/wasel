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

class MockSubscriptionService extends Mock implements SubscriptionService {}

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
    expect(
      find.text('Upload your receipt so the admin can verify your payment.'),
      findsOneWidget,
    );
    // The approved payment is terminal — it must not show any actions.
    expect(find.text('Replace receipt'), findsNothing);
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
}
