import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/dashboard_service.dart';

class DashboardState {
  final Map<String, dynamic>? data;
  final bool isLoading;
  final String? error;

  const DashboardState({
    this.data,
    this.isLoading = false,
    this.error,
  });

  // Convenience getters
  List<dynamic> get routers => (data?['routers'] as List?) ?? [];
  Map<String, dynamic>? get subscription =>
      data?['subscription'] as Map<String, dynamic>?;
  int get vouchersUsedToday =>
      data?['vouchersUsedToday'] as int? ?? 0;
  double get dailyRevenue =>
      (data?['dailyRevenue'] as num?)?.toDouble() ?? 0.0;
  int get totalVouchers => data?['totalVouchers'] as int? ?? 0;
  int get onlineRouters => routers
      .where((r) => (r['status'] as String?) == 'online')
      .length;
  Map<String, dynamic> get dataUsage24h =>
      (data?['dataUsage24h'] as Map<String, dynamic>?) ??
          {'totalInput': 0, 'totalOutput': 0};
  List<dynamic> get activeSessionsByRouter =>
      (data?['activeSessionsByRouter'] as List?) ?? [];
  int get totalActiveSessions => activeSessionsByRouter.fold<int>(
      0, (sum, r) => sum + ((r['activeSessions'] as int?) ?? 0));

  DashboardState copyWith({
    Map<String, dynamic>? data,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return DashboardState(
      data: data ?? this.data,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class DashboardNotifier extends StateNotifier<DashboardState> {
  final DashboardService _service;

  DashboardNotifier({DashboardService? dashboardService})
      : _service = dashboardService ?? DashboardService(),
        super(const DashboardState());

  Future<void> loadDashboard() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final data = await _service.getDashboard();
      state = state.copyWith(data: data, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> && data.containsKey('error')) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
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

final dashboardProvider =
    StateNotifierProvider<DashboardNotifier, DashboardState>(
  (ref) => DashboardNotifier(),
);
