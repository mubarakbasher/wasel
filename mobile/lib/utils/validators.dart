/// Form validator helpers that return i18n KEYS (not display strings).
///
/// Every method returns `null` on success or a dot-notation key such as
/// `'validation.required'` on failure.  Call sites are expected to resolve
/// the key via `context.tr(key)` before passing it to a [FormField]
/// `validator:` callback, e.g.:
///
/// ```dart
/// validator: (v) {
///   final key = Validators.validateEmail(v);
///   return key != null ? context.tr(key) : null;
/// },
/// ```
class Validators {
  Validators._();

  /// Name: 2-100 characters, not blank.
  static String? validateName(String? value) {
    if (value == null || value.trim().isEmpty) return 'validation.required';
    final trimmed = value.trim();
    if (trimmed.length < 2) return 'validation.nameMinLength';
    if (trimmed.length > 100) return 'validation.nameMaxLength';
    return null;
  }

  /// Email: RFC 5322 basic pattern.
  static String? validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) return 'validation.required';
    final pattern = RegExp(
      r'^[a-zA-Z0-9.!#$%&*+/=?^_`{|}~-]+@[a-zA-Z0-9]'
      r'(?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?'
      r'(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$',
    );
    if (!pattern.hasMatch(value.trim())) return 'validation.invalidEmail';
    return null;
  }

  /// Phone: E.164 format (+1234567890, 7-15 digits after +).
  static String? validatePhone(String? value) {
    if (value == null || value.trim().isEmpty) return 'validation.required';
    final pattern = RegExp(r'^\+[1-9]\d{6,14}$');
    if (!pattern.hasMatch(value.trim())) return 'validation.invalidPhone';
    return null;
  }

  /// Password: min 8 chars, at least 1 uppercase letter, at least 1 digit.
  static String? validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'validation.required';
    if (value.length < 8) return 'auth.passwordMinLength';
    if (!RegExp(r'[A-Z]').hasMatch(value)) return 'validation.passwordUppercase';
    if (!RegExp(r'[0-9]').hasMatch(value)) return 'validation.passwordDigit';
    return null;
  }

  /// Confirm password: must match the original password.
  static String? validateConfirmPassword(String? value, String password) {
    if (value == null || value.isEmpty) return 'validation.required';
    if (value != password) return 'auth.passwordsDoNotMatch';
    return null;
  }

  /// OTP: exactly 6 digits.
  static String? validateOtp(String? value) {
    if (value == null || value.trim().isEmpty) return 'validation.required';
    final pattern = RegExp(r'^\d{6}$');
    if (!pattern.hasMatch(value.trim())) return 'validation.invalidOtp';
    return null;
  }
}
