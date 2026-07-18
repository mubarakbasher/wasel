import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_notification.dart';
import '../services/notifications_service.dart';
import '../utils/error_messages.dart';

class NotificationsState {
  final List<AppNotification> items;
  final int unreadCount;
  final int page;
  final bool hasMore;
  final bool isLoading;
  final bool isLoadingMore;
  final String? error;

  /// Opaque keyset cursor returned by the last successful page load.
  /// `null` means either we haven't loaded yet or there are no more pages.
  final String? nextCursor;

  const NotificationsState({
    this.items = const [],
    this.unreadCount = 0,
    this.page = 0,
    this.hasMore = true,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.error,
    this.nextCursor,
  });

  NotificationsState copyWith({
    List<AppNotification>? items,
    int? unreadCount,
    int? page,
    bool? hasMore,
    bool? isLoading,
    bool? isLoadingMore,
    String? error,
    String? nextCursor,
    bool clearError = false,
    bool clearNextCursor = false,
  }) {
    return NotificationsState(
      items: items ?? this.items,
      unreadCount: unreadCount ?? this.unreadCount,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      error: clearError ? null : (error ?? this.error),
      nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
    );
  }
}

class NotificationsNotifier extends StateNotifier<NotificationsState> {
  final NotificationsService _service;
  static const _pageSize = 20;

  NotificationsNotifier({NotificationsService? service})
      : _service = service ?? NotificationsService(),
        super(const NotificationsState());

  Future<void> refresh() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      // Initial / refresh load always starts from the beginning — no cursor.
      final page = await _service.list(limit: _pageSize);
      state = state.copyWith(
        items: page.items,
        unreadCount: page.unreadCount,
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
      // concurrent inserts between fetches (duplicate Dismissible keys crash).
      final existingIds = state.items.map((n) => n.id).toSet();
      final fresh =
          next.items.where((n) => !existingIds.contains(n.id)).toList();
      state = state.copyWith(
        items: [...state.items, ...fresh],
        unreadCount: next.unreadCount,
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

  Future<void> markRead(String id) async {
    // Optimistic local update
    final updated = state.items
        .map((n) => n.id == id ? n.copyWith(readAt: DateTime.now()) : n)
        .toList();
    final newUnread = (state.unreadCount - 1).clamp(0, state.unreadCount);
    state = state.copyWith(items: updated, unreadCount: newUnread);
    try {
      final serverUnread = await _service.markRead(id);
      state = state.copyWith(unreadCount: serverUnread);
    } catch (e) {
      state = state.copyWith(error: _extractError(e));
    }
  }

  Future<void> markAllRead() async {
    final updated = state.items
        .map((n) => n.isUnread ? n.copyWith(readAt: DateTime.now()) : n)
        .toList();
    state = state.copyWith(items: updated, unreadCount: 0);
    try {
      await _service.markAllRead();
    } catch (e) {
      state = state.copyWith(error: _extractError(e));
    }
  }

  Future<void> delete(String id) async {
    final index = state.items.indexWhere((n) => n.id == id);
    if (index < 0) return; // already removed (double-tap / stale callback)
    final removed = state.items[index];
    // Capture pre-mutation state so a failed delete can be rolled back.
    final prevItems = state.items;
    final prevUnread = state.unreadCount;
    final filtered = state.items.where((n) => n.id != id).toList();
    final newUnread = removed.isUnread
        ? (state.unreadCount - 1).clamp(0, state.unreadCount)
        : state.unreadCount;
    state = state.copyWith(items: filtered, unreadCount: newUnread);
    try {
      final serverUnread = await _service.delete(id);
      state = state.copyWith(unreadCount: serverUnread);
    } catch (e) {
      // Restore the optimistically-removed item so the UI reflects reality.
      state = state.copyWith(
        items: prevItems,
        unreadCount: prevUnread,
        error: _extractError(e),
      );
    }
  }

  void reset() {
    state = const NotificationsState();
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final notificationsProvider =
    StateNotifierProvider<NotificationsNotifier, NotificationsState>(
  (ref) => NotificationsNotifier(),
);
