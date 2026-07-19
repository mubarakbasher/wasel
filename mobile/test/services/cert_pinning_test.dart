// test/services/cert_pinning_test.dart
//
// The fixture at test/fixtures/api_wa_sel_com_leaf.der is the PUBLIC leaf
// certificate served by api.wa-sel.com (no secret material). Because the VPS
// runs certbot with reuse_key, Let's Encrypt renewals (~90 days) keep the same
// public key, so this test remains valid across renewals without replacing the
// fixture.
//
// Update the fixture AND kPinPrimary together only on a deliberate key
// rotation. The kPinPrimary assertion below is the release-critical guard:
// pin drift vs the live certificate is caught here in CI rather than bricking
// users in production.

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/services/cert_pinning.dart';

void main() {
  // Load the real prod leaf DER once for all tests.
  late Uint8List leafDer;

  setUpAll(() {
    // `flutter test` sets cwd to the package root (the `mobile/` directory).
    final fixtureFile = File(
      '${Directory.current.path}/test/fixtures/api_wa_sel_com_leaf.der',
    );
    leafDer = fixtureFile.readAsBytesSync();
  });

  group('spkiSha256', () {
    test(
      'matches kPinPrimary for the live prod leaf certificate '
      '(release-critical: pin drift vs live cert fails CI here)',
      () {
        expect(spkiSha256(leafDer), equals(kPinPrimary));
      },
    );

    test('does NOT match kPinBackup (backup is a different reserve key)', () {
      expect(spkiSha256(leafDer), isNot(equals(kPinBackup)));
    });

    test('returns null for garbage bytes (fail-closed on parse failure)', () {
      final garbage = Uint8List.fromList([0x00, 0xFF, 0xAB, 0x12, 0x34]);
      expect(spkiSha256(garbage), isNull);
    });

    test('returns null for an empty byte array (fail-closed)', () {
      expect(spkiSha256(Uint8List(0)), isNull);
    });
  });
}
