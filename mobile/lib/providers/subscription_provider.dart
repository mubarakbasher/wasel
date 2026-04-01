import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/plan.dart';
import '../models/subscription.dart';
import '../services/subscription_service.dart';

class SubscriptionState {
  final Subscription? subscription;
  final Subscription? pendingChange;
  final List<Plan> plans;
  final bool isLoading;
  final String? error;
  final SubscriptionRequestResult? lastRequest;

  const SubscriptionState({
    this.subscription,
    this.pendingChange,
    this.plans = const [],
    this.isLoading = false,
    this.error,
    this.lastRequest,
  });

  SubscriptionState copyWith({
    Subscription? subscription,
    Subscription? pendingChange,
    List<Plan>? plans,
    bool? isLoading,
    String? error,
    SubscriptionRequestResult? lastRequest,
    bool clearSubscription = false,
    bool clearPendingChange = false,
    bool clearError = false,
    bool clearLastRequest = false,
  }) {
    return SubscriptionState(
      subscription: clearSubscription ? null : (subscription ?? this.subscription),
      pendingChange: clearPendingChange ? null : (pendingChange ?? this.pendingChange),
      plans: plans ?? this.plans,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      lastRequest: clearLastRequest ? null : (lastRequest ?? this.lastRequest),
    );
  }
}

class SubscriptionNotifier extends StateNotifier<SubscriptionState> {
  final SubscriptionService _service;

  SubscriptionNotifier({SubscriptionService? subscriptionService})
      : _service = subscriptionService ?? SubscriptionService(),
        super(const SubscriptionState());

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  Future<void> loadPlans() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final plans = await _service.getPlans();
      state = state.copyWith(plans: plans, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadSubscription() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final response = await _service.getSubscription();
      state = state.copyWith(
        subscription: response.subscription,
        pendingChange: response.pendingChange,
        isLoading: false,
        clearSubscription: response.subscription == null,
        clearPendingChange: response.pendingChange == null,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> requestSubscription(String planTier, {int durationMonths = 1}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.requestSubscription(
        planTier: planTier,
        durationMonths: durationMonths,
      );
      state = state.copyWith(
        subscription: result.subscription,
        lastRequest: result,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> changeSubscription(String planTier, {int durationMonths = 1}) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.changeSubscription(
        planTier: planTier,
        durationMonths: durationMonths,
      );
      state = state.copyWith(
        pendingChange: result.subscription,
        lastRequest: result,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> uploadReceipt({
    required String paymentId,
    required String receiptUrl,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.uploadReceipt(
        paymentId: paymentId,
        receiptUrl: receiptUrl,
      );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  void clearSubscription() {
    state = const SubscriptionState();
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> && data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        if (error is String) return error;
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please try again.';
      }
      return 'Network error. Please check your connection.';
    }
    return e.toString();
  }
}

final subscriptionProvider =
    StateNotifierProvider<SubscriptionNotifier, SubscriptionState>(
  (ref) => SubscriptionNotifier(),
);
