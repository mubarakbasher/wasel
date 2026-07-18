import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/support_message.dart';
import '../services/support_service.dart';
import '../utils/error_messages.dart';

class SupportState {
  final List<SupportMessage> messages;
  final int unreadAdminCount;
  final int page;
  final bool hasMore;
  final bool isLoading;
  final bool isLoadingMore;
  final bool isSending;
  final String? error;

  /// Opaque keyset cursor returned by the last successful page load.
  /// `null` means either we haven't loaded yet or there are no more pages.
  final String? nextCursor;

  const SupportState({
    this.messages = const [],
    this.unreadAdminCount = 0,
    this.page = 0,
    this.hasMore = true,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.isSending = false,
    this.error,
    this.nextCursor,
  });

  SupportState copyWith({
    List<SupportMessage>? messages,
    int? unreadAdminCount,
    int? page,
    bool? hasMore,
    bool? isLoading,
    bool? isLoadingMore,
    bool? isSending,
    String? error,
    String? nextCursor,
    bool clearError = false,
    bool clearNextCursor = false,
  }) {
    return SupportState(
      messages: messages ?? this.messages,
      unreadAdminCount: unreadAdminCount ?? this.unreadAdminCount,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      isSending: isSending ?? this.isSending,
      error: clearError ? null : (error ?? this.error),
      nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
    );
  }
}

class SupportNotifier extends StateNotifier<SupportState> {
  final SupportService _service;
  static const _pageSize = 30;

  SupportNotifier({SupportService? service})
      : _service = service ?? SupportService(),
        super(const SupportState());

  Future<void> refresh() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Initial / refresh load always starts from the beginning — no cursor.
      final page = await _service.list(limit: _pageSize);
      state = state.copyWith(
        messages: page.items,
        unreadAdminCount: page.unreadAdminCount,
        page: page.page,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        clearNextCursor: page.nextCursor == null,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadMore() async {
    if (!state.hasMore || state.isLoadingMore || state.isLoading) return;
    state = state.copyWith(isLoadingMore: true, clearError: true);
    try {
      // Pass the stored cursor; server returns the next cursor (or null = done).
      final next = await _service.list(
        cursor: state.nextCursor,
        limit: _pageSize,
      );
      // Dedup by id: safety net in case the cursor window overlaps due to
      // concurrent inserts between fetches.
      final existingIds = state.messages.map((m) => m.id).toSet();
      final fresh =
          next.items.where((m) => !existingIds.contains(m.id)).toList();
      state = state.copyWith(
        messages: [...state.messages, ...fresh],
        page: next.page,
        hasMore: next.hasMore,
        nextCursor: next.nextCursor,
        clearNextCursor: next.nextCursor == null,
        isLoadingMore: false,
      );
    } catch (e) {
      state = state.copyWith(isLoadingMore: false, error: _extractError(e));
    }
  }

  Future<bool> send(String body) async {
    final trimmed = body.trim();
    if (trimmed.isEmpty) return false;
    state = state.copyWith(isSending: true, clearError: true);
    try {
      final msg = await _service.send(trimmed);
      state = state.copyWith(
        messages: [msg, ...state.messages],
        isSending: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isSending: false, error: _extractError(e));
      return false;
    }
  }

  Future<void> markAllRead() async {
    if (state.unreadAdminCount == 0) return;
    try {
      await _service.markAllRead();
      state = state.copyWith(unreadAdminCount: 0);
    } catch (_) {
      // Silent — not critical; next refresh will reconcile.
    }
  }

  /// Wipe the cached support conversation. Called on logout so the next
  /// user's session doesn't see the previous user's messages.
  void reset() {
    state = const SupportState();
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final supportProvider =
    StateNotifierProvider<SupportNotifier, SupportState>(
  (ref) => SupportNotifier(),
);
