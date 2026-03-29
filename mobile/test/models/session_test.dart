import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/models/session.dart';

void main() {
  group('ActiveSession', () {
    test('fromJson creates correct object', () {
      final json = {
        'id': '*1A',
        'username': 'voucher-user',
        'address': '192.168.1.100',
        'macAddress': 'AA:BB:CC:DD:EE:FF',
        'uptime': '01:30:00',
        'bytesIn': 10485760,
        'bytesOut': 52428800,
        'idleTime': '00:05:00',
        'loginBy': 'cookie',
      };
      final session = ActiveSession.fromJson(json);
      expect(session.id, '*1A');
      expect(session.username, 'voucher-user');
      expect(session.bytesIn, 10485760);
    });

    test('fromJson handles null/missing fields with defaults', () {
      final session = ActiveSession.fromJson({});
      expect(session.id, '');
      expect(session.username, '');
      expect(session.bytesIn, 0);
      expect(session.uptime, '0s');
    });

    test('bytesInDisplay formats correctly', () {
      final session = ActiveSession.fromJson({'bytesIn': 10485760});
      expect(session.bytesInDisplay, '10.0MB');
    });

    test('bytesOutDisplay formats bytes', () {
      expect(ActiveSession.fromJson({'bytesOut': 512}).bytesOutDisplay, '512B');
      expect(ActiveSession.fromJson({'bytesOut': 2048}).bytesOutDisplay, '2.0KB');
    });
  });

  group('SessionHistory', () {
    test('fromJson creates correct object', () {
      final json = {
        'id': 1,
        'sessionId': 'sess-1',
        'uniqueId': 'uniq-1',
        'username': 'user1',
        'nasIpAddress': '10.10.0.2',
        'startTime': '2026-03-01T10:00:00.000Z',
        'stopTime': '2026-03-01T11:00:00.000Z',
        'sessionTime': 3600,
        'inputOctets': 1048576,
        'outputOctets': 5242880,
        'calledStationId': 'AP1',
        'callingStationId': 'AA:BB:CC:DD:EE:FF',
        'terminateCause': 'User-Request',
        'framedIpAddress': '192.168.1.50',
      };
      final history = SessionHistory.fromJson(json);
      expect(history.id, 1);
      expect(history.username, 'user1');
      expect(history.sessionTime, 3600);
      expect(history.terminateCause, 'User-Request');
    });

    test('isActive returns true when stopTime is null', () {
      final history = SessionHistory.fromJson({
        'id': 1,
        'startTime': '2026-03-01T10:00:00.000Z',
      });
      expect(history.isActive, true);
    });

    test('sessionTimeDisplay formats durations', () {
      expect(SessionHistory.fromJson({'id': 1, 'sessionTime': 3600}).sessionTimeDisplay, '1h 0m 0s');
      expect(SessionHistory.fromJson({'id': 1, 'sessionTime': 90}).sessionTimeDisplay, '1m 30s');
      expect(SessionHistory.fromJson({'id': 1, 'sessionTime': 45}).sessionTimeDisplay, '45s');
      expect(SessionHistory.fromJson({'id': 1}).sessionTimeDisplay, '0s');
    });

    test('inputDisplay formats bytes', () {
      expect(SessionHistory.fromJson({'id': 1, 'inputOctets': 1048576}).inputDisplay, '1.0MB');
      expect(SessionHistory.fromJson({'id': 1}).inputDisplay, '0B');
    });
  });
}
