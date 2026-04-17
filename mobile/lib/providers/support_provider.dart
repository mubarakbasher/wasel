import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/support_message.dart';
import '../services/support_service.dart';

class SupportState {
  final List<SupportMessage> messages;
  final int unreadAdminCount;
  final int page;
  final bool hasMore;
  final bool isLoading;
  final bool isLoadingMore;
  final bool isSending;
  final String? error;

  const SupportState({
    this.messages = const [],
    this.unreadAdminCount = 0,
    this.page = 0,
    this.hasMore = true,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.isSending = false,
    this.error,
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
    bool clearError = false,
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
      final page = await _service.list(page: 1, limit: _pageSize);
      state = state.copyWith(
        messages: page.items,
        unreadAdminCount: page.unreadAdminCount,
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
        messages: [...state.messages, ...next.items],
        page: next.page,
        hasMore: next.hasMore,
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

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic> &&
          data['error'] is Map<String, dynamic>) {
        final msg = (data['error'] as Map<String, dynamic>)['message'];
        if (msg is String) return msg;
      }
      return 'Network error';
    }
    return e.toString();
  }
}

final supportProvider =
    StateNotifierProvider<SupportNotifier, SupportState>(
  (ref) => SupportNotifier(),
);
