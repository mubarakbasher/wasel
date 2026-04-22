import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/router_health.dart';
import '../services/api_client.dart';
import '../services/router_service.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

enum PollPhase { polling, timedOut, done }

class ProvisionPollState {
  final RouterHealthReport? report;
  final PollPhase phase;
  final String? error;
  final bool isConfirmingInterface;

  const ProvisionPollState({
    this.report,
    this.phase = PollPhase.polling,
    this.error,
    this.isConfirmingInterface = false,
  });

  ProvisionPollState copyWith({
    RouterHealthReport? report,
    PollPhase? phase,
    String? error,
    bool clearError = false,
    bool? isConfirmingInterface,
  }) {
    return ProvisionPollState(
      report: report ?? this.report,
      phase: phase ?? this.phase,
      error: clearError ? null : (error ?? this.error),
      isConfirmingInterface:
          isConfirmingInterface ?? this.isConfirmingInterface,
    );
  }

  bool get isDone => phase == PollPhase.done;
  bool get isTimedOut => phase == PollPhase.timedOut;
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class ProvisionPollNotifier extends FamilyNotifier<ProvisionPollState, String> {
  static const _pollInterval = Duration(seconds: 3);
  static const _timeout = Duration(minutes: 10);

  Timer? _timer;
  DateTime? _startedAt;

  @override
  ProvisionPollState build(String arg) {
    // arg is the routerId
    ref.onDispose(_stopPolling);
    _startPolling();
    return const ProvisionPollState();
  }

  // ---------------------------------------------------------------------------
  // Public actions
  // ---------------------------------------------------------------------------

  Future<void> reprovision() async {
    state = state.copyWith(clearError: true);
    try {
      await RouterService().reprovisionRouter(arg);
      _startedAt = DateTime.now();
      if (_timer == null) _startPolling();
    } catch (e) {
      state = state.copyWith(error: _extractError(e));
    }
  }

  Future<void> confirmInterface(String interfaceName) async {
    state = state.copyWith(isConfirmingInterface: true, clearError: true);
    try {
      await RouterService().confirmHotspotInterface(arg, interfaceName);
    } catch (e) {
      state = state.copyWith(
        isConfirmingInterface: false,
        error: _extractError(e),
      );
      return;
    }
    state = state.copyWith(isConfirmingInterface: false);
    // Next poll tick will update the report; no need to force-fetch here.
  }

  // ---------------------------------------------------------------------------
  // Internal polling machinery
  // ---------------------------------------------------------------------------

  void _startPolling() {
    _startedAt ??= DateTime.now();
    _timer?.cancel();
    _timer = Timer.periodic(_pollInterval, (_) => _tick());
    // Fire immediately without waiting for the first interval.
    _tick();
  }

  void _stopPolling() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    // Timeout guard.
    if (_startedAt != null &&
        DateTime.now().difference(_startedAt!) >= _timeout) {
      _stopPolling();
      state = state.copyWith(phase: PollPhase.timedOut);
      return;
    }

    RouterHealthReport report;
    try {
      report = await _fetchHealth();
    } catch (e) {
      // Non-fatal — keep polling, surface error so the UI can show it.
      state = state.copyWith(error: _extractError(e));
      return;
    }

    final done = report.provisionStatus == ProvisionStatus.succeeded &&
        report.overall == OverallHealth.healthy;

    state = state.copyWith(
      report: report,
      phase: done ? PollPhase.done : PollPhase.polling,
      clearError: true,
    );

    if (done) _stopPolling();
  }

  Future<RouterHealthReport> _fetchHealth() async {
    final response = await ApiClient().get<Map<String, dynamic>>(
      '/routers/$arg/health',
    );
    final data = response.data;
    if (data == null) throw Exception('Empty health response');
    final payload = data['data'];
    if (payload is! Map<String, dynamic>) {
      throw Exception('Malformed health response: missing data field');
    }
    return RouterHealthReport.fromJson(payload);
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic>) {
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        if (data.containsKey('message')) {
          return data['message'] as String;
        }
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out.';
      }
      if (e.type == DioExceptionType.connectionError) {
        return 'No internet connection.';
      }
    }
    return e.toString();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final provisionPollProvider = NotifierProvider.family<ProvisionPollNotifier,
    ProvisionPollState, String>(
  ProvisionPollNotifier.new,
);
