import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/voucher.dart';
import '../services/voucher_service.dart';
import '../utils/error_messages.dart';

class VouchersState {
  final List<Voucher> vouchers;
  final Voucher? selectedVoucher;
  final bool isLoading;
  final String? error;
  final int total;
  final int page;
  final int limit;
  final String? filterStatus;
  final String? filterLimitType;
  final String? searchQuery;

  const VouchersState({
    this.vouchers = const [],
    this.selectedVoucher,
    this.isLoading = false,
    this.error,
    this.total = 0,
    this.page = 1,
    this.limit = 100,
    this.filterStatus,
    this.filterLimitType,
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
    String? filterLimitType,
    String? searchQuery,
    bool clearError = false,
    bool clearSelected = false,
    bool clearFilterStatus = false,
    bool clearFilterLimitType = false,
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
      filterLimitType:
          clearFilterLimitType ? null : (filterLimitType ?? this.filterLimitType),
      searchQuery:
          clearSearch ? null : (searchQuery ?? this.searchQuery),
    );
  }
}

class VouchersNotifier extends StateNotifier<VouchersState> {
  final VoucherService _service;

  /// Monotonic request counter. Every load captures the current value before
  /// awaiting and drops its result if a newer request has since started —
  /// prevents a slow response from overwriting a newer router/filter selection.
  int _requestSeq = 0;

  /// The router whose data currently populates [state]. When it changes we
  /// clear the list up front so router A's vouchers never flash under router B.
  String? _activeRouterId;

  VouchersNotifier({VoucherService? voucherService})
      : _service = voucherService ?? VoucherService(),
        super(const VouchersState());

  /// Resets to initial state and invalidates any in-flight request. Called on
  /// logout so the next account never sees the previous account's vouchers.
  void reset() {
    _requestSeq++;
    _activeRouterId = null;
    state = const VouchersState();
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  void setFilter({String? status, String? limitType}) {
    state = state.copyWith(
      filterStatus: status,
      filterLimitType: limitType,
      clearFilterStatus: status == null,
      clearFilterLimitType: limitType == null,
    );
  }

  void setSearch(String? query) {
    state = state.copyWith(
      searchQuery: query,
      clearSearch: query == null || query.isEmpty,
    );
  }

  Future<void> loadVouchers(String routerId, {bool refresh = false}) async {
    final seq = ++_requestSeq;
    // Clear only when switching routers — a same-router refresh keeps the
    // current list visible under the spinner instead of blanking the screen.
    if (_activeRouterId != routerId) {
      _activeRouterId = routerId;
      state = state.copyWith(vouchers: [], total: 0, page: 1);
    }
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.getVouchers(
        routerId,
        status: state.filterStatus,
        limitType: state.filterLimitType,
        search: state.searchQuery,
        page: refresh ? 1 : state.page,
        limit: state.limit,
      );
      if (seq != _requestSeq) return; // superseded by a newer request
      state = state.copyWith(
        vouchers: result.vouchers,
        total: result.total,
        page: result.page,
        isLoading: false,
      );
    } catch (e) {
      if (seq != _requestSeq) return;
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadMore(String routerId) async {
    if (!state.hasMore || state.isLoading) return;
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _service.getVouchers(
        routerId,
        status: state.filterStatus,
        limitType: state.filterLimitType,
        search: state.searchQuery,
        page: state.page + 1,
        limit: state.limit,
      );
      if (seq != _requestSeq) return; // superseded (router/filter changed)
      // Dedup by id: offset pages can shift when rows are inserted/deleted
      // between fetches, so a page can repeat rows already held.
      final existingIds = state.vouchers.map((v) => v.id).toSet();
      final fresh =
          result.vouchers.where((v) => !existingIds.contains(v.id)).toList();
      state = state.copyWith(
        vouchers: [...state.vouchers, ...fresh],
        total: result.total,
        page: state.page + 1,
        isLoading: false,
      );
    } catch (e) {
      if (seq != _requestSeq) return;
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

  Future<List<Voucher>?> createVouchers({
    required String routerId,
    required String limitType,
    required int limitValue,
    required String limitUnit,
    int? validitySeconds,
    required int count,
    required double price,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final vouchers = await _service.createVouchers(
        routerId: routerId,
        limitType: limitType,
        limitValue: limitValue,
        limitUnit: limitUnit,
        validitySeconds: validitySeconds,
        count: count,
        price: price,
      );
      state = state.copyWith(
        vouchers: [...vouchers, ...state.vouchers],
        total: state.total + vouchers.length,
        isLoading: false,
      );
      return vouchers;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return null;
    }
  }

  Future<bool> toggleVoucherStatus(String routerId, Voucher voucher) async {
    final newStatus = voucher.isDisabled ? 'active' : 'disabled';
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

  Future<int?> bulkDeleteVouchers(String routerId, List<String> ids) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final count = await _service.bulkDeleteVouchers(routerId, ids: ids);
      // Re-sync from the server instead of splicing locally: deleting rows
      // shifts every subsequent offset page, so a surgical edit would leave
      // hasMore/total drifting and silently skip vouchers on the next loadMore.
      await loadVouchers(routerId, refresh: true);
      return count;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return null;
    }
  }

  // Backend caps filter-mode bulk-delete at 500 rows/request
  // (voucher.service.ts bulkDeleteVouchers). Loop until a partial batch
  // signals we've drained all matching vouchers.
  static const int _bulkDeleteBatch = 500;

  Future<int?> deleteAllVouchers(String routerId) async {
    state = state.copyWith(isLoading: true, clearError: true);
    // Snapshot the active filters BEFORE the loop. Each batch is a separate
    // server call, and reading state.filter* on every iteration means a filter
    // change made mid-delete would retarget later batches at a different set of
    // vouchers than the operator confirmed.
    final status = state.filterStatus;
    final limitType = state.filterLimitType;
    final search = state.searchQuery;
    try {
      int total = 0;
      while (true) {
        final count = await _service.deleteAllVouchers(
          routerId,
          status: status,
          limitType: limitType,
          search: search,
        );
        total += count;
        if (count < _bulkDeleteBatch) break; // last (or empty) batch
      }
      await loadVouchers(routerId, refresh: true); // re-sync filtered view
      return total;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return null;
    }
  }

  void clearSelection() {
    state = state.copyWith(clearSelected: true);
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final vouchersProvider =
    StateNotifierProvider<VouchersNotifier, VouchersState>(
  (ref) => VouchersNotifier(),
);
