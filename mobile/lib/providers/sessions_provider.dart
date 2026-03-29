import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session.dart';
import '../services/session_service.dart';

class SessionsState {
  final List<ActiveSession> activeSessions;
  final List<SessionHistory> historySessions;
  final bool isLoading;
  final String? error;
  final int historyTotal;
  final int historyPage;
  final int historyLimit;
  final String? filterUsername;
  final String? filterTerminateCause;

  const SessionsState({
    this.activeSessions = const [],
    this.historySessions = const [],
    this.isLoading = false,
    this.error,
    this.historyTotal = 0,
    this.historyPage = 1,
    this.historyLimit = 20,
    this.filterUsername,
    this.filterTerminateCause,
  });

  bool get hasMoreHistory => historySessions.length < historyTotal;

  SessionsState copyWith({
    List<ActiveSession>? activeSessions,
    List<SessionHistory>? historySessions,
    bool? isLoading,
    String? error,
    int? historyTotal,
    int? historyPage,
    int? historyLimit,
    String? filterUsername,
    String? filterTerminateCause,
    bool clearError = false,
    bool clearFilterUsername = false,
    bool clearFilterTerminateCause = false,
  }) {
    return SessionsState(
      activeSessions: activeSessions ?? this.activeSessions,
      historySessions: historySessions ?? this.historySessions,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      historyTotal: historyTotal ?? this.historyTotal,
      historyPage: historyPage ?? this.historyPage,
      historyLimit: historyLimit ?? this.historyLimit,
      filterUsername: clearFilterUsername
          ? null
          : (filterUsername ?? this.filterUsername),
      filterTerminateCause: clearFilterTerminateCause
          ? null
          : (filterTerminateCause ?? this.filterTerminateCause),
    );
  }
}

class SessionsNotifier extends StateNotifier<SessionsState> {
  final SessionService _service;

  SessionsNotifier({SessionService? sessionService})
      : _service = sessionService ?? SessionService(),
        super(const SessionsState());

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void setUsernameFilter(String? username) {
    state = state.copyWith(
      filterUsername: username,
      clearFilterUsername: username == null || username.isEmpty,
    );
  }

  void setTerminateCauseFilter(String? cause) {
    state = state.copyWith(
      filterTerminateCause: cause,
      clearFilterTerminateCause: cause == null,
    );
  }

  Future<void> loadActiveSessions(String routerId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final sessions = await _service.getActiveSessions(routerId);
      state = state.copyWith(activeSessions: sessions, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> disconnectSession(String routerId, String sessionId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.disconnectSession(routerId, sessionId);
      final updated =
          state.activeSessions.where((s) => s.id != sessionId).toList();
      state = state.copyWith(activeSessions: updated, isLoading: false);
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<void> loadSessionHistory(
    String routerId, {
    bool refresh = false,
  }) async {
    if (refresh) {
      state = state.copyWith(
        historyPage: 1,
        historySessions: [],
        historyTotal: 0,
      );
    }
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.getSessionHistory(
        routerId,
        username: state.filterUsername,
        page: refresh ? 1 : state.historyPage,
        limit: state.historyLimit,
        terminateCause: state.filterTerminateCause,
      );
      state = state.copyWith(
        historySessions: result.sessions,
        historyTotal: result.total,
        historyPage: result.page,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadMoreHistory(String routerId) async {
    if (!state.hasMoreHistory || state.isLoading) return;
    final nextPage = state.historyPage + 1;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.getSessionHistory(
        routerId,
        username: state.filterUsername,
        page: nextPage,
        limit: state.historyLimit,
        terminateCause: state.filterTerminateCause,
      );
      state = state.copyWith(
        historySessions: [...state.historySessions, ...result.sessions],
        historyTotal: result.total,
        historyPage: nextPage,
        isLoading: false,
      );
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

final sessionsProvider =
    StateNotifierProvider<SessionsNotifier, SessionsState>(
  (ref) => SessionsNotifier(),
);
