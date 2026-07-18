import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session.dart';
import '../services/session_service.dart';
import '../utils/error_messages.dart';

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

  /// Opaque keyset cursor returned by the last successful history page load.
  /// `null` means either we haven't loaded yet or there are no more pages.
  final String? historyNextCursor;

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
    this.historyNextCursor,
  });

  /// Prefer the cursor signal from the server; fall back to offset maths so
  /// screens that relied on the old total-based guard keep compiling.
  bool get hasMoreHistory =>
      historyNextCursor != null || historySessions.length < historyTotal;

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
    String? historyNextCursor,
    bool clearError = false,
    bool clearFilterUsername = false,
    bool clearFilterTerminateCause = false,
    bool clearHistoryNextCursor = false,
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
      historyNextCursor: clearHistoryNextCursor
          ? null
          : (historyNextCursor ?? this.historyNextCursor),
    );
  }
}

class SessionsNotifier extends StateNotifier<SessionsState> {
  final SessionService _service;

  /// Monotonic request counter — see VouchersNotifier. Every load captures it
  /// before awaiting and drops its result if superseded by a newer request.
  int _requestSeq = 0;

  /// Router currently populating [state]; when it changes we drop the previous
  /// router's active-session list, history and filters so they never bleed.
  String? _activeRouterId;

  SessionsNotifier({SessionService? sessionService})
      : _service = sessionService ?? SessionService(),
        super(const SessionsState());

  /// Resets to initial state and invalidates any in-flight request (logout).
  void reset() {
    _requestSeq++;
    _activeRouterId = null;
    state = const SessionsState();
  }

  void _ensureRouter(String routerId) {
    if (_activeRouterId != routerId) {
      _activeRouterId = routerId;
      state = state.copyWith(
        activeSessions: [],
        historySessions: [],
        historyTotal: 0,
        historyPage: 1,
        clearHistoryNextCursor: true,
        clearFilterUsername: true,
        clearFilterTerminateCause: true,
      );
    }
  }

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
    _ensureRouter(routerId);
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final sessions = await _service.getActiveSessions(routerId);
      if (seq != _requestSeq) return; // superseded (router switch / newer poll)
      state = state.copyWith(activeSessions: sessions, isLoading: false);
    } catch (e) {
      if (seq != _requestSeq) return;
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
    _ensureRouter(routerId);
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Initial / refresh load always starts from the beginning — no cursor.
      final result = await _service.getSessionHistory(
        routerId,
        username: state.filterUsername,
        limit: state.historyLimit,
        terminateCause: state.filterTerminateCause,
      );
      if (seq != _requestSeq) return; // superseded by a newer request
      state = state.copyWith(
        historySessions: result.sessions,
        historyTotal: result.total,
        historyPage: result.page,
        historyNextCursor: result.nextCursor,
        clearHistoryNextCursor: result.nextCursor == null,
        isLoading: false,
      );
    } catch (e) {
      if (seq != _requestSeq) return;
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadMoreHistory(String routerId) async {
    if (!state.hasMoreHistory || state.isLoading) return;
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Pass the stored cursor; server returns the next cursor (or null = done).
      final result = await _service.getSessionHistory(
        routerId,
        username: state.filterUsername,
        cursor: state.historyNextCursor,
        limit: state.historyLimit,
        terminateCause: state.filterTerminateCause,
      );
      if (seq != _requestSeq) return; // superseded
      // Dedup by id: safety net in case the cursor window overlaps due to
      // concurrent inserts/deletes between fetches.
      final existingIds = state.historySessions.map((s) => s.id).toSet();
      final fresh =
          result.sessions.where((s) => !existingIds.contains(s.id)).toList();
      state = state.copyWith(
        historySessions: [...state.historySessions, ...fresh],
        historyTotal: result.total,
        historyPage: result.page,
        historyNextCursor: result.nextCursor,
        clearHistoryNextCursor: result.nextCursor == null,
        isLoading: false,
      );
    } catch (e) {
      if (seq != _requestSeq) return;
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final sessionsProvider =
    StateNotifierProvider<SessionsNotifier, SessionsState>(
  (ref) => SessionsNotifier(),
);
