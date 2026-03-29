import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorageService {
  static const _accessTokenKey = 'wasel_access_token';
  static const _refreshTokenKey = 'wasel_refresh_token';
  static const _userDataKey = 'wasel_user_data';

  static final SecureStorageService _instance = SecureStorageService._internal();
  factory SecureStorageService() => _instance;

  SecureStorageService._internal();

  final FlutterSecureStorage _storage = const FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  // --- Access Token ---

  Future<String?> getAccessToken() => _storage.read(key: _accessTokenKey);

  Future<void> setAccessToken(String token) =>
      _storage.write(key: _accessTokenKey, value: token);

  Future<void> deleteAccessToken() => _storage.delete(key: _accessTokenKey);

  // --- Refresh Token ---

  Future<String?> getRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<void> setRefreshToken(String token) =>
      _storage.write(key: _refreshTokenKey, value: token);

  Future<void> deleteRefreshToken() => _storage.delete(key: _refreshTokenKey);

  // --- Token Pair ---

  Future<void> setTokens(String accessToken, String refreshToken) async {
    await Future.wait([
      _storage.write(key: _accessTokenKey, value: accessToken),
      _storage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<void> clearTokens() async {
    await Future.wait([
      _storage.delete(key: _accessTokenKey),
      _storage.delete(key: _refreshTokenKey),
    ]);
  }

  // --- User Data (JSON string) ---

  Future<void> setUserData(String jsonData) =>
      _storage.write(key: _userDataKey, value: jsonData);

  Future<String?> getUserData() => _storage.read(key: _userDataKey);

  Future<void> clearUserData() => _storage.delete(key: _userDataKey);

  // --- Clear Everything ---

  Future<void> clearAll() => _storage.deleteAll();

  // --- Helpers ---

  Future<bool> hasTokens() async {
    final accessToken = await getAccessToken();
    return accessToken != null;
  }
}
