import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../navigation/app_router.dart' show appNavigatorKey;
import '../providers/notifications_provider.dart';
import 'api_client.dart';
import 'secure_storage.dart';

/// Top-level background handler. Flutter spawns a separate isolate for this,
/// so anything it touches must reinitialize Firebase. We only keep it alive
/// long enough for FCM to display the system notification — the inbox will
/// resync when the user next opens the app.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class PushNotificationService {
  static final PushNotificationService _instance =
      PushNotificationService._internal();
  factory PushNotificationService() => _instance;
  PushNotificationService._internal();

  final ApiClient _api = ApiClient();
  final SecureStorageService _storage = SecureStorageService();
  bool _initialized = false;
  ProviderContainer? _container;

  /// Called from app.dart once the ProviderScope is built so the service can
  /// refresh the notifications provider when a foreground push arrives.
  void attachRiverpod(ProviderContainer container) {
    _container = container;
  }

  Future<void> initialize() async {
    if (_initialized) return;
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);

      final token = await messaging.getToken();
      if (token != null) await _registerToken(token);
      messaging.onTokenRefresh.listen(
        _registerToken,
        onError: (Object e) {
          if (kDebugMode) debugPrint('onTokenRefresh error: $e');
        },
      );

      FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
      // Tap-through: notification opened while backgrounded, or the one that
      // cold-started the app.
      FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);
      final initial = await messaging.getInitialMessage();
      if (initial != null) _handleNotificationTap(initial);

      _initialized = true;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('PushNotificationService: Firebase init failed: $e');
      }
    }
  }

  /// Fetches the current FCM token and registers it with the backend,
  /// bypassing the cache short-circuit. Called after login / session restore
  /// because the pre-auth registration attempt (fired before a token was
  /// cached) would have 401'd.
  Future<void> registerCurrentToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null) return;
      // Drop the cached value so _registerToken doesn't short-circuit — the
      // cache may hold a token that was never successfully registered.
      await _storage.deleteFcmToken();
      await _registerToken(token);
    } catch (e) {
      if (kDebugMode) debugPrint('registerCurrentToken failed: $e');
    }
  }

  Future<void> _registerToken(String token) async {
    try {
      final cachedToken = await _storage.getFcmToken();
      if (cachedToken == token) return;
      final platform = Platform.isIOS ? 'ios' : 'android';
      await _api.dio.post('/notifications/device-token', data: {
        'token': token,
        'platform': platform,
      });
      await _storage.setFcmToken(token);
    } catch (e) {
      if (kDebugMode) debugPrint('Failed to register device token: $e');
    }
  }

  Future<void> unregisterCurrentToken() async {
    try {
      final token = await _storage.getFcmToken();
      if (token != null) {
        await _api.dio
            .delete('/notifications/device-token', data: {'token': token});
        await _storage.deleteFcmToken();
      }
    } catch (_) {}
  }

  void _handleForegroundMessage(RemoteMessage message) {
    if (kDebugMode) {
      debugPrint('Foreground message: ${message.notification?.title}');
    }
    // Pull fresh data into the inbox so the bell badge updates immediately.
    _container?.read(notificationsProvider.notifier).refresh();
  }

  /// Handles a tapped notification (backgrounded or cold-start). Routes to the
  /// inbox so the user always lands on the notification; best-effort so a bad
  /// route or a not-yet-ready navigator never crashes the app.
  void _handleNotificationTap(RemoteMessage message) {
    _container?.read(notificationsProvider.notifier).refresh();
    final ctx = appNavigatorKey.currentContext;
    if (ctx == null) return;
    try {
      GoRouter.of(ctx).push('/notifications');
    } catch (_) {
      // Navigation is best-effort — never crash on a notification tap.
    }
  }
}
