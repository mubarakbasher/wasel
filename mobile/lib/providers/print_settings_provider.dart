import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/print_settings.dart';
import '../services/print_settings_service.dart';
import '../services/secure_storage.dart';
import '../services/thumbnail_renderer.dart';
import '../utils/error_messages.dart';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

class PrintSettingsState {
  final PrintSettings? settings;
  final bool isLoading;
  final String? error;

  /// True when the current [settings] came from the local cache (not yet
  /// confirmed by the network). The UI can render while a network refresh is
  /// in flight.
  final bool isFromCache;

  const PrintSettingsState({
    this.settings,
    this.isLoading = false,
    this.error,
    this.isFromCache = false,
  });

  bool get isEmpty => settings == null;

  PrintSettingsState copyWith({
    PrintSettings? settings,
    bool? isLoading,
    String? error,
    bool? isFromCache,
    bool clearError = false,
    bool clearSettings = false,
  }) {
    return PrintSettingsState(
      settings: clearSettings ? null : (settings ?? this.settings),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
      isFromCache: isFromCache ?? this.isFromCache,
    );
  }
}

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class PrintSettingsNotifier extends StateNotifier<PrintSettingsState> {
  final PrintSettingsService _service;
  final SecureStorageService _storage;

  PrintSettingsNotifier({
    PrintSettingsService? service,
    SecureStorageService? storage,
  })  : _service = service ?? PrintSettingsService(),
        _storage = storage ?? SecureStorageService(),
        super(const PrintSettingsState());

  // ---- load ----------------------------------------------------------------

  /// Load settings: publish the local cache immediately (offline-safe), then
  /// refresh from the network and update the cache. On network failure, keeps
  /// the cached value and sets an error only when there is no cached value.
  Future<void> load() async {
    if (state.isLoading) return;
    state = state.copyWith(isLoading: true, clearError: true);

    // 1. Read local cache and publish immediately.
    PrintSettings? cached;
    try {
      final raw = await _storage.getPrintSettingsJson();
      if (raw != null) {
        cached = PrintSettings.fromJson(
            jsonDecode(raw) as Map<String, dynamic>);
        state = state.copyWith(
          settings: cached,
          isFromCache: true,
          isLoading: true,
        );
      }
    } catch (_) {
      // Corrupt cache — ignore and fetch from network.
    }

    // 2. Fetch from network.
    try {
      final fresh = await _service.fetch();
      await _storage.setPrintSettingsJson(jsonEncode(fresh.toJson()));
      state = state.copyWith(
        settings: fresh,
        isFromCache: false,
        isLoading: false,
        clearError: true,
      );
    } catch (e) {
      if (cached != null) {
        // We have a usable cached value; surface a soft error but keep the UI
        // functional.
        state = state.copyWith(isLoading: false, isFromCache: true);
      } else {
        state = state.copyWith(
          isLoading: false,
          error: _extractError(e),
        );
      }
    }
  }

  // ---- save ----------------------------------------------------------------

  /// Optimistic update: apply [next] immediately, write to cache, then PUT to
  /// the server. On failure rolls back to the previous value and surfaces the
  /// error (mirrors notification_prefs_provider L48-63).
  Future<void> save(PrintSettings next) async {
    final previous = state.settings;
    // Optimistic apply.
    state = state.copyWith(
      settings: next,
      isFromCache: false,
      clearError: true,
    );
    try {
      await _storage.setPrintSettingsJson(jsonEncode(next.toJson()));
      final confirmed = await _service.update(next);
      await _storage.setPrintSettingsJson(jsonEncode(confirmed.toJson()));
      state = state.copyWith(settings: confirmed, isFromCache: false);
    } catch (e) {
      // Roll back.
      if (previous != null) {
        await _storage.setPrintSettingsJson(jsonEncode(previous.toJson()));
        state = state.copyWith(settings: previous, error: _extractError(e));
      } else {
        state = state.copyWith(error: _extractError(e));
      }
    }
  }

  void reset() {
    state = const PrintSettingsState();
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

final printSettingsProvider =
    StateNotifierProvider<PrintSettingsNotifier, PrintSettingsState>(
  (ref) => PrintSettingsNotifier(),
);

/// Injectable [ThumbnailRenderer] — override in tests with a fake.
final thumbnailRendererProvider = Provider<ThumbnailRenderer>(
  (ref) => DefaultThumbnailRenderer(),
);

// ---------------------------------------------------------------------------
// Template thumbnail provider
// ---------------------------------------------------------------------------

/// Key type for [templateThumbnailProvider].
typedef ThumbnailKey = ({
  VoucherTemplateId templateId,
  String routerName,
  String locale,
});

/// Serialises renders (one at a time) and caches per key.
final _renderLock = _AsyncLock();

/// FutureProvider.family that renders a single-card PNG thumbnail for a
/// template.  The result is cached by Riverpod (family key) for the lifetime
/// of the provider container.
final templateThumbnailProvider =
    FutureProvider.family<Uint8List, ThumbnailKey>(
  (ref, key) async {
    final renderer = ref.watch(thumbnailRendererProvider);

    // Always use default knobs so thumbnails show each template's DEFAULT look
    // and are NOT invalidated by knob edits in the settings screen.
    final sampleSettings = const PrintSettings().copyWith(templateId: key.templateId);

    return _renderLock.run(() => renderer.render(
          key.templateId,
          key.routerName,
          sampleSettings,
          kThumbnailSampleItems,
        ));
  },
);

// ---------------------------------------------------------------------------
// Simple async lock (serialises thumbnail renders)
// ---------------------------------------------------------------------------

class _AsyncLock {
  Future<void> _tail = Future.value();

  Future<T> run<T>(Future<T> Function() fn) {
    final next = _tail.then((_) => fn());
    // Reset tail on completion (success or error).
    _tail = next.then<void>((_) {}, onError: (_) {});
    return next;
  }
}
