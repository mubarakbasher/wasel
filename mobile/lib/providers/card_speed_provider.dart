import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/card_speed_setting.dart';
import '../services/card_speed_service.dart';
import '../utils/error_messages.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class CardSpeedState {
  final CardSpeedSetting? setting;
  final bool isLoading;

  /// True after a 404 — backend doesn't support the feature yet.
  final bool unavailable;

  /// Error from the last fetch (cleared by the next successful load).
  final String? error;

  /// Error from the last save (cleared only on the next successful save or
  /// on explicit dismissal — not cleared by load() so the operator can still
  /// see the banner after navigating away and back).
  final String? saveError;

  const CardSpeedState({
    this.setting,
    this.isLoading = false,
    this.unavailable = false,
    this.error,
    this.saveError,
  });

  CardSpeedState copyWith({
    CardSpeedSetting? setting,
    bool? isLoading,
    bool? unavailable,
    String? error,
    String? saveError,
    bool clearError = false,
    bool clearSaveError = false,
    bool clearSetting = false,
  }) {
    return CardSpeedState(
      setting: clearSetting ? null : (setting ?? this.setting),
      isLoading: isLoading ?? this.isLoading,
      unavailable: unavailable ?? this.unavailable,
      error: clearError ? null : (error ?? this.error),
      saveError: clearSaveError ? null : (saveError ?? this.saveError),
    );
  }
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class CardSpeedNotifier extends StateNotifier<CardSpeedState> {
  final CardSpeedService _service;

  CardSpeedNotifier({CardSpeedService? service})
      : _service = service ?? CardSpeedService(),
        super(const CardSpeedState());

  // Monotonically increasing edit counter — incremented on every save.
  // load() compares this before applying its result; a save always wins.
  int _editCounter = 0;

  // Generation counter — incremented by reset() so any in-flight load() or
  // save() that completes after a reset can detect it and discard their result.
  // Never zeroed, only incremented.
  int _generation = 0;

  // Single async queue for saves — serialises them so server receives them
  // in call order and roll-back uses the right confirmed value.
  Future<void> _saveTail = Future.value();

  // The last server-confirmed setting (may differ from state.setting during
  // an optimistic update or on a save failure rollback).
  CardSpeedSetting? _confirmed;

  // ---- load ----------------------------------------------------------------

  /// Fetches from the network; never throws.
  Future<void> load() async {
    state = state.copyWith(isLoading: true, clearError: true);
    // Take snapshots synchronously (before any await) so that saves started
    // *after* this point still increment the counter past counterAtStart and
    // therefore discard this fetch when they complete.
    final counterAtStart = _editCounter;
    final genAtStart = _generation;
    // Wait for any saves that were already in the queue when load() was called.
    // A save started before load() has already incremented the counter above,
    // so the fetch will not overwrite it. This await never throws.
    await _saveTail.then((_) {}, onError: (_) {});
    try {
      final fetched = await _service.fetch();
      // Discard if a save completed while we were waiting, or if reset() ran.
      if (_editCounter != counterAtStart || _generation != genAtStart) {
        state = state.copyWith(isLoading: false);
        return;
      }
      if (fetched == null) {
        state = CardSpeedState(unavailable: true, saveError: state.saveError);
      } else {
        _confirmed = fetched;
        state = CardSpeedState(setting: fetched, saveError: state.saveError);
      }
    } catch (e) {
      if (_editCounter != counterAtStart || _generation != genAtStart) {
        state = state.copyWith(isLoading: false);
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: errorToDisplay(e),
      );
    }
  }

  // ---- save ----------------------------------------------------------------

  /// Optimistic update: applies immediately, then PUTs to the server.
  /// On failure rolls back to the last server-confirmed value.
  /// Never throws.
  Future<void> save({required bool enabled, required String speed}) async {
    // Skip if the backend doesn't support the feature.
    if (state.unavailable) return;

    _editCounter++;
    final myCounter = _editCounter;
    final genAtSave = _generation;

    // Optimistic apply
    final optimistic = CardSpeedSetting(
      enabled: enabled,
      speed: speed,
      options: state.setting?.options ?? const [],
    );
    state = state.copyWith(
      setting: optimistic,
      clearError: true,
      clearSaveError: true,
      unavailable: false,
    );

    // Chain onto the save queue so server receives calls in order.
    _saveTail = _saveTail.then((_) async {
      // Discard if reset() ran after this save was queued.
      if (_generation != genAtSave) return;
      try {
        final confirmed = await _service.update(enabled: enabled, speed: speed);
        if (_generation != genAtSave) return;
        // Apply only if no newer save is queued.
        if (myCounter == _editCounter) {
          _confirmed = confirmed;
          state = state.copyWith(setting: confirmed, clearSaveError: true);
        } else {
          // A later save is queued; just update confirmed so the last save's
          // failure path can roll back to it if needed.
          _confirmed = confirmed;
        }
      } catch (e) {
        if (_generation != genAtSave) return;
        // Roll back to last confirmed only if no newer save is pending.
        if (myCounter == _editCounter) {
          state = state.copyWith(
            setting: _confirmed,
            clearSetting: _confirmed == null,
            saveError: errorToDisplay(e),
          );
        } else {
          // A newer save is in flight; leave its optimistic state intact and
          // only record the error (it may be overwritten when the newer save
          // settles).
          state = state.copyWith(saveError: errorToDisplay(e));
        }
      }
    });

    await _saveTail;
  }

  // ---- reset ---------------------------------------------------------------

  void reset() {
    _confirmed = null;
    _editCounter = 0;
    // Increment generation so any in-flight load/save discards its result.
    _generation++;
    _saveTail = Future.value();
    state = const CardSpeedState();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final cardSpeedProvider =
    StateNotifierProvider<CardSpeedNotifier, CardSpeedState>(
  (ref) => CardSpeedNotifier(),
);
