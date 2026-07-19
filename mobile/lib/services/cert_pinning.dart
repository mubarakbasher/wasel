import 'dart:convert';
import 'dart:typed_data';

import 'package:asn1lib/asn1lib.dart';
import 'package:crypto/crypto.dart' show sha256;

// ---------------------------------------------------------------------------
// Certificate pinning — SPKI SHA-256 leaf-key pins for api.wa-sel.com
//
// BOTH pins are leaf-key pins (the public key of the certificate served by
// the production API). An intermediate or root pin would be useless here:
// Dio's IOHttpClientAdapter.validateCertificate callback receives only the
// leaf certificate, so a non-leaf pin can never match.
//
// Primary: SPKI SHA-256 of the current live leaf key.
//   The VPS runs certbot with reuse_key, so Let's Encrypt renewals (~90 days)
//   keep the same key material — this pin survives renewals without an app
//   update.
//
// Backup: SPKI SHA-256 of an offline EC P-256 reserve key stored at
//   mobile/android/wasel-backup-tls.key (gitignored).
//   If the server TLS key is ever lost or compromised, a new certificate
//   issued from that reserve key keeps already-installed apps working.
//
// On deliberate key rotation (intentional re-key):
//   1. Update kPinPrimary to the new live leaf SPKI.
//   2. Replace the DER fixture at test/fixtures/api_wa_sel_com_leaf.der.
//   3. The cert_pinning_test will fail CI until both are updated together.
//   4. Ship a forced app update BEFORE cutting the server over to the new key.
//
// To compute the SPKI SHA-256 for a live certificate:
//   echo | openssl s_client -connect api.wa-sel.com:443 \
//       -servername api.wa-sel.com 2>/dev/null \
//     | openssl x509 -pubkey -noout \
//     | openssl pkey -pubin -outform der \
//     | openssl dgst -sha256 -binary | openssl enc -base64
// ---------------------------------------------------------------------------

/// SPKI SHA-256 of the current live leaf key at api.wa-sel.com.
/// Let's Encrypt cert valid Jun 3 – Sep 1 2026; reuse_key keeps this stable.
const kPinPrimary = 'Xak9G0tg0OqaD3D3cNK5q82wLw2/OeXH5YcUn56TUgA=';

/// SPKI SHA-256 of the offline EC P-256 reserve key
/// (mobile/android/wasel-backup-tls.key, gitignored).
const kPinBackup = 'C65pQL+gw9uIoRWA2G+W3s8En3S7HrUowDLaVYIstOU=';

/// Extracts the SubjectPublicKeyInfo (SPKI) from [certDer] and returns its
/// base64-encoded SHA-256 digest, or `null` if parsing fails.
///
/// The SPKI is the only element of TBSCertificate with the shape:
///   SEQUENCE { AlgorithmIdentifier(SEQUENCE), subjectPublicKey(BIT STRING) }
/// Walking TBSCertificate by that shape makes the extraction robust to the
/// optional [0] version tag that shifts element offsets in v3 certificates.
///
/// Returns `null` on any parse failure — callers must treat `null` as a
/// rejection (fail closed).
String? spkiSha256(Uint8List certDer) {
  try {
    final cert = ASN1Parser(certDer).nextObject() as ASN1Sequence;
    final tbs = cert.elements[0] as ASN1Sequence;
    for (final el in tbs.elements) {
      if (el is ASN1Sequence &&
          el.elements.length == 2 &&
          el.elements[0] is ASN1Sequence &&
          el.elements[1] is ASN1BitString) {
        return base64.encode(sha256.convert(el.encodedBytes).bytes);
      }
    }
  } catch (_) {
    // Any parse failure -> null -> connection rejected (fail closed).
  }
  return null;
}
