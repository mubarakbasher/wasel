import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:wasel/models/bank_info.dart';
import 'package:wasel/models/payment_record.dart';
import 'package:wasel/models/plan.dart';
import 'package:wasel/models/subscription.dart';
import 'package:wasel/providers/subscription_provider.dart';
import 'package:wasel/services/subscription_service.dart';

class MockSubscriptionService extends Mock implements SubscriptionService {}

void main() {
  late MockSubscriptionService mockService;
  late SubscriptionNotifier notifier;

  final mockPlan = Plan.fromJson({
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

  final mockSubscription = Subscription.fromJson({
    'id': 's-1',
    'planTier': 'starter',
    'planName': 'Starter',
    'status': 'active',
    'voucherQuota': 500,
    'vouchersUsed': 10,
    'daysRemaining': 25,
    'maxRouters': 1,
    'startDate': '2026-03-01T00:00:00.000Z',
    'endDate': '2026-04-01T00:00:00.000Z',
  });

  final mockPayment = PaymentRecord.fromJson({
    'id': 'pay-1',
    'planTier': 'starter',
    'planName': 'Starter',
    'amount': 5,
    'currency': 'SDG',
    'referenceCode': 'WAS-ABC123',
    'receiptUrl': null,
    'status': 'pending',
    'rejectionReason': null,
    'reviewedAt': null,
    'createdAt': '2026-06-01T00:00:00.000Z',
  });

  setUpAll(() {
    registerFallbackValue(File(''));
  });

  setUp(() {
    mockService = MockSubscriptionService();
    notifier = SubscriptionNotifier(subscriptionService: mockService);
  });

  group('SubscriptionNotifier', () {
    test('initial state is correct', () {
      expect(notifier.state.subscription, isNull);
      expect(notifier.state.plans, isEmpty);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
      expect(notifier.state.lastRequest, isNull);
    });

    test('loadPlans sets plans on success', () async {
      when(() => mockService.getPlans())
          .thenAnswer((_) async => [mockPlan]);

      await notifier.loadPlans();

      expect(notifier.state.plans, hasLength(1));
      expect(notifier.state.plans[0].tier, 'starter');
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('loadPlans sets error on failure', () async {
      when(() => mockService.getPlans()).thenThrow(Exception('fail'));

      await notifier.loadPlans();

      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadSubscription sets subscription on success', () async {
      when(() => mockService.getSubscription())
          .thenAnswer((_) async => SubscriptionResponse(subscription: mockSubscription));

      await notifier.loadSubscription();

      expect(notifier.state.subscription, isNotNull);
      expect(notifier.state.subscription?.planTier, 'starter');
      expect(notifier.state.isLoading, false);
    });

    test('loadSubscription handles null (no subscription)', () async {
      when(() => mockService.getSubscription())
          .thenAnswer((_) async => const SubscriptionResponse());

      await notifier.loadSubscription();

      expect(notifier.state.subscription, isNull);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('requestSubscription sets subscription and lastRequest', () async {
      final result = SubscriptionRequestResult(
        subscription: mockSubscription,
        paymentId: 'pay-1',
        amount: 5.0,
        currency: 'SDG',
        referenceCode: 'WAS-ABC123',
      );
      when(() => mockService.requestSubscription(planTier: 'starter'))
          .thenAnswer((_) async => result);

      final success = await notifier.requestSubscription('starter');

      expect(success, true);
      expect(notifier.state.subscription, isNotNull);
      expect(notifier.state.lastRequest, isNotNull);
      expect(notifier.state.lastRequest?.referenceCode, 'WAS-ABC123');
    });

    test('requestSubscription returns false on failure', () async {
      when(() => mockService.requestSubscription(planTier: 'starter'))
          .thenThrow(Exception('conflict'));

      final success = await notifier.requestSubscription('starter');

      expect(success, false);
      expect(notifier.state.error, isNotNull);
    });

    test('uploadReceipt returns true on success', () async {
      final fakeFile = File('receipt.jpg');
      when(() => mockService.uploadReceipt(
            paymentId: 'pay-1',
            file: any(named: 'file'),
          )).thenAnswer((_) async {});

      final success = await notifier.uploadReceipt(
        paymentId: 'pay-1',
        file: fakeFile,
      );

      expect(success, true);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('uploadReceipt returns false on failure', () async {
      final fakeFile = File('receipt.jpg');
      when(() => mockService.uploadReceipt(
            paymentId: 'pay-1',
            file: any(named: 'file'),
          )).thenThrow(Exception('invalid'));

      final success = await notifier.uploadReceipt(
        paymentId: 'pay-1',
        file: fakeFile,
      );

      expect(success, false);
      expect(notifier.state.error, isNotNull);
    });

    test('clearSubscription resets state', () async {
      when(() => mockService.getSubscription())
          .thenAnswer((_) async => SubscriptionResponse(subscription: mockSubscription));
      await notifier.loadSubscription();

      notifier.clearSubscription();

      expect(notifier.state.subscription, isNull);
      expect(notifier.state.plans, isEmpty);
      expect(notifier.state.lastRequest, isNull);
    });

    // ── Recovery path: payments list, bank details, cancel ──────────────────

    test('loadPayments stores the returned records', () async {
      when(() => mockService.getUserPayments())
          .thenAnswer((_) async => [mockPayment]);

      await notifier.loadPayments();

      expect(notifier.state.payments, hasLength(1));
      expect(notifier.state.payments.first.referenceCode, 'WAS-ABC123');
      expect(notifier.state.isLoadingPayments, false);
      expect(notifier.state.error, isNull);
    });

    test('loadPayments sets error on failure', () async {
      when(() => mockService.getUserPayments()).thenThrow(Exception('boom'));

      await notifier.loadPayments();

      expect(notifier.state.payments, isEmpty);
      expect(notifier.state.isLoadingPayments, false);
      expect(notifier.state.error, isNotNull);
    });

    test('loadBankInfo stores the bank details', () async {
      when(() => mockService.getBankInfo()).thenAnswer(
        (_) async => const BankInfo(
          bankName: 'Bank of Khartoum',
          accountNumber: '1234567890',
          accountHolder: 'Wasel Ltd',
          instructions: 'Reference required',
        ),
      );

      await notifier.loadBankInfo();

      expect(notifier.state.bankInfo?.bankName, 'Bank of Khartoum');
      expect(notifier.state.bankInfo?.isConfigured, true);
      expect(notifier.state.error, isNull);
    });

    test('loadBankInfo swallows failures and leaves no error banner', () async {
      when(() => mockService.getBankInfo()).thenThrow(Exception('502'));

      await notifier.loadBankInfo();

      expect(notifier.state.bankInfo, isNull);
      expect(notifier.state.error, isNull,
          reason: 'the payment screen falls back to the contact-admin '
              'placeholder instead of showing an error');
    });

    test('cancelPayment refreshes payments + subscription and drops lastRequest',
        () async {
      // Seed a lastRequest the way requestSubscription would.
      when(() => mockService.requestSubscription(planTier: 'starter'))
          .thenAnswer((_) async => SubscriptionRequestResult(
                subscription: mockSubscription,
                paymentId: 'pay-1',
                amount: 5.0,
                currency: 'SDG',
                referenceCode: 'WAS-ABC123',
              ));
      await notifier.requestSubscription('starter');
      expect(notifier.state.lastRequest, isNotNull);

      when(() => mockService.cancelPayment('pay-1')).thenAnswer((_) async {});
      when(() => mockService.getUserPayments()).thenAnswer((_) async => []);
      when(() => mockService.getSubscription())
          .thenAnswer((_) async => const SubscriptionResponse());

      final ok = await notifier.cancelPayment('pay-1');

      expect(ok, true);
      expect(notifier.state.payments, isEmpty);
      expect(notifier.state.subscription, isNull);
      expect(notifier.state.lastRequest, isNull,
          reason: 'a cancelled payment must not keep steering the payment '
              'screen at a dead reference code');
      expect(notifier.state.isLoading, false);
    });

    test('cancelPayment returns false and surfaces an error on failure',
        () async {
      when(() => mockService.cancelPayment('pay-1'))
          .thenThrow(Exception('409'));

      final ok = await notifier.cancelPayment('pay-1');

      expect(ok, false);
      expect(notifier.state.error, isNotNull);
      expect(notifier.state.isLoading, false);
    });
  });
}
