import '../models/user.dart';
import 'api_client.dart';

class AuthService {
  final ApiClient _api = ApiClient();

  /// POST /auth/register
  /// Body: { name, email, phone, password, businessName? }
  /// Returns: { message: "Verification email sent" }
  Future<void> register({
    required String name,
    required String email,
    required String phone,
    required String password,
    String? businessName,
  }) async {
    await _api.post('/auth/register', data: {
      'name': name,
      'email': email,
      'phone': phone,
      'password': password,
      if (businessName != null && businessName.isNotEmpty)
        'business_name': businessName,
    });
  }

  /// POST /auth/login
  /// Body: { email, password }
  /// Returns: { accessToken, refreshToken, user }
  Future<LoginResult> login({
    required String email,
    required String password,
  }) async {
    final response = await _api.post('/auth/login', data: {
      'email': email,
      'password': password,
    });
    final data = response.data['data'] as Map<String, dynamic>;
    return LoginResult(
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
      user: User.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  /// POST /auth/verify-email
  /// Body: { email, otp }
  Future<void> verifyEmail({
    required String email,
    required String otp,
  }) async {
    await _api.post('/auth/verify-email', data: {
      'email': email,
      'otp': otp,
    });
  }

  /// POST /auth/resend-verification
  /// Body: { email }
  Future<void> resendVerification({required String email}) async {
    await _api.post('/auth/resend-verification', data: {'email': email});
  }

  /// POST /auth/forgot-password
  /// Body: { email }
  Future<void> forgotPassword({required String email}) async {
    await _api.post('/auth/forgot-password', data: {'email': email});
  }

  /// POST /auth/reset-password
  /// Body: { email, otp, newPassword }
  Future<void> resetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    await _api.post('/auth/reset-password', data: {
      'email': email,
      'otp': otp,
      'new_password': newPassword,
    });
  }

  /// POST /auth/logout
  /// Best effort — caller should clear local state regardless of outcome.
  Future<void> logout() async {
    try {
      await _api.post('/auth/logout');
    } catch (_) {
      // Best effort — clear local state regardless
    }
  }

  /// GET /auth/me — get current user profile
  Future<User> getProfile() async {
    final response = await _api.get('/auth/me');
    return User.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  /// PUT /auth/profile
  /// Body: { name, phone?, business_name? }
  /// Returns updated User
  Future<User> updateProfile({
    required String name,
    String? phone,
    String? businessName,
  }) async {
    final response = await _api.put('/auth/profile', data: {
      'name': name,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (businessName != null && businessName.isNotEmpty)
        'business_name': businessName,
    });
    return User.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  /// POST /auth/change-password
  /// Body: { currentPassword, newPassword }
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    await _api.post('/auth/change-password', data: {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });
  }
}

class LoginResult {
  final String accessToken;
  final String refreshToken;
  final User user;

  const LoginResult({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
  });
}
