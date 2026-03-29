import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/radius_profile.dart';

void main() {
  final validJson = {
    'id': 'p-1',
    'userId': 'u-1',
    'groupName': 'basic-plan',
    'displayName': 'Basic Plan',
    'bandwidthUp': '2M',
    'bandwidthDown': '5M',
    'sessionTimeout': 3600,
    'totalTime': 7200,
    'totalData': 1073741824,
    'radiusAttributes': [
      {'type': 'reply', 'attribute': 'Mikrotik-Rate-Limit', 'op': ':=', 'value': '2M/5M'},
    ],
    'createdAt': '2026-01-01T00:00:00.000Z',
    'updatedAt': '2026-01-01T00:00:00.000Z',
  };

  group('RadiusProfile', () {
    test('fromJson creates correct object', () {
      final profile = RadiusProfile.fromJson(validJson);
      expect(profile.id, 'p-1');
      expect(profile.groupName, 'basic-plan');
      expect(profile.displayName, 'Basic Plan');
      expect(profile.bandwidthUp, '2M');
      expect(profile.bandwidthDown, '5M');
      expect(profile.sessionTimeout, 3600);
      expect(profile.totalData, 1073741824);
      expect(profile.radiusAttributes, hasLength(1));
    });

    test('bandwidthDisplay formats correctly', () {
      final profile = RadiusProfile.fromJson(validJson);
      expect(profile.bandwidthDisplay, '2M Up / 5M Down');
    });

    test('bandwidthDisplay returns Unlimited when null', () {
      final profile = RadiusProfile.fromJson({
        ...validJson,
        'bandwidthUp': null,
        'bandwidthDown': null,
      });
      expect(profile.bandwidthDisplay, 'Unlimited');
    });

    test('sessionTimeoutDisplay formats duration', () {
      expect(RadiusProfile.fromJson(validJson).sessionTimeoutDisplay, '1h');
    });

    test('sessionTimeoutDisplay returns Unlimited when null', () {
      final profile = RadiusProfile.fromJson({...validJson, 'sessionTimeout': null});
      expect(profile.sessionTimeoutDisplay, 'Unlimited');
    });

    test('totalDataDisplay formats bytes', () {
      expect(RadiusProfile.fromJson(validJson).totalDataDisplay, '1.0 GB');
    });

    test('totalDataDisplay returns Unlimited when null', () {
      final profile = RadiusProfile.fromJson({...validJson, 'totalData': null});
      expect(profile.totalDataDisplay, 'Unlimited');
    });

    test('totalTimeDisplay formats duration', () {
      expect(RadiusProfile.fromJson(validJson).totalTimeDisplay, '2h');
    });
  });

  group('RadiusAttribute', () {
    test('fromJson creates correct object', () {
      final attr = RadiusAttribute.fromJson({
        'type': 'check',
        'attribute': 'Max-All-Session',
        'op': ':=',
        'value': '3600',
      });
      expect(attr.type, 'check');
      expect(attr.attribute, 'Max-All-Session');
      expect(attr.value, '3600');
    });
  });
}
