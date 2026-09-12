import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/voucher_batch.dart';
import '../services/voucher_service.dart';
import '../utils/error_messages.dart';

class VoucherBatchesState {
  final List<VoucherBatch> batches;
  final bool isLoading;
  final String? error;

  const VoucherBatchesState({
    this.batches = const [],
    this.isLoading = false,
    this.error,
  });

  VoucherBatchesState copyWith({
    List<VoucherBatch>? batches,
    bool? isLoading,
    String? error,
    bool clearError = false,
  }) {
    return VoucherBatchesState(
      batches: batches ?? this.batches,
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class VoucherBatchesNotifier extends StateNotifier<VoucherBatchesState> {
  final VoucherService _service;

  /// Monotonic request counter — drops stale responses when a newer load
  /// supersedes an in-flight one.
  int _requestSeq = 0;

  VoucherBatchesNotifier({VoucherService? voucherService})
      : _service = voucherService ?? VoucherService(),
        super(const VoucherBatchesState());

  void reset() {
    _requestSeq++;
    state = const VoucherBatchesState();
  }

  Future<void> load(String routerId) async {
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final batches = await _service.getVoucherBatches(routerId);
      if (seq != _requestSeq) return; // superseded by a newer load
      state = state.copyWith(batches: batches, isLoading: false);
    } catch (e) {
      if (seq != _requestSeq) return;
      state = state.copyWith(
        isLoading: false,
        error: errorToDisplay(e),
      );
    }
  }
}

final voucherBatchesProvider =
    StateNotifierProvider<VoucherBatchesNotifier, VoucherBatchesState>(
  (ref) => VoucherBatchesNotifier(),
);
