import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
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
      when(() => mockService.uploadReceipt(
            paymentId: 'pay-1',
            receiptUrl: 'https://example.com/receipt.jpg',
          )).thenAnswer((_) async {});

      final success = await notifier.uploadReceipt(
        paymentId: 'pay-1',
        receiptUrl: 'https://example.com/receipt.jpg',
      );

      expect(success, true);
      expect(notifier.state.isLoading, false);
      expect(notifier.state.error, isNull);
    });

    test('uploadReceipt returns false on failure', () async {
      when(() => mockService.uploadReceipt(
            paymentId: 'pay-1',
            receiptUrl: 'https://example.com/receipt.jpg',
          )).thenThrow(Exception('invalid'));

      final success = await notifier.uploadReceipt(
        paymentId: 'pay-1',
        receiptUrl: 'https://example.com/receipt.jpg',
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
  });
}
