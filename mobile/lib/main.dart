import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'app.dart';
import 'config/app_config.dart';
import 'services/push_notification_service.dart';

Future<void> _start() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Render the first frame immediately — do NOT block startup on push setup,
  // which awaits the OS permission dialog (Android 13+/iOS) and a network
  // round-trip. Kick it off after the first frame instead.
  runApp(const ProviderScope(child: WaselApp()));
  WidgetsBinding.instance.addPostFrameCallback((_) {
    PushNotificationService().initialize();
  });
}

void main() async {
  // Crash reporting is a no-op unless a DSN is supplied at build time
  // (--dart-define=SENTRY_DSN=...), so debug/dev builds start unchanged.
  if (AppConfig.sentryDsn.isEmpty) {
    await _start();
    return;
  }

  await SentryFlutter.init(
    (options) {
      options.dsn = AppConfig.sentryDsn;
      options.environment = kReleaseMode ? 'production' : 'development';
      // Errors/crashes only — no performance tracing.
      options.tracesSampleRate = 0;
      // Never attach user IP or other PII automatically.
      options.sendDefaultPii = false;
    },
    // SentryFlutter.init installs FlutterError.onError + zone guards around
    // the app, so uncaught Dart and platform errors are captured.
    appRunner: _start,
  );
}
