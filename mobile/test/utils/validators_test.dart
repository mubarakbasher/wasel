import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/utils/validators.dart';

void main() {
  group('validateName', () {
    test('returns error for null', () {
      expect(Validators.validateName(null), isNotNull);
    });
    test('returns error for empty', () {
      expect(Validators.validateName(''), isNotNull);
    });
    test('returns error for too short', () {
      expect(Validators.validateName('A'), isNotNull);
    });
    test('returns null for valid name', () {
      expect(Validators.validateName('John'), isNull);
    });
    test('returns error for >100 chars', () {
      expect(Validators.validateName('A' * 101), isNotNull);
    });
  });

  group('validateEmail', () {
    test('returns error for null', () {
      expect(Validators.validateEmail(null), isNotNull);
    });
    test('returns error for empty', () {
      expect(Validators.validateEmail(''), isNotNull);
    });
    test('returns error for invalid format', () {
      expect(Validators.validateEmail('notanemail'), isNotNull);
    });
    test('returns null for valid email', () {
      expect(Validators.validateEmail('user@example.com'), isNull);
    });
  });

  group('validatePhone', () {
    test('returns error for null', () {
      expect(Validators.validatePhone(null), isNotNull);
    });
    test('returns error for missing +', () {
      expect(Validators.validatePhone('1234567890'), isNotNull);
    });
    test('returns null for valid E.164', () {
      expect(Validators.validatePhone('+1234567890'), isNull);
    });
    test('returns error for too short', () {
      expect(Validators.validatePhone('+12345'), isNotNull);
    });
  });

  group('validatePassword', () {
    test('returns error for null', () {
      expect(Validators.validatePassword(null), isNotNull);
    });
    test('returns error for <8 chars', () {
      expect(Validators.validatePassword('Abc1'), isNotNull);
    });
    test('returns error for no uppercase', () {
      expect(Validators.validatePassword('abcdefg1'), isNotNull);
    });
    test('returns error for no digit', () {
      expect(Validators.validatePassword('Abcdefgh'), isNotNull);
    });
    test('returns null for valid password', () {
      expect(Validators.validatePassword('Password1'), isNull);
    });
  });

  group('validateConfirmPassword', () {
    test('returns error for null', () {
      expect(Validators.validateConfirmPassword(null, 'pass'), isNotNull);
    });
    test('returns error for mismatch', () {
      expect(Validators.validateConfirmPassword('abc', 'def'), isNotNull);
    });
    test('returns null when matching', () {
      expect(Validators.validateConfirmPassword('Password1', 'Password1'), isNull);
    });
  });

  group('validateOtp', () {
    test('returns error for null', () {
      expect(Validators.validateOtp(null), isNotNull);
    });
    test('returns error for non-6-digit', () {
      expect(Validators.validateOtp('12345'), isNotNull);
      expect(Validators.validateOtp('abcdef'), isNotNull);
    });
    test('returns null for valid 6-digit OTP', () {
      expect(Validators.validateOtp('123456'), isNull);
    });
  });
}
