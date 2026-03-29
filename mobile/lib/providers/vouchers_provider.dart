import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/voucher.dart';
import '../services/voucher_service.dart';

class VouchersState {
  final List<Voucher> vouchers;
  final Voucher? selectedVoucher;
  final bool isLoading;
  final String? error;
  final int total;
  final int page;
  final int limit;
  final String? filterStatus;
  final String? filterProfileId;
  final String? searchQuery;

  const VouchersState({
    this.vouchers = const [],
    this.selectedVoucher,
    this.isLoading = false,
    this.error,
    this.total = 0,
    this.page = 1,
    this.limit = 20,
    this.filterStatus,
    this.filterProfileId,
    this.searchQuery,
  });

  bool get hasMore => vouchers.length < total;

  VouchersState copyWith({
    List<Voucher>? vouchers,
    Voucher? selectedVoucher,
    bool? isLoading,
    String? error,
    int? total,
    int? page,
    int? limit,
    String? filterStatus,
    String? filterProfileId,
    String? searchQuery,
    bool clearError = false,
    bool clearSelected = false,
    bool clearFilterStatus = false,
    bool clearFilterProfileId = false,
    bool clearSearch = false,
  }) {
    return VouchersState(
      vouchers: vouchers ?? this.vouchers,
      selectedVoucher:
          clearSelected ? null : (selectedVoucher ?? this.selectedVoucher),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      total: total ?? this.total,
      page: page ?? this.page,
      limit: limit ?? this.limit,
      filterStatus:
          clearFilterStatus ? null : (filterStatus ?? this.filterStatus),
      filterProfileId:
          clearFilterProfileId ? null : (filterProfileId ?? this.filterProfileId),
      searchQuery:
          clearSearch ? null : (searchQuery ?? this.searchQuery),
    );
  }
}

class VouchersNotifier extends StateNotifier<VouchersState> {
  final VoucherService _service;

  VouchersNotifier({VoucherService? voucherService})
      : _service = voucherService ?? VoucherService(),
        super(const VouchersState());

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void setFilter({String? status, String? profileId}) {
    state = state.copyWith(
      filterStatus: status,
      filterProfileId: profileId,
      clearFilterStatus: status == null,
      clearFilterProfileId: profileId == null,
    );
  }

  void setSearch(String? query) {
    state = state.copyWith(
      searchQuery: query,
      clearSearch: query == null || query.isEmpty,
    );
  }

  Future<void> loadVouchers(String routerId, {bool refresh = false}) async {
    if (refresh) {
      state = state.copyWith(page: 1, vouchers: [], total: 0);
    }
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.getVouchers(
        routerId,
        status: state.filterStatus,
        profileId: state.filterProfileId,
        search: state.searchQuery,
        page: refresh ? 1 : state.page,
        limit: state.limit,
      );
      state = state.copyWith(
        vouchers: result.vouchers,
        total: result.total,
        page: result.page,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadVoucher(String routerId, String voucherId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final voucher = await _service.getVoucher(routerId, voucherId);
      state = state.copyWith(selectedVoucher: voucher, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> createVoucher({
    required String routerId,
    required String profileId,
    String? username,
    String? password,
    String? comment,
    String? expiration,
    int? simultaneousUse,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final voucher = await _service.createVoucher(
        routerId: routerId,
        profileId: profileId,
        username: username,
        password: password,
        comment: comment,
        expiration: expiration,
        simultaneousUse: simultaneousUse,
      );
      state = state.copyWith(
        vouchers: [voucher, ...state.vouchers],
        total: state.total + 1,
        selectedVoucher: voucher,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> createVouchersBulk({
    required String routerId,
    required String profileId,
    required int count,
    String? usernamePrefix,
    int? usernameLength,
    int? passwordLength,
    String? comment,
    String? expiration,
    int? simultaneousUse,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final vouchers = await _service.createVouchersBulk(
        routerId: routerId,
        profileId: profileId,
        count: count,
        usernamePrefix: usernamePrefix,
        usernameLength: usernameLength,
        passwordLength: passwordLength,
        comment: comment,
        expiration: expiration,
        simultaneousUse: simultaneousUse,
      );
      state = state.copyWith(
        vouchers: [...vouchers, ...state.vouchers],
        total: state.total + vouchers.length,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> toggleVoucherStatus(String routerId, Voucher voucher) async {
    final newStatus = voucher.isActive ? 'disabled' : 'active';
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final updated = await _service.updateVoucher(
        routerId,
        voucher.id,
        status: newStatus,
      );
      final updatedList = state.vouchers.map((v) {
        return v.id == voucher.id ? updated : v;
      }).toList();
      state = state.copyWith(
        vouchers: updatedList,
        selectedVoucher:
            state.selectedVoucher?.id == voucher.id ? updated : null,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> deleteVoucher(String routerId, String voucherId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.deleteVoucher(routerId, voucherId);
      final updatedList = state.vouchers.where((v) => v.id != voucherId).toList();
      state = state.copyWith(
        vouchers: updatedList,
        total: state.total - 1,
        isLoading: false,
        clearSelected: state.selectedVoucher?.id == voucherId,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  void clearSelection() {
    state = state.copyWith(clearSelected: true);
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

final vouchersProvider =
    StateNotifierProvider<VouchersNotifier, VouchersState>(
  (ref) => VouchersNotifier(),
);
