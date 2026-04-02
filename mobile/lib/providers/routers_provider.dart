import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/router_model.dart';
import '../services/router_service.dart';

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

  RoutersNotifier({RouterService? routerService})
      : _service = routerService ?? RouterService(),
        super(const RoutersState());

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
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final router = await _service.getRouter(id);
      state = state.copyWith(selectedRouter: router, isLoading: false);
    } catch (e) {
      state = state.copyWith(isLoading: false, error: _extractError(e));
    }
  }

  Future<bool> createRouter({
    required String name,
    String? model,
    String? rosVersion,
    String? apiUser,
    String? apiPass,
  }) async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final router = await _service.createRouter(
        name: name,
        model: model,
        rosVersion: rosVersion,
        apiUser: apiUser,
        apiPass: apiPass,
      );
      state = state.copyWith(
        routers: [router, ...state.routers],
        selectedRouter: router,
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

  void clearSelection() {
    state = state.copyWith(
      clearSelectedRouter: true,
      clearStatus: true,
      clearGuide: true,
    );
  }

  String _extractError(dynamic e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map<String, dynamic>) {
        // Backend format: { "error": { "message": "..." } }
        final error = data['error'];
        if (error is Map<String, dynamic> && error.containsKey('message')) {
          return error['message'] as String;
        }
        // Fallback flat format: { "message": "..." }
        if (data.containsKey('message')) {
          return data['message'] as String;
        }
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.receiveTimeout) {
        return 'Connection timed out. Please try again.';
      }
      if (e.type == DioExceptionType.connectionError) {
        return 'No internet connection.';
      }
    }
    return e.toString();
  }
}

final routersProvider =
    StateNotifierProvider<RoutersNotifier, RoutersState>(
  (ref) => RoutersNotifier(),
);
