import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/router_model.dart';
import '../services/router_service.dart';
import '../utils/error_messages.dart';

class RoutersState {
  final List<RouterModel> routers;
  final RouterModel? selectedRouter;
  final RouterStatusInfo? selectedRouterStatus;
  final RouterSetupGuide? setupGuide;
  final bool isLoading;
  final String? error;

  const RoutersState({
    this.routers = const [],
    this.selectedRouter,
    this.selectedRouterStatus,
    this.setupGuide,
    this.isLoading = false,
    this.error,
  });

  RoutersState copyWith({
    List<RouterModel>? routers,
    RouterModel? selectedRouter,
    RouterStatusInfo? selectedRouterStatus,
    RouterSetupGuide? setupGuide,
    bool? isLoading,
    String? error,
    bool clearError = false,
    bool clearSelectedRouter = false,
    bool clearStatus = false,
    bool clearGuide = false,
  }) {
    return RoutersState(
      routers: routers ?? this.routers,
      selectedRouter:
          clearSelectedRouter ? null : (selectedRouter ?? this.selectedRouter),
      selectedRouterStatus:
          clearStatus ? null : (selectedRouterStatus ?? this.selectedRouterStatus),
      setupGuide: clearGuide ? null : (setupGuide ?? this.setupGuide),
      isLoading: isLoading ?? this.isLoading,
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class RoutersNotifier extends StateNotifier<RoutersState> {
  final RouterService _service;

  /// Monotonic request counter — see VouchersNotifier. A slow loadRouter(A)
  /// must not overwrite a newer loadRouter(B).
  int _requestSeq = 0;

  /// Id of the router currently selected; when it changes we drop the previous
  /// router's detail/status/guide so the detail screen never shows stale data.
  String? _selectedId;

  RoutersNotifier({RouterService? routerService})
      : _service = routerService ?? RouterService(),
        super(const RoutersState());

  /// Resets to initial state and invalidates any in-flight request (logout).
  void reset() {
    _requestSeq++;
    _selectedId = null;
    state = const RoutersState();
  }

  void clearError() {
    state = state.copyWith(clearError: true);
  }

  Future<void> loadRouters() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final routers = await _service.getRouters();
      state = state.copyWith(routers: routers, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<void> loadRouter(String id) async {
    // Switching to a different router: drop the previous selection/status/guide
    // up front so the detail screen never shows the prior router's data.
    if (_selectedId != id) {
      _selectedId = id;
      state = state.copyWith(
        clearSelectedRouter: true,
        clearStatus: true,
        clearGuide: true,
      );
    }
    final seq = ++_requestSeq;
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final router = await _service.getRouter(id);
      if (seq != _requestSeq) return; // superseded by a newer selection
      state = state.copyWith(selectedRouter: router, isLoading: false);
    } catch (e) {
      if (seq != _requestSeq) return;
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> createRouter({required String name}) async {
    state = state.copyWith(isLoading: true, clearError: true, clearGuide: true);
    try {
      final result = await _service.createRouter(name: name);
      state = state.copyWith(
        routers: [result.router, ...state.routers],
        selectedRouter: result.router,
        setupGuide: result.setupGuide,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> updateRouter(
    String id, {
    String? name,
    String? model,
    String? rosVersion,
    String? apiUser,
    String? apiPass,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final updated = await _service.updateRouter(
        id,
        name: name,
        model: model,
        rosVersion: rosVersion,
        apiUser: apiUser,
        apiPass: apiPass,
      );
      final updatedList = state.routers.map((r) {
        return r.id == id ? updated : r;
      }).toList();
      state = state.copyWith(
        routers: updatedList,
        selectedRouter: updated,
        isLoading: false,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<bool> deleteRouter(String id) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      await _service.deleteRouter(id);
      final updatedList = state.routers.where((r) => r.id != id).toList();
      state = state.copyWith(
        routers: updatedList,
        isLoading: false,
        clearSelectedRouter: state.selectedRouter?.id == id,
        clearStatus: state.selectedRouter?.id == id,
        clearGuide: state.selectedRouter?.id == id,
      );
      return true;
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
      return false;
    }
  }

  Future<void> loadRouterStatus(String id) async {
    try {
      final status = await _service.getRouterStatus(id);
      // Drop if the user has since navigated to a different router.
      if (_selectedId != id) return;
      state = state.copyWith(selectedRouterStatus: status);
    } catch (e) {
      // Non-fatal — status is supplementary
    }
  }

  Future<void> loadSetupGuide(String id) async {
    state = state.copyWith(isLoading: true, clearError: true, clearGuide: true);
    try {
      final guide = await _service.getSetupGuide(id);
      state = state.copyWith(setupGuide: guide, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  /// Injects an already-fetched [router] into the list and selected slot
  /// without making a new network request. Used by the hotspot template
  /// picker after a successful PUT so the detail screen stays in sync.
  Future<void> refreshRouter(RouterModel router) async {
    final updatedList = state.routers.map((r) {
      return r.id == router.id ? router : r;
    }).toList();
    state = state.copyWith(
      routers: updatedList,
      selectedRouter: router,
    );
  }

  void clearSelection() {
    _selectedId = null;
    state = state.copyWith(
      clearSelectedRouter: true,
      clearStatus: true,
      clearGuide: true,
    );
  }

  String _extractError(dynamic e) => errorToDisplay(e);
}

final routersProvider =
    StateNotifierProvider<RoutersNotifier, RoutersState>(
  (ref) => RoutersNotifier(),
);
