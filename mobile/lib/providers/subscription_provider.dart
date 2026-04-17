import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/bank_info.dart';
import '../models/payment_record.dart';
import '../models/plan.dart';
import '../models/subscription.dart';
import '../services/subscription_service.dart';

class SubscriptionState {
  final Subscription? subscription;
  final Subscription? pendingChange;
  final List<Plan> plans;
  final List<PaymentRecord> payments;
  final bool isLoading;
  final bool isLoadingPayments;
  final String? error;
  final SubscriptionRequestResult? lastRequest;
  final BankInfo? bankInfo;

  const SubscriptionState({
    this.subscription,
    this.pendingChange,
    this.plans = const [],
    this.payments = const [],
    this.isLoading = false,
    this.isLoadingPayments = false,
    this.error,
    this.lastRequest,
    this.bankInfo,
  });

  SubscriptionState copyWith({
    Subscription? subscription,
    Subscription? pendingChange,
    List<Plan>? plans,
    List<PaymentRecord>? payments,
    bool? isLoading,
    bool? isLoadingPayments,
    String? error,
    SubscriptionRequestResult? lastRequest,
    BankInfo? bankInfo,
    bool clearSubscription = false,
    bool clearPendingChange = false,
    bool clearError = false,
    bool clearLastRequest = false,
  }) {
    return SubscriptionState(
      subscription: clearSubscription ? null : (subscription ?? this.subscription),
      pendingChange: clearPendingChange ? null : (pendingChange ?? this.pendingChange),
      plans: plans ?? this.plans,
      payments: payments ?? this.payments,
      isLoading: isLoading ?? this.isLoading,
      isLoadingPayments: isLoadingPayments ?? this.isLoadingPayments,
      error: clearError ? null : (error ?? this.error),
      lastRequest: clearLastRequest ? null : (lastRequest ?? this.lastRequest),
      bankInfo: bankInfo ?? this.bankInfo,
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
    required File file,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.uploadReceipt(
        paymentId: paymentId,
        file: file,
      );
      state = state.copyWith(isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<void> loadPayments() async {
    state = state.copyWith(isLoadingPayments: true, clearError: true);
    try {
      final payments = await _service.getUserPayments();
      state = state.copyWith(payments: payments, isLoadingPayments: false);
    } catch (e) {
      state = state.copyWith(
        isLoadingPayments: false,
        error: _extractError(e),
      );
    }
  }

  /// Resubmit a new receipt against a rejected (or still pending) payment.
  /// On success, the backend resets the payment to 'pending' so it reappears
  /// in the admin queue.
  Future<bool> resubmitReceipt({
    required String paymentId,
    required File file,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.uploadReceipt(paymentId: paymentId, file: file);
      final payments = await _service.getUserPayments();
      final response = await _service.getSubscription();
      state = state.copyWith(
        payments: payments,
        subscription: response.subscription,
        pendingChange: response.pendingChange,
        clearSubscription: response.subscription == null,
        clearPendingChange: response.pendingChange == null,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  /// Cancel a rejected or pending payment. The paired pending subscription is
  /// also cancelled server-side, so the user can pick a fresh plan afterwards.
  Future<bool> cancelPayment(String paymentId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.cancelPayment(paymentId);
      final payments = await _service.getUserPayments();
      final response = await _service.getSubscription();
      state = state.copyWith(
        payments: payments,
        subscription: response.subscription,
        pendingChange: response.pendingChange,
        clearSubscription: response.subscription == null,
        clearPendingChange: response.pendingChange == null,
        clearLastRequest: true,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  /// Fetches bank transfer details from the backend. Errors are swallowed
  /// silently — the payment screen falls back to the "contact admin"
  /// placeholder when bank info cannot be loaded.
  Future<void> loadBankInfo() async {
    try {
      final info = await _service.getBankInfo();
      state = state.copyWith(bankInfo: info);
    } catch (_) {
      // Silent fallback — UI handles null/unconfigured state gracefully.
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
