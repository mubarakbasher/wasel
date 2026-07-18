class AppConfig {
  static const String appName = 'Wasel';

  // Override for local dev with `flutter run --dart-define=API_BASE_URL=...`.
  // Release builds with no --dart-define resolve to the production URL.
  // Targets:
  //   Android emulator:   http://10.0.2.2:3000/api/v1
  //   iOS simulator:      http://localhost:3000/api/v1
  //   Physical phone LAN: http://<host-LAN-IP>:3000/api/v1
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.wa-sel.com/api/v1',
  );
  static const String devApiBaseUrl = 'http://10.0.2.2:3000/api/v1';

  // Sentry crash-reporting DSN. Empty (the default) disables Sentry entirely,
  // so dev/debug builds are unaffected. Release builds pass it explicitly:
  //   flutter build apk --dart-define=SENTRY_DSN=https://...@...sentry.io/...
  static const String sentryDsn = String.fromEnvironment(
    'SENTRY_DSN',
    defaultValue: '',
  );

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 15);

  // Minimum Android 8.0 (API 26), iOS 13.0
  static const int minAndroidSdk = 26;
  static const String minIosVersion = '13.0';
}
