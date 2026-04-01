import '../models/plan.dart';
import '../models/subscription.dart';
import 'api_client.dart';

class SubscriptionService {
  final ApiClient _api = ApiClient();

  /// GET /subscription/plans
  /// Returns list of available plans.
  Future<List<Plan>> getPlans() async {
    final response = await _api.get('/subscription/plans');
    final data = response.data['data'] as List<dynamic>;
    return data
        .map((e) => Plan.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /subscription/
  /// Returns current subscription and optional pending change.
  Future<SubscriptionResponse> getSubscription() async {
    final response = await _api.get('/subscription');
    final data = response.data['data'];
    final pendingChangeData = response.data['pendingChange'];

    return SubscriptionResponse(
      subscription: data != null
          ? Subscription.fromJson(data as Map<String, dynamic>)
          : null,
      pendingChange: pendingChangeData != null
          ? Subscription.fromJson(pendingChangeData as Map<String, dynamic>)
          : null,
    );
  }

  /// POST /subscription/request
  /// Body: { planTier, durationMonths }
  /// Returns subscription + payment info.
  Future<SubscriptionRequestResult> requestSubscription({
    required String planTier,
    int durationMonths = 1,
  }) async {
    final response = await _api.post('/subscription/request', data: {
      'planTier': planTier,
      'durationMonths': durationMonths,
    });
    final data = response.data['data'] as Map<String, dynamic>;
    return SubscriptionRequestResult(
      subscription: Subscription.fromJson(
          data['subscription'] as Map<String, dynamic>),
      paymentId: data['payment']['id'] as String,
      amount: (data['payment']['amount'] as num).toDouble(),
      currency: data['payment']['currency'] as String,
      referenceCode: data['payment']['referenceCode'] as String,
    );
  }

  /// POST /subscription/change
  /// Body: { planTier, durationMonths }
  /// Returns subscription + payment info for plan change.
  Future<SubscriptionRequestResult> changeSubscription({
    required String planTier,
    int durationMonths = 1,
  }) async {
    final response = await _api.post('/subscription/change', data: {
      'planTier': planTier,
      'durationMonths': durationMonths,
    });
    final data = response.data['data'] as Map<String, dynamic>;
    return SubscriptionRequestResult(
      subscription: Subscription.fromJson(
          data['subscription'] as Map<String, dynamic>),
      paymentId: data['payment']['id'] as String,
      amount: (data['payment']['amount'] as num).toDouble(),
      currency: data['payment']['currency'] as String,
      referenceCode: data['payment']['referenceCode'] as String,
    );
  }

  /// POST /subscription/receipt
  /// Body: { paymentId, receiptUrl }
  Future<void> uploadReceipt({
    required String paymentId,
    required String receiptUrl,
  }) async {
    await _api.post('/subscription/receipt', data: {
      'paymentId': paymentId,
      'receiptUrl': receiptUrl,
    });
  }
}

class SubscriptionResponse {
  final Subscription? subscription;
  final Subscription? pendingChange;

  const SubscriptionResponse({
    this.subscription,
    this.pendingChange,
  });
}

class SubscriptionRequestResult {
  final Subscription subscription;
  final String paymentId;
  final double amount;
  final String currency;
  final String referenceCode;

  const SubscriptionRequestResult({
    required this.subscription,
    required this.paymentId,
    required this.amount,
    required this.currency,
    required this.referenceCode,
  });
}
