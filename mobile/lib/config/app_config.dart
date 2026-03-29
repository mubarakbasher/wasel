class AppConfig {
  static const String appName = 'Wasel';
  static const String apiBaseUrl = 'https://api.wa-sel.com/api/v1';
  static const String devApiBaseUrl = 'http://10.0.2.2:3000/api/v1';

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 15);

  // Minimum Android 8.0 (API 26), iOS 13.0
  static const int minAndroidSdk = 26;
  static const String minIosVersion = '13.0';
}
