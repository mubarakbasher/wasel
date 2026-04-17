import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/app_notification.dart';
import '../services/notifications_service.dart';

class NotificationsState {
  final List<AppNotification> items;
  final int unreadCount;
  final int page;
  final bool hasMore;
  final bool isLoading;
  final bool isLoadingMore;
  final String? error;

  const NotificationsState({
    this.items = const [],
    this.unreadCount = 0,
    this.page = 0,
    this.hasMore = true,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.error,
  });

  NotificationsState copyWith({
    List<AppNotification>? items,
    int? unreadCount,
    int? page,
    bool? hasMore,
    bool? isLoading,
    bool? isLoadingMore,
    String? error,
    bool clearError = false,
  }) {
    return NotificationsState(
      items: items ?? this.items,
      unreadCount: unreadCount ?? this.unreadCount,
      page: page ?? this.page,
      hasMore: hasMore ?? this.hasMore,
      isLoading: isLoading ?? this.isLoading,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      error: clearError ? null : (error ?? this.error),
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
      final page = await _service.list(page: 1, limit: _pageSize);
      state = state.copyWith(
        items: page.items,
        unreadCount: page.unreadCount,
        page: page.page,
        hasMore: page.hasMore,
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
      final next = await _service.list(page: state.page + 1, limit: _pageSize);
      state = state.copyWith(
        items: [...state.items, ...next.items],
        unreadCount: next.unreadCount,
        page: next.page,
        hasMore: next.hasMore,
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
    final removed = state.items.firstWhere((n) => n.id == id);
    final filtered = state.items.where((n) => n.id != id).toList();
    final newUnread =
        removed.isUnread ? (state.unreadCount - 1).clamp(0, state.unreadCount) : state.unreadCount;
    state = state.copyWith(items: filtered, unreadCount: newUnread);
    try {
      final serverUnread = await _service.delete(id);
      state = state.copyWith(unreadCount: serverUnread);
    } catch (e) {
      state = state.copyWith(error: _extractError(e));
    }
  }

  void reset() {
    state = const NotificationsState();
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> && data['error'] is Map<String, dynamic>) {
        final msg = (data['error'] as Map<String, dynamic>)['message'];
        if (msg is String) return msg;
      }
      return 'Network error';
    }
    return e.toString();
  }
}

final notificationsProvider =
    StateNotifierProvider<NotificationsNotifier, NotificationsState>(
  (ref) => NotificationsNotifier(),
);
