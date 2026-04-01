import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/report_service.dart';

class ReportsState {
  final String reportType;
  final DateTime startDate;
  final DateTime endDate;
  final String? routerId;
  final Map<String, dynamic>? reportData;
  final bool isLoading;
  final String? error;
  final String? exportData;

  ReportsState({
    this.reportType = 'voucher-sales',
    DateTime? startDate,
    DateTime? endDate,
    this.routerId,
    this.reportData,
    this.isLoading = false,
    this.error,
    this.exportData,
  })  : startDate = startDate ?? DateTime.now().subtract(const Duration(days: 30)),
        endDate = endDate ?? DateTime.now();

  ReportsState copyWith({
    String? reportType,
    DateTime? startDate,
    DateTime? endDate,
    String? routerId,
    Map<String, dynamic>? reportData,
    bool? isLoading,
    String? error,
    String? exportData,
    bool clearError = false,
    bool clearRouterId = false,
    bool clearReportData = false,
    bool clearExportData = false,
  }) {
    return ReportsState(
      reportType: reportType ?? this.reportType,
      startDate: startDate ?? this.startDate,
      endDate: endDate ?? this.endDate,
      routerId: clearRouterId ? null : (routerId ?? this.routerId),
      reportData:
          clearReportData ? null : (reportData ?? this.reportData),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      exportData:
          clearExportData ? null : (exportData ?? this.exportData),
    );
  }
}

class ReportsNotifier extends StateNotifier<ReportsState> {
  final ReportService _service;

  ReportsNotifier({ReportService? reportService})
      : _service = reportService ?? ReportService(),
        super(ReportsState());

  void setReportType(String type) {
    state = state.copyWith(
      reportType: type,
      clearReportData: true,
      clearExportData: true,
      clearError: true,
    );
  }

  void setDateRange(DateTime start, DateTime end) {
    state = state.copyWith(
      startDate: start,
      endDate: end,
      clearReportData: true,
      clearExportData: true,
      clearError: true,
    );
  }

  void setRouterId(String? routerId) {
    if (routerId == null) {
      state = state.copyWith(
        clearRouterId: true,
        clearReportData: true,
        clearExportData: true,
        clearError: true,
      );
    } else {
      state = state.copyWith(
        routerId: routerId,
        clearReportData: true,
        clearExportData: true,
        clearError: true,
      );
    }
  }

  Future<void> loadReport() async {
    state = state.copyWith(
      isLoading: true,
      clearError: true,
      clearExportData: true,
    );
    try {
      final data = await _service.getReport(
        type: state.reportType,
        startDate: state.startDate.toIso8601String().split('T').first,
        endDate: state.endDate.toIso8601String().split('T').first,
        routerId: state.routerId,
      );
      state = state.copyWith(reportData: data, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> exportReport({String format = 'csv'}) async {
    state = state.copyWith(
      isLoading: true,
      clearError: true,
      clearExportData: true,
    );
    try {
      final data = await _service.exportReport(
        type: state.reportType,
        startDate: state.startDate.toIso8601String().split('T').first,
        endDate: state.endDate.toIso8601String().split('T').first,
        routerId: state.routerId,
        format: format,
      );
      state = state.copyWith(exportData: data, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  void clear() {
    state = ReportsState();
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

final reportsProvider =
    StateNotifierProvider<ReportsNotifier, ReportsState>(
  (ref) => ReportsNotifier(),
);
