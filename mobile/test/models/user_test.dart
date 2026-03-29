import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/user.dart';

void main() {
  group('User', () {
    test('fromJson creates correct object', () {
      final json = {
        'id': 'user-1',
        'name': 'Test User',
        'email': 'test@example.com',
        'phone': '+1234567890',
        'business_name': 'Test Business',
        'is_verified': true,
      };
      final user = User.fromJson(json);
      expect(user.id, 'user-1');
      expect(user.name, 'Test User');
      expect(user.email, 'test@example.com');
      expect(user.phone, '+1234567890');
      expect(user.businessName, 'Test Business');
      expect(user.isVerified, true);
    });

    test('fromJson handles null optional fields', () {
      final json = {
        'id': 'user-1',
        'name': 'Test',
        'email': 'a@b.com',
      };
      final user = User.fromJson(json);
      expect(user.phone, isNull);
      expect(user.businessName, isNull);
      expect(user.isVerified, false);
    });

    test('toJson produces correct map', () {
      const user = User(
        id: 'user-1',
        name: 'Test',
        email: 'a@b.com',
        phone: '+1234567890',
        isVerified: true,
      );
      final json = user.toJson();
      expect(json['id'], 'user-1');
      expect(json['name'], 'Test');
      expect(json['email'], 'a@b.com');
      expect(json['phone'], '+1234567890');
      expect(json['is_verified'], true);
    });

    test('roundtrip fromJson/toJson preserves data', () {
      const user = User(
        id: 'u1',
        name: 'Test',
        email: 'a@b.com',
        phone: '+1234567890',
        businessName: 'Biz',
        isVerified: true,
      );
      final restored = User.fromJson(user.toJson());
      expect(restored.id, user.id);
      expect(restored.name, user.name);
      expect(restored.email, user.email);
      expect(restored.phone, user.phone);
      expect(restored.businessName, user.businessName);
      expect(restored.isVerified, user.isVerified);
    });
  });
}
